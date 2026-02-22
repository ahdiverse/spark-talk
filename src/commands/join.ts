import { Command } from "commander";
import {
  rememberDbPath,
  rememberJoinedAgent,
  resolveSessionContext
} from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  ensureSession,
  listKnownAgents,
  openDatabase,
  setActiveSession,
  setSessionState,
  upsertSessionAgents
} from "../db.js";
import { ensureBrokerDaemon } from "../runtime.js";
import { agentNameSchema } from "../types.js";

export function registerJoinCommand(program: Command): void {
  program
    .command("join")
    .description("Join an active session as a username (max 2 participants per session)")
    .argument("<first>", "Session ID or username")
    .argument("[second]", "Username when first is session ID")
    .option(
      "-s, --session <id>",
      "Session ID (or set TALK_SESSION, or use active session from DB)"
    )
    .option("--as <username>", "Username override")
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .action((first: string, second: string | undefined, options: { session?: string; db?: string; as?: string }) => {
      const resolved = resolveJoinArgs(first, second, options);
      const sessionArg = resolved.sessionId;
      const username = resolved.username;
      const agent = agentNameSchema.parse(username);
      const context = resolveSessionContext({
        sessionArg,
        explicitDbPath: options.db
      });

      ensureDbParentDir(context.dbPath);
      const db = openDatabase(context.dbPath);
      let participants: string[] = [];

      try {
        ensureSession(db, context.sessionId, "spark:talk:join");
        setSessionState(db, context.sessionId, "active");
        setActiveSession(db, context.sessionId);
        upsertSessionAgents(db, context.sessionId, [agent]);
        participants = listKnownAgents(db, context.sessionId);
      } finally {
        db.close();
      }

      rememberDbPath(context.dbPath);
      rememberJoinedAgent(context.sessionId, context.dbPath, agent);

      const daemon = ensureBrokerDaemon(context.sessionId, context.dbPath);

      console.log(`session=${context.sessionId}`);
      console.log(`db=${context.dbPath}`);
      console.log(`joined_agent=${agent}`);
      console.log(`participants=${participants.join(",") || agent}`);
      console.log(`broker_running=yes`);
      console.log(`broker_pid=${daemon.pid}`);
      console.log(`broker_started=${daemon.started}`);
    });
}

function resolveJoinArgs(
  first: string,
  second: string | undefined,
  options: { session?: string; as?: string }
): { sessionId?: string; username: string } {
  if (options.as) {
    return {
      sessionId: options.session ?? first,
      username: options.as
    };
  }

  if (second) {
    return {
      sessionId: first,
      username: second
    };
  }

  if (options.session) {
    return {
      sessionId: options.session,
      username: first
    };
  }

  return {
    sessionId: undefined,
    username: first
  };
}
