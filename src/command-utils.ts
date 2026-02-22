import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { getActiveSession, openDatabase } from "./db.js";
import { sessionIdSchema } from "./types.js";

export function resolveSessionId(maybeSession?: string): string {
  const raw = maybeSession ?? process.env.TALK_SESSION;
  if (!raw) {
    throw new Error("Session ID is required. Use --session <id> or set TALK_SESSION.");
  }
  return sessionIdSchema.parse(raw);
}

export function resolveDbPathWithEnv(
  sessionId: string,
  explicitDbPath?: string
): string {
  return resolveDbPathForSession(sessionId, explicitDbPath);
}

export interface SessionContext {
  sessionId: string;
  dbPath: string;
}

let resolvedSparkTalkHome: string | null = null;

function getSparkTalkHome(): string {
  if (resolvedSparkTalkHome) {
    return resolvedSparkTalkHome;
  }

  const candidates = [
    process.env.SPARK_TALK_HOME,
    path.join(os.homedir(), ".spark-talk"),
    path.join(process.cwd(), ".spark-talk-state"),
    path.join(os.tmpdir(), "spark-talk-state")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
      const probe = path.join(candidate, ".write-probe");
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      resolvedSparkTalkHome = candidate;
      return candidate;
    } catch {
      // try next location
    }
  }

  throw new Error("Unable to find writable state directory for spark talk");
}

function getActiveDbFilePath(): string {
  return path.join(getSparkTalkHome(), "active-db-path");
}

function getAgentIdentitiesFilePath(): string {
  return path.join(getSparkTalkHome(), "agent-identities.json");
}

export function rememberDbPath(dbPath: string): void {
  const home = getSparkTalkHome();
  const activeDbFile = getActiveDbFilePath();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const resolved = path.resolve(dbPath);
  fs.writeFileSync(activeDbFile, `${resolved}\n`);
  fs.chmodSync(activeDbFile, 0o600);
}

export function readRememberedDbPath(): string | null {
  const activeDbFile = getActiveDbFilePath();
  if (!fs.existsSync(activeDbFile)) {
    return null;
  }
  const raw = fs.readFileSync(activeDbFile, "utf8").trim();
  if (!raw) {
    return null;
  }
  return path.resolve(raw);
}

export function rememberJoinedAgent(
  sessionId: string,
  dbPath: string,
  agent: string
): void {
  const home = getSparkTalkHome();
  const identitiesFile = getAgentIdentitiesFilePath();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const identities = readAgentIdentities();
  identities[getAgentIdentityKey(sessionId, dbPath)] = agent;
  fs.writeFileSync(identitiesFile, `${JSON.stringify(identities, null, 2)}\n`);
  fs.chmodSync(identitiesFile, 0o600);
}

export function readJoinedAgent(
  sessionId: string,
  dbPath: string
): string | null {
  const identities = readAgentIdentities();
  const key = getAgentIdentityKey(sessionId, dbPath);
  return identities[key] ?? null;
}

export function resolveSessionContext(options: {
  sessionArg?: string;
  explicitDbPath?: string;
}): SessionContext {
  const sessionFromArgOrEnv = options.sessionArg ?? process.env.TALK_SESSION;

  if (sessionFromArgOrEnv) {
    const sessionId = sessionIdSchema.parse(sessionFromArgOrEnv);
    const dbPath = resolveDbPathForSession(sessionId, options.explicitDbPath);
    return { sessionId, dbPath };
  }

  const rememberedDbPath = readRememberedDbPath();
  const dbHint = options.explicitDbPath ?? process.env.TALK_DB ?? rememberedDbPath;
  if (!dbHint) {
    throw new Error(
      "Session ID is required. Use --session <id>, set TALK_SESSION, or provide --db/TALK_DB with an active session."
    );
  }

  const dbPath = path.resolve(dbHint);
  const db = openDatabase(dbPath);
  try {
    const active = getActiveSession(db);
    if (!active) {
      throw new Error(
        "No active session found in DB. Open one with: spark talk open <session> --db <path>"
      );
    }

    const sessionId = sessionIdSchema.parse(active);
    return { sessionId, dbPath };
  } finally {
    db.close();
  }
}

export function resolveDbPathForSession(
  sessionId: string,
  explicitDbPath?: string
): string {
  const dbHint = explicitDbPath ?? process.env.TALK_DB;
  if (dbHint) {
    return path.resolve(dbHint);
  }

  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getSparkTalkHome(), "sessions", `${safeSession}.sqlite`);
}

export async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}

function getAgentIdentityKey(sessionId: string, dbPath: string): string {
  const tty = process.env.TTY ?? "no-tty";
  return createHash("sha1")
    .update(`${path.resolve(dbPath)}::${sessionId}::${tty}`)
    .digest("hex");
}

function readAgentIdentities(): Record<string, string> {
  const identitiesFile = getAgentIdentitiesFilePath();
  if (!fs.existsSync(identitiesFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(identitiesFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}
