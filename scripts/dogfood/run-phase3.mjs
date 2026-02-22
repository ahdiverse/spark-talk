import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "../..");

const args = parseArgs(process.argv.slice(2));
const turns = Number.parseInt(args.turns ?? "60", 10);
const session = args.session ?? `dogfood-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const defaultDb = path.join(os.tmpdir(), "spark-talk-dogfood", `${session}.db`);
const dbPath = path.resolve(args.db ?? defaultDb);
const reportDir = path.resolve(args.reportDir ?? path.join(repoRoot, "dogfood", "reports"));

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const nodeBin = process.execPath;
const cliPath = path.join(repoRoot, "dist", "cli.js");

if (!fs.existsSync(cliPath)) {
  execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
}

const broker = spawn(nodeBin, [cliPath, "talk", "start", session, "--db", dbPath], {
  cwd: repoRoot,
  stdio: ["ignore", "pipe", "pipe"]
});

let brokerStdout = "";
let brokerStderr = "";
let brokerStarted = false;

broker.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  brokerStdout += text;
  if (text.includes("broker=running") || brokerStdout.includes("broker=running")) {
    brokerStarted = true;
  }
});

broker.stderr.on("data", (chunk) => {
  brokerStderr += chunk.toString("utf8");
});

try {
  await waitFor(() => brokerStarted, 5000, "broker did not start within timeout");

  const expectedSeqs = new Array(turns).fill(0).map((_, index) => index + 1);

  for (const seq of expectedSeqs) {
    const from = seq % 2 === 1 ? "backend" : "frontend";
    const to = seq % 2 === 1 ? "frontend" : "backend";

    execCli([
      "talk",
      "send",
      "--session",
      session,
      "--from",
      from,
      "--to",
      to,
      "--db",
      dbPath,
      "--meta",
      JSON.stringify({ seq, run: session }),
      `turn-${seq}`
    ]);
  }

  const delivered = await waitForDelivered({ session, dbPath, turns, timeoutMs: 20000 });

  const report = buildReport({
    session,
    dbPath,
    turns,
    delivered,
    generatedAt: new Date().toISOString()
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportDir, `${session}-${stamp}.json`);
  const mdPath = path.join(reportDir, `${session}-${stamp}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, markdownReport(report));

  console.log(`dogfood_session=${session}`);
  console.log(`dogfood_turns=${turns}`);
  console.log(`dogfood_dropped_rate=${report.metrics.droppedRate}`);
  console.log(`dogfood_duplicate_rate=${report.metrics.duplicateRate}`);
  console.log(`dogfood_latency_median_ms=${report.metrics.medianDeliveryLatencyMs ?? "n/a"}`);
  console.log(`dogfood_report_json=${jsonPath}`);
  console.log(`dogfood_report_md=${mdPath}`);

  if (report.metrics.droppedCount > 0 || report.metrics.duplicateCount > 0) {
    process.exitCode = 1;
  }
} finally {
  broker.kill("SIGINT");
  await onceExit(broker, 3000);
}

function execCli(args) {
  return execFileSync(nodeBin, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
}

async function waitForDelivered({ session, dbPath, turns, timeoutMs }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const delivered = listDeliveredTurns(session, dbPath);
    if (delivered.length >= turns) {
      return delivered;
    }

    await sleep(120);
  }

  return listDeliveredTurns(session, dbPath);
}

function buildReport({ session, dbPath, turns, delivered, generatedAt }) {
  const seqCounts = new Map();
  const turnIdCounts = new Map();
  const latencyMs = [];

  for (const turn of delivered) {
    const seq = Number(turn?.meta?.seq);
    if (Number.isFinite(seq)) {
      seqCounts.set(seq, (seqCounts.get(seq) ?? 0) + 1);
    }

    turnIdCounts.set(turn.turnId, (turnIdCounts.get(turn.turnId) ?? 0) + 1);

    if (turn.createdAt && turn.deliveredAt) {
      const created = Date.parse(turn.createdAt);
      const deliveredAt = Date.parse(turn.deliveredAt);
      if (Number.isFinite(created) && Number.isFinite(deliveredAt)) {
        latencyMs.push(Math.max(0, deliveredAt - created));
      }
    }
  }

  const missingSeqs = [];
  for (let seq = 1; seq <= turns; seq += 1) {
    if (!seqCounts.has(seq)) {
      missingSeqs.push(seq);
    }
  }

  const duplicatedSeqs = [];
  for (const [seq, count] of seqCounts.entries()) {
    if (count > 1) {
      duplicatedSeqs.push({ seq, count });
    }
  }

  const duplicateTurnIds = [];
  for (const [turnId, count] of turnIdCounts.entries()) {
    if (count > 1) {
      duplicateTurnIds.push({ turnId, count });
    }
  }

  const droppedCount = missingSeqs.length;
  const duplicateCount = duplicatedSeqs.reduce((sum, item) => sum + (item.count - 1), 0);

  return {
    phase: 3,
    session,
    dbPath,
    generatedAt,
    targetTurns: turns,
    observedDeliveredTurns: delivered.length,
    metrics: {
      droppedCount,
      duplicateCount,
      droppedRate: round(droppedCount / turns),
      duplicateRate: round(duplicateCount / turns),
      medianDeliveryLatencyMs: median(latencyMs),
      p95DeliveryLatencyMs: percentile(latencyMs, 95)
    },
    missingSeqs,
    duplicatedSeqs,
    duplicateTurnIds,
    uxFriction: [
      {
        issue: "Repeated --session and --db flags across commands.",
        action: "Added TALK_SESSION/TALK_DB environment defaults and -s/-d aliases.",
        status: "resolved"
      },
      {
        issue: "Long send command for multiline prompts.",
        action: "Added spark talk send --stdin to accept piped content.",
        status: "resolved"
      },
      {
        issue: "Watch JSON mode required a long flag.",
        action: "Added -j alias for --json.",
        status: "resolved"
      }
    ]
  };
}

function markdownReport(report) {
  const duplicatedLines =
    report.duplicatedSeqs.length > 0
      ? report.duplicatedSeqs.map((item) => `- seq ${item.seq}: ${item.count}`)
      : ["- none"];

  return [
    "# Phase 3 Dogfood Report",
    "",
    `- Session: \`${report.session}\``,
    `- Generated: ${report.generatedAt}`,
    `- Target turns: ${report.targetTurns}`,
    `- Observed delivered turns: ${report.observedDeliveredTurns}`,
    "",
    "## Metrics",
    `- Dropped: ${report.metrics.droppedCount} (${report.metrics.droppedRate})`,
    `- Duplicated: ${report.metrics.duplicateCount} (${report.metrics.duplicateRate})`,
    `- Median delivery latency: ${report.metrics.medianDeliveryLatencyMs ?? "n/a"} ms`,
    `- P95 delivery latency: ${report.metrics.p95DeliveryLatencyMs ?? "n/a"} ms`,
    "",
    "## Missing Seqs",
    report.missingSeqs.length > 0 ? `- ${report.missingSeqs.join(", ")}` : "- none",
    "",
    "## Duplicated Seqs",
    ...duplicatedLines,
    "",
    "## UX Friction",
    ...report.uxFriction.map((item) => `- ${item.issue} ${item.action} (${item.status})`),
    ""
  ].join("\n");
}

async function waitFor(predicate, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(30);
  }
  throw new Error(message);
}

async function onceExit(child, timeoutMs) {
  await Promise.race([
    new Promise((resolve) => {
      child.once("exit", () => resolve(undefined));
    }),
    sleep(timeoutMs)
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}

function round(value) {
  return Number(value.toFixed(6));
}

function parseArgs(argv) {
  const map = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      map[key] = "true";
      continue;
    }

    map[key] = next;
    index += 1;
  }
  return map;
}

function listDeliveredTurns(session, dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `
          SELECT
            id,
            from_agent,
            to_agent,
            body,
            created_at,
            delivered_at,
            meta_json
          FROM turns
          WHERE session_id = ?
            AND status = 'delivered'
          ORDER BY id ASC
        `
      )
      .all(session);

    return rows.map((row) => {
      let meta = {};
      if (row.meta_json) {
        try {
          meta = JSON.parse(row.meta_json);
        } catch {
          meta = {};
        }
      }

      return {
        turnId: row.id,
        from: row.from_agent,
        to: row.to_agent,
        body: row.body,
        createdAt: row.created_at,
        deliveredAt: row.delivered_at,
        meta
      };
    });
  } finally {
    db.close();
  }
}
