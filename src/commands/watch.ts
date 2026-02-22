import { Command } from "commander";
import { readJoinedAgent, rememberDbPath, resolveSessionContext } from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  ensureSession,
  listTurns,
  openDatabase,
  readWatchCursor,
  setActiveSession,
  setSessionState,
  upsertSessionAgents,
  writeWatchCursor
} from "../db.js";
import { ensureBrokerDaemon } from "../runtime.js";
import { agentNameSchema, MessageEnvelope } from "../types.js";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch turns in session order")
    .option("-s, --session <id>", "Session ID (or set TALK_SESSION)")
    .option("--agent <name>", "Filter turns where agent is sender or recipient")
    .option("--follow", "Continue watching for new turns", false)
    .option("-j, --json", "Output JSON lines", false)
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .option("--no-ensure-broker", "Do not auto-start broker daemon if stopped")
    .option("--poll-interval-ms <ms>", "Polling interval for follow mode", "250")
    .action(
      async (options: {
        session?: string;
        agent?: string;
        follow: boolean;
        json: boolean;
        db?: string;
        ensureBroker?: boolean;
        pollIntervalMs: string;
      }) => {
        const context = resolveSessionContext({
          sessionArg: options.session,
          explicitDbPath: options.db
        });
        rememberDbPath(context.dbPath);
        const sessionId = context.sessionId;
        const inferredAgent = readJoinedAgent(sessionId, context.dbPath);
        const agent = options.agent
          ? agentNameSchema.parse(options.agent)
          : inferredAgent
            ? agentNameSchema.parse(inferredAgent)
            : undefined;
        const dbPath = context.dbPath;
        ensureDbParentDir(dbPath);

        if (options.ensureBroker !== false) {
          ensureBrokerDaemon(sessionId, dbPath);
        }

        const db = openDatabase(dbPath);
        ensureSession(db, sessionId, "spark:talk:watch");
        setSessionState(db, sessionId, "active");
        setActiveSession(db, sessionId);
        if (agent) {
          upsertSessionAgents(db, sessionId, [agent]);
        }
        const cursorKey = agent ?? "*";
        let lastSeenTurnId = readWatchCursor(db, sessionId, cursorKey);
        const pollIntervalMs = Number.parseInt(options.pollIntervalMs, 10);

        const flush = () => {
          const turns = listTurns(db, sessionId, {
            afterTurnId: lastSeenTurnId,
            agent,
            limit: 500
          });

          for (const turn of turns) {
            printTurn(turn, options.json);
            lastSeenTurnId = turn.turnId;
          }

          writeWatchCursor(db, sessionId, cursorKey, lastSeenTurnId);
        };

        try {
          flush();

          if (!options.follow) {
            return;
          }

          const controller = new AbortController();
          const stop = () => controller.abort();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);

          while (!controller.signal.aborted) {
            await sleep(pollIntervalMs, controller.signal);
            flush();
          }
        } finally {
          db.close();
        }
      }
    );
}

function printTurn(turn: MessageEnvelope, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(turn));
    return;
  }

  const status = turn.status.padEnd(9, " ");
  console.log(
    `[${turn.turnId}] ${turn.from} -> ${turn.to} | ${status} | ${turn.body}`
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
