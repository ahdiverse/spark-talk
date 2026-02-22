import { Command } from "commander";
import { resolveSessionContext } from "../command-utils.js";
import {
  clearActiveSession,
  ensureSession,
  getActiveSession,
  openDatabase,
  setSessionState
} from "../db.js";
import { stopBrokerDaemon } from "../runtime.js";

export function registerCloseCommand(program: Command): void {
  program
    .command("close")
    .description("Close a chat session and stop its broker daemon")
    .argument("[sessionId]", "Session ID (or set TALK_SESSION, or use active session from DB)")
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .action(async (sessionId: string | undefined, options: { db?: string }) => {
      const context = resolveSessionContext({
        sessionArg: sessionId,
        explicitDbPath: options.db
      });

      const db = openDatabase(context.dbPath);
      try {
        ensureSession(db, context.sessionId, "spark:talk:close");
        setSessionState(db, context.sessionId, "closed");

        const activeSession = getActiveSession(db);
        if (activeSession === context.sessionId) {
          clearActiveSession(db);
        }
      } finally {
        db.close();
      }

      const result = await stopBrokerDaemon(context.sessionId, context.dbPath);

      console.log(`session=${context.sessionId}`);
      console.log(`db=${context.dbPath}`);
      console.log("session_state=closed");
      console.log(`broker_stopped=${result.stopped}`);
      console.log(`broker_pid=${result.pid ?? "none"}`);
    });
}
