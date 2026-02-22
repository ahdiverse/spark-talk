import { Command } from "commander";
import {
  readJoinedAgent,
  rememberDbPath,
  resolveSessionContext
} from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  ackTurn,
  ensureSession,
  openDatabase,
  setActiveSession,
  setSessionState,
  upsertSessionAgents
} from "../db.js";
import { agentNameSchema } from "../types.js";

export function registerAckCommand(program: Command): void {
  program
    .command("ack")
    .description("Acknowledge a delivered turn as the recipient")
    .requiredOption("-t, --turn <id>", "Turn ID to acknowledge")
    .option(
      "-s, --session <id>",
      "Session ID (or set TALK_SESSION, or use active session from DB)"
    )
    .option(
      "-a, --agent <name>",
      "Recipient agent name (or set TALK_AGENT, or join session first)"
    )
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .action((options: { turn: string; session?: string; agent?: string; db?: string }) => {
      const turnId = Number.parseInt(options.turn, 10);
      if (!Number.isFinite(turnId) || turnId <= 0) {
        throw new Error("--turn must be a positive integer");
      }

      const context = resolveSessionContext({
        sessionArg: options.session,
        explicitDbPath: options.db
      });
      rememberDbPath(context.dbPath);
      ensureDbParentDir(context.dbPath);

      const rawAgent =
        options.agent ??
        readJoinedAgent(context.sessionId, context.dbPath) ??
        process.env.TALK_AGENT;

      if (!rawAgent) {
        throw new Error(
          "recipient agent is required. Join first: spark talk join <sessionId> <username>, or pass --agent"
        );
      }

      const agent = agentNameSchema.parse(rawAgent);
      const db = openDatabase(context.dbPath);
      try {
        ensureSession(db, context.sessionId, "spark:talk:ack");
        setSessionState(db, context.sessionId, "active");
        setActiveSession(db, context.sessionId);
        upsertSessionAgents(db, context.sessionId, [agent]);

        const result = ackTurn(db, {
          sessionId: context.sessionId,
          turnId,
          agent
        });

        console.log(`session=${result.sessionId}`);
        console.log(`turn_id=${result.turnId}`);
        console.log(`agent=${agent}`);
        console.log(`status=${result.status}`);
        console.log(`acked_at=${result.ackedAt}`);
        console.log(`already_acked=${result.alreadyAcked}`);
      } finally {
        db.close();
      }
    });
}
