import { Command } from "commander";
import { randomUUID } from "node:crypto";
import {
  rememberDbPath,
  resolveDbPathForSession,
  resolveSessionContext
} from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  ensureSession,
  openDatabase,
  setActiveSession,
  setSessionState,
  upsertSessionAgents
} from "../db.js";
import { agentNameSchema } from "../types.js";
import { ensureBrokerDaemon } from "../runtime.js";

export function registerOpenCommand(program: Command): void {
  program
    .command("open")
    .description("Open a chat session and keep its broker active until explicitly closed")
    .argument("[sessionId]", "Session ID to open (auto-generated if omitted)")
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .option("--agents <list>", "Optional fixed pair, comma-separated (max 2)")
    .action((sessionId: string | undefined, options: { db?: string; agents?: string }) => {
      const targetSession = sessionId ?? generateSessionId();
      const context = resolveSessionContext({
        sessionArg: targetSession,
        explicitDbPath: options.db ?? resolveDbPathForSession(targetSession)
      });

      ensureDbParentDir(context.dbPath);
      const db = openDatabase(context.dbPath);
      try {
        ensureSession(db, context.sessionId, "spark:talk:open");
        setSessionState(db, context.sessionId, "active");
        setActiveSession(db, context.sessionId);

        if (options.agents) {
          const parsedAgents = options.agents
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((agent) => agentNameSchema.parse(agent));
          upsertSessionAgents(db, context.sessionId, parsedAgents);
        }
      } finally {
        db.close();
      }
      rememberDbPath(context.dbPath);

      const daemon = ensureBrokerDaemon(context.sessionId, context.dbPath);

      console.log(`session=${context.sessionId}`);
      console.log(`session_id=${context.sessionId}`);
      console.log(`db=${context.dbPath}`);
      console.log("session_state=active");
      console.log("spark_chat=open");
      console.log("status=waiting_for_other_agent");
      console.log(`message=Spark chat open. Waiting for other agent to join session ${context.sessionId}.`);
      console.log(`broker_running=yes`);
      console.log(`broker_pid=${daemon.pid}`);
      console.log(`broker_started=${daemon.started}`);
    });
}

function generateSessionId(): string {
  return `spark-${randomUUID().split("-")[0]}`;
}
