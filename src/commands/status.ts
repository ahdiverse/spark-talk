import { Command } from "commander";
import { resolveSessionContext } from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  ensureSession,
  getStatusSummary,
  listKnownAgents,
  openDatabase,
  setActiveSession,
  setSessionState
} from "../db.js";
import { getRunningBrokerPid } from "../runtime.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show queue depth and recent turn state")
    .option("-s, --session <id>", "Session ID (or set TALK_SESSION, or use active session from DB)")
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .action((options: { session?: string; db?: string }) => {
      const context = resolveSessionContext({
        sessionArg: options.session,
        explicitDbPath: options.db
      });
      const sessionId = context.sessionId;
      const dbPath = context.dbPath;
      ensureDbParentDir(dbPath);

      const db = openDatabase(dbPath);
      try {
        ensureSession(db, sessionId, "spark:talk:status");
        setSessionState(db, sessionId, "active");
        setActiveSession(db, sessionId);
        const summary = getStatusSummary(db, sessionId);
        const participants = listKnownAgents(db, sessionId);
        const brokerPid = getRunningBrokerPid(sessionId, dbPath);
        console.log(`session=${sessionId}`);
        console.log(`db=${dbPath}`);
        console.log(`active_session=${summary.activeSessionId ?? "none"}`);
        console.log(`broker_running=${brokerPid ? "yes" : "no"}`);
        console.log(`broker_pid=${brokerPid ?? "none"}`);
        console.log(`participants=${participants.join(",") || "none"}`);
        console.log(`queue_depth=${summary.queueDepth}`);
        console.log(
          `oldest_queued_age_seconds=${summary.oldestQueuedAgeSeconds ?? "none"}`
        );

        if (summary.lastTurnPerAgent.length === 0) {
          console.log("last_turn_per_agent=none");
          return;
        }

        for (const row of summary.lastTurnPerAgent) {
          console.log(`agent=${row.agent} last_turn_id=${row.lastTurnId}`);
        }
      } finally {
        db.close();
      }
    });
}
