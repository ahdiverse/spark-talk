import { Command } from "commander";
import { ZodError } from "zod";
import {
  rememberDbPath,
  rememberJoinedAgent,
  readJoinedAgent,
  readStdinText,
  resolveSessionContext
} from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  enqueueTurn,
  ensureSession,
  listKnownAgents,
  openDatabase,
  setActiveSession,
  setSessionState,
  upsertSessionAgents
} from "../db.js";
import { ensureBrokerDaemon } from "../runtime.js";
import { agentNameSchema, sendInputSchema } from "../types.js";

export function registerSendCommand(program: Command): void {
  program
    .command("send")
    .description("Queue a message turn from one agent to another")
    .option("-s, --session <id>", "Session ID (or set TALK_SESSION)")
    .option("-f, --from <agent>", "Sender agent (or set TALK_AGENT)")
    .option("-t, --to <agent>", "Recipient agent (inferred if session has exactly 2 agents)")
    .option("-r, --reply-to <turnId>", "Reply-to turn ID")
    .option("-m, --meta <json>", "JSON metadata object")
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .option("--stdin", "Read message text from stdin")
    .option("--no-ensure-broker", "Do not auto-start broker daemon if stopped")
    .argument("[message]", "Message text")
    .action(
      async (
        message: string | undefined,
        options: {
          session?: string;
          from?: string;
          to?: string;
          replyTo?: string;
          meta?: string;
          db?: string;
          stdin?: boolean;
          ensureBroker?: boolean;
        }
      ) => {
        const messageFromStdin = options.stdin ? await readStdinText() : "";
        const body = message ?? messageFromStdin;
        if (!body || body.length === 0) {
          throw new Error("message is required. Pass [message] or use --stdin.");
        }

        const replyToTurnId = options.replyTo
          ? Number.parseInt(options.replyTo, 10)
          : undefined;

        let meta: Record<string, unknown> | undefined;
        if (options.meta) {
          const parsed = JSON.parse(options.meta) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            meta = parsed as Record<string, unknown>;
          } else {
            throw new Error("--meta must be a JSON object");
          }
        }

        const context = resolveSessionContext({
          sessionArg: options.session,
          explicitDbPath: options.db
        });
        rememberDbPath(context.dbPath);

        const dbPath = context.dbPath;
        ensureDbParentDir(dbPath);

        const db = openDatabase(dbPath);
        try {
          ensureSession(db, context.sessionId, "spark:talk:send");
          setSessionState(db, context.sessionId, "active");
          setActiveSession(db, context.sessionId);

          const knownAgents = listKnownAgents(db, context.sessionId);
          const fromRaw =
            options.from ??
            readJoinedAgent(context.sessionId, context.dbPath) ??
            process.env.TALK_AGENT ??
            (knownAgents.length === 1 ? knownAgents[0] : undefined);

          if (!fromRaw) {
            throw new Error(
              "sender agent is required. Join first: spark talk join <sessionId> <username>"
            );
          }

          const from = agentNameSchema.parse(fromRaw);
          let toRaw = options.to;
          if (!toRaw) {
            const peers = knownAgents.filter((agent) => agent !== from);
            if (peers.length === 1) {
              toRaw = peers[0];
            }
          }

          if (!toRaw) {
            throw new Error(
              "recipient agent is ambiguous. Set --to <agent> once, or open session with --agents a,b."
            );
          }

          const to = agentNameSchema.parse(toRaw);
          if (from === to) {
            throw new Error("sender and recipient cannot be the same agent");
          }

          const payload = sendInputSchema.parse({
            sessionId: context.sessionId,
            from,
            to,
            body,
            replyToTurnId,
            meta
          });

          upsertSessionAgents(db, payload.sessionId, [from, to]);
          rememberJoinedAgent(payload.sessionId, context.dbPath, from);
          const turnId = enqueueTurn(db, payload);
          console.log(turnId.toString());
        } finally {
          db.close();
        }

        if (options.ensureBroker !== false) {
          ensureBrokerDaemon(context.sessionId, dbPath);
        }
      }
    );
}

export function formatSendError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
