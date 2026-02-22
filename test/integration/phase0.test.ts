import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ackTurn,
  deliverQueuedTurns,
  enqueueTurn,
  ensureSession,
  getIndexNames,
  getTableNames,
  listTurns,
  openDatabase
} from "../../src/db.js";
import { runBrokerTick } from "../../src/broker.js";
import { sendInputSchema } from "../../src/types.js";

const tempDirs: string[] = [];
const testDir = path.dirname(fileURLToPath(import.meta.url));
let registryHomeDir = "";

beforeAll(() => {
  registryHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-talk-registry-"));
  process.env.SPARK_TALK_REGISTRY_HOME = registryHomeDir;
  tempDirs.push(registryHomeDir);
});

afterAll(() => {
  delete process.env.SPARK_TALK_REGISTRY_HOME;
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("phase0 broker", () => {
  it("rejects invalid envelope values", () => {
    expect(() =>
      sendInputSchema.parse({
        sessionId: "bad/session",
        from: "backend",
        to: "frontend",
        body: "hello"
      })
    ).toThrow();

    expect(() =>
      sendInputSchema.parse({
        sessionId: "demo",
        from: "backend",
        to: "front end",
        body: "hello"
      })
    ).toThrow();

    expect(() =>
      sendInputSchema.parse({
        sessionId: "demo",
        from: "backend",
        to: "frontend",
        body: ""
      })
    ).toThrow();
  });

  it("creates expected sqlite tables and indexes", () => {
    const db = createTempDb();

    const tables = getTableNames(db);
    expect(tables).toEqual([
      "app_state",
      "delivery_attempts",
      "session_agents",
      "sessions",
      "turns",
      "watch_cursors"
    ]);

    const indexes = getIndexNames(db);
    expect(indexes).toContain("idx_turns_session_id_id");
    expect(indexes).toContain("idx_turns_session_status_created");
    expect(indexes).toContain("idx_session_agents_session");

    db.close();
  });

  it("send inserts queued turn and broker tick delivers it", () => {
    const db = createTempDb();
    ensureSession(db, "demo", "test");

    const turnId = enqueueTurn(db, {
      sessionId: "demo",
      from: "backend",
      to: "frontend",
      body: "hello"
    });

    expect(turnId).toBeGreaterThan(0);

    let turns = listTurns(db, "demo");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.status).toBe("queued");

    const delivered = runBrokerTick(db, "demo");
    expect(delivered).toEqual([turnId]);

    turns = listTurns(db, "demo");
    expect(turns[0]?.status).toBe("delivered");
    expect(turns[0]?.deliveredAt).toBeDefined();

    db.close();
  });

  it("enforces delivered->acked transition and recipient-only ack", () => {
    const db = createTempDb();
    ensureSession(db, "ackdemo", "test");

    const turnId = enqueueTurn(db, {
      sessionId: "ackdemo",
      from: "backend",
      to: "frontend",
      body: "hello ack"
    });

    expect(() =>
      ackTurn(db, {
        sessionId: "ackdemo",
        turnId,
        agent: "frontend"
      })
    ).toThrow("requires delivered");

    deliverQueuedTurns(db, "ackdemo");

    expect(() =>
      ackTurn(db, {
        sessionId: "ackdemo",
        turnId,
        agent: "backend"
      })
    ).toThrow("cannot ack turn");

    const ack = ackTurn(db, {
      sessionId: "ackdemo",
      turnId,
      agent: "frontend"
    });

    expect(ack.status).toBe("acked");
    expect(ack.alreadyAcked).toBe(false);
    expect(ack.ackedAt).toBeDefined();

    const turns = listTurns(db, "ackdemo");
    expect(turns[0]?.status).toBe("acked");
    expect(turns[0]?.ackedAt).toBeDefined();

    const ackAgain = ackTurn(db, {
      sessionId: "ackdemo",
      turnId,
      agent: "frontend"
    });
    expect(ackAgain.alreadyAcked).toBe(true);

    db.close();
  });

  it("watch --json --follow emits delivered messages in ascending turn id", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-broker-watch-"));
    tempDirs.push(tempDir);

    const dbPath = path.join(tempDir, "watch.db");
    const db = openDatabase(dbPath);
    ensureSession(db, "watchdemo", "test");

    const stdoutLines: string[] = [];
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "talk",
        "watch",
        "--session",
        "watchdemo",
        "--db",
        dbPath,
        "--json",
        "--follow",
        "--poll-interval-ms",
        "50"
      ],
      {
        cwd: path.resolve(testDir, "../.."),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (!text) {
        return;
      }
      for (const line of text.split("\n")) {
        const normalized = line.trim();
        if (normalized.length > 0) {
          stdoutLines.push(normalized);
        }
      }
    });

    await wait(120);

    enqueueTurn(db, {
      sessionId: "watchdemo",
      from: "backend",
      to: "frontend",
      body: "first"
    });
    deliverQueuedTurns(db, "watchdemo");

    enqueueTurn(db, {
      sessionId: "watchdemo",
      from: "frontend",
      to: "backend",
      body: "second"
    });
    deliverQueuedTurns(db, "watchdemo");

    await waitFor(() => stdoutLines.length >= 2, 4000);

    child.kill("SIGINT");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });

    const parsed = stdoutLines.slice(0, 2).map((line) => JSON.parse(line) as { turnId: number; status: string });
    expect(parsed[0]?.turnId).toBeLessThan(parsed[1]?.turnId ?? 0);
    expect(parsed[0]?.status).toBe("delivered");
    expect(parsed[1]?.status).toBe("delivered");

    db.close();
  });

  it("does not lose messages across 100 turns", () => {
    const db = createTempDb();
    ensureSession(db, "load", "test");

    for (let i = 0; i < 100; i += 1) {
      enqueueTurn(db, {
        sessionId: "load",
        from: i % 2 === 0 ? "backend" : "frontend",
        to: i % 2 === 0 ? "frontend" : "backend",
        body: `msg-${i}`
      });
    }

    const delivered = deliverQueuedTurns(db, "load", 200);
    expect(delivered).toHaveLength(100);

    const turns = listTurns(db, "load", { limit: 200 });
    expect(turns).toHaveLength(100);
    expect(turns.every((turn) => turn.status === "delivered")).toBe(true);

    const ids = turns.map((turn) => turn.turnId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);

    db.close();
  });

  it("supports TALK_SESSION/TALK_DB defaults and send --stdin", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-broker-stdin-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "stdin.db");

    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "send", "--from", "backend", "--to", "frontend", "--stdin"],
      {
        cwd: path.resolve(testDir, "../.."),
        env: {
          ...process.env,
          TALK_SESSION: "env-session",
          TALK_DB: dbPath
        },
        input: "hello from stdin",
        encoding: "utf8"
      }
    ).trim();

    expect(Number.parseInt(output, 10)).toBeGreaterThan(0);

    const db = openDatabase(dbPath);
    const turns = listTurns(db, "env-session");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.body).toBe("hello from stdin");
    expect(turns[0]?.from).toBe("backend");
    expect(turns[0]?.to).toBe("frontend");
    db.close();
  });

  it("supports short flags and env-backed status command", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-broker-short-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "short.db");
    const db = openDatabase(dbPath);
    ensureSession(db, "short-demo", "test");
    db.close();

    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "talk",
        "send",
        "-s",
        "short-demo",
        "-f",
        "backend",
        "-t",
        "frontend",
        "-d",
        dbPath,
        "--no-ensure-broker",
        "hello short flags"
      ],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );

    const statusOut = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "status"],
      {
        cwd: path.resolve(testDir, "../.."),
        env: {
          ...process.env,
          TALK_SESSION: "short-demo",
          TALK_DB: dbPath
        },
        encoding: "utf8"
      }
    );

    expect(statusOut).toContain("session=short-demo");
    expect(statusOut).toContain("queue_depth=1");
  });

  it("supports ack command and updates turn status", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-broker-ack-cmd-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "ack.db");
    const db = openDatabase(dbPath);
    ensureSession(db, "ack-cmd", "test");
    const turnId = enqueueTurn(db, {
      sessionId: "ack-cmd",
      from: "backend",
      to: "frontend",
      body: "ack me"
    });
    deliverQueuedTurns(db, "ack-cmd");
    db.close();

    const ackOut = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "talk",
        "ack",
        "--session",
        "ack-cmd",
        "--db",
        dbPath,
        "--agent",
        "frontend",
        "--turn",
        `${turnId}`
      ],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );

    expect(ackOut).toContain("status=acked");
    expect(ackOut).toContain("already_acked=false");

    const verifyDb = openDatabase(dbPath);
    const turns = listTurns(verifyDb, "ack-cmd");
    expect(turns[0]?.status).toBe("acked");
    verifyDb.close();
  });

  it("supports join username flow and close without explicit session", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-talk-open-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "active.db");

    const openOut = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "talk",
        "open",
        "active-demo",
        "--db",
        dbPath,
        "--agents",
        "alice,bob"
      ],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );
    expect(openOut).toContain("session=active-demo");
    expect(openOut).toContain("session_state=active");

    const joinOut = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "talk",
        "join",
        "alice",
        "-d",
        dbPath
      ],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );
    expect(joinOut).toContain("joined_agent=alice");

    const sendOut = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "talk",
        "send",
        "-d",
        dbPath,
        "--no-ensure-broker",
        "uses active session"
      ],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    ).trim();
    expect(Number.parseInt(sendOut, 10)).toBeGreaterThan(0);

    const db = openDatabase(dbPath);
    const turns = listTurns(db, "active-demo");
    expect(turns.length).toBeGreaterThan(0);
    expect(turns[0]?.body).toBe("uses active session");
    expect(turns[0]?.from).toBe("alice");
    expect(turns[0]?.to).toBe("bob");
    db.close();

    const closeOut = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "close", "--db", dbPath],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );
    expect(closeOut).toContain("session=active-demo");
    expect(closeOut).toContain("session_state=closed");
  });

  it("can open without session id and join by session id", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-talk-auto-open-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "auto.db");

    const openOut = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "open", "--db", dbPath],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );

    const match = openOut.match(/session_id=([a-zA-Z0-9._-]+)/);
    expect(match?.[1]).toBeDefined();
    const sessionId = match?.[1] as string;

    const joinOut = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "join", sessionId, "charlie", "--db", dbPath],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );

    expect(joinOut).toContain(`session=${sessionId}`);
    expect(joinOut).toContain("joined_agent=charlie");
  });

  it("forces a session id to use a single attached db path", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spark-talk-attach-"));
    tempDirs.push(tempDir);
    const dbPathA = path.join(tempDir, "a.db");
    const dbPathB = path.join(tempDir, "b.db");
    const sessionId = `attach-${Date.now().toString(36)}`;

    execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "open", sessionId, "--db", dbPathA],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );

    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "talk",
          "send",
          "--session",
          sessionId,
          "--db",
          dbPathB,
          "--from",
          "agent-a",
          "--to",
          "agent-b",
          "--no-ensure-broker",
          "should fail"
        ],
        {
          cwd: path.resolve(testDir, "../.."),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      throw new Error("expected send with mismatched --db to fail");
    } catch (error) {
      const execError = error as { stderr?: string | Buffer };
      stderr = Buffer.isBuffer(execError.stderr)
        ? execError.stderr.toString("utf8")
        : (execError.stderr ?? "");
    }

    expect(stderr).toContain("already attached");

    execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "talk", "close", sessionId, "--db", dbPathA],
      {
        cwd: path.resolve(testDir, "../.."),
        encoding: "utf8"
      }
    );
  });
});

function createTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-broker-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "talk.db");
  return openDatabase(dbPath);
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await wait(25);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}
