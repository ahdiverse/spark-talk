import { Command } from "commander";
import { runBrokerLoop } from "../broker.js";
import { rememberDbPath, resolveSessionContext } from "../command-utils.js";
import { ensureDbParentDir } from "../config.js";
import {
  ensureSession,
  openDatabase,
  setActiveSession,
  setSessionState,
  upsertSessionAgents
} from "../db.js";
import { createLogger } from "../log.js";
import {
  clearBrokerPid,
  ensureBrokerDaemon,
  getRunningBrokerPid,
  writeBrokerPid
} from "../runtime.js";
import { agentNameSchema } from "../types.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start foreground broker loop for a session")
    .argument("[sessionId]", "Session ID (or set TALK_SESSION, or use active session from DB)")
    .option("-d, --db <path>", "Path to SQLite database (or set TALK_DB)")
    .option("--agents <list>", "Comma-separated list of known agent names")
    .option("--daemon", "Run broker in background and return", false)
    .option("--worker", "Internal worker mode", false)
    .action(async (sessionId: string | undefined, options: {
      db?: string;
      agents?: string;
      daemon?: boolean;
      worker?: boolean;
    }) => {
      const context = resolveSessionContext({
        sessionArg: sessionId,
        explicitDbPath: options.db
      });
      const parsedSessionId = context.sessionId;
      const dbPath = context.dbPath;
      ensureDbParentDir(dbPath);

      const db = openDatabase(dbPath);
      ensureSession(db, parsedSessionId, "spark:talk:start");
      setSessionState(db, parsedSessionId, "active");
      setActiveSession(db, parsedSessionId);

      if (options.agents) {
        const parsedAgents: string[] = [];
        for (const rawAgent of options.agents.split(",")) {
          const agent = rawAgent.trim();
          if (agent.length > 0) {
            parsedAgents.push(agentNameSchema.parse(agent));
          }
        }
        upsertSessionAgents(db, parsedSessionId, parsedAgents);
      }
      db.close();
      rememberDbPath(dbPath);

      if (options.daemon && !options.worker) {
        const result = ensureBrokerDaemon(parsedSessionId, dbPath);
        console.log(`session=${parsedSessionId}`);
        console.log(`db=${dbPath}`);
        console.log(`broker=daemon`);
        console.log(`broker_pid=${result.pid}`);
        console.log(`broker_started=${result.started}`);
        return;
      }

      const logger = createLogger("spark:talk:start");
      const controller = new AbortController();

      const stop = () => {
        controller.abort();
      };

      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);

      console.log(`session=${parsedSessionId}`);
      console.log(`db=${dbPath}`);
      console.log("broker=running");

      const activePid = getRunningBrokerPid(parsedSessionId, dbPath);
      if (activePid && activePid !== process.pid) {
        throw new Error(
          `broker already running for session ${parsedSessionId} (pid=${activePid}). Use spark talk close -s ${parsedSessionId} --db ${dbPath} first.`
        );
      }
      writeBrokerPid(parsedSessionId, dbPath, process.pid);

      const loopDb = openDatabase(dbPath);
      try {
        await runBrokerLoop({
          db: loopDb,
          sessionId: parsedSessionId,
          pollIntervalMs: 150,
          signal: controller.signal,
          logger
        });
      } finally {
        loopDb.close();
        clearBrokerPid(parsedSessionId, dbPath, process.pid);
        console.log("broker=stopped");
      }
    });
}
