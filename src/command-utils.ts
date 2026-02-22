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
let resolvedCanonicalHome: string | null = null;

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

function getCanonicalSparkTalkHome(): string {
  if (resolvedCanonicalHome) {
    return resolvedCanonicalHome;
  }

  const home = path.join(os.homedir(), ".spark-talk");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  resolvedCanonicalHome = home;
  return home;
}

function getActiveDbFilePath(): string {
  return path.join(getSparkTalkHome(), "active-db-path");
}

function getAgentIdentitiesFilePath(): string {
  return path.join(getSparkTalkHome(), "agent-identities.json");
}

function getSessionRegistryFilePath(): string {
  const registryHome = process.env.SPARK_TALK_REGISTRY_HOME
    ? path.resolve(process.env.SPARK_TALK_REGISTRY_HOME)
    : getCanonicalSparkTalkHome();
  fs.mkdirSync(registryHome, { recursive: true, mode: 0o700 });
  return path.join(registryHome, "session-db-map.json");
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
    registerSessionDbPath(sessionId, dbPath);
    return { sessionId, dbPath };
  } finally {
    db.close();
  }
}

export function resolveDbPathForSession(
  sessionId: string,
  explicitDbPath?: string
): string {
  const attachedDbPath = findAttachedSessionDbPath(sessionId);
  const explicitHint = explicitDbPath ?? process.env.TALK_DB;
  const explicitDb = explicitHint ? path.resolve(explicitHint) : null;

  if (attachedDbPath) {
    if (explicitDb && explicitDb !== attachedDbPath) {
      throw new Error(
        `session '${sessionId}' is already attached to '${attachedDbPath}'. Use that DB path or omit --db/TALK_DB.`
      );
    }
    return attachedDbPath;
  }

  if (explicitDb) {
    return registerSessionDbPath(sessionId, explicitDb);
  }

  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const canonicalDbPath = path.join(
    getCanonicalSparkTalkHome(),
    "sessions",
    `${safeSession}.sqlite`
  );
  return registerSessionDbPath(sessionId, canonicalDbPath);
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

function findAttachedSessionDbPath(sessionId: string): string | null {
  const registered = readRegisteredSessionDbPath(sessionId);
  if (registered) {
    return registered;
  }

  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const canonicalDb = path.join(
    getCanonicalSparkTalkHome(),
    "sessions",
    `${safeSession}.sqlite`
  );
  if (fs.existsSync(canonicalDb)) {
    return registerSessionDbPath(sessionId, canonicalDb);
  }

  return null;
}

function registerSessionDbPath(sessionId: string, dbPath: string): string {
  const resolved = path.resolve(dbPath);

  // Use the registry file itself as a lock by trying to rename it temporarily
  // This provides atomic read-modify-write operations
  const registryFile = getSessionRegistryFilePath();
  const tempFile = `${registryFile}.updating.${process.pid}.${Date.now()}`;

  try {
    let registry: Record<string, string> = {};

    // Read existing registry if it exists
    if (fs.existsSync(registryFile)) {
      registry = readSessionDbRegistry();
    }

    // Check for conflicts
    for (const [registeredSessionId, registeredDbPath] of Object.entries(registry)) {
      if (registeredSessionId === sessionId) {
        continue;
      }
      if (path.resolve(registeredDbPath) === resolved) {
        throw new Error(
          `db '${resolved}' is already attached to session '${registeredSessionId}'. Use that session ID or a different DB path.`
        );
      }
    }

    // Update registry and write atomically
    registry[sessionId] = resolved;
    writeSessionDbRegistry(registry);
    return resolved;

  } catch (error) {
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

function readRegisteredSessionDbPath(sessionId: string): string | null {
  const registryFile = getSessionRegistryFilePath();
  if (!fs.existsSync(registryFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(registryFile, "utf8");
    const parsed = JSON.parse(content) as Record<string, string>;
    const raw = parsed[sessionId];
    if (!raw || typeof raw !== 'string') {
      return null;
    }

    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved)) {
      // Clean up stale entry
      delete parsed[sessionId];
      writeSessionDbRegistry(parsed);
      return null;
    }

    return resolved;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`Warning: Session registry file contains invalid JSON: ${error.message}`);
    } else {
      console.warn(`Warning: Failed to read session registry file: ${error}`);
    }
    return null;
  }
}

function readSessionDbRegistry(): Record<string, string> {
  const file = getSessionRegistryFilePath();
  if (!fs.existsSync(file)) {
    return {};
  }

  try {
    const content = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") {
      console.warn(`Warning: Session registry file ${file} contains invalid data structure, reinitializing`);
      return {};
    }
    const registry = parsed as Record<string, string>;
    const cleaned: Record<string, string> = {};
    for (const [sessionId, dbPath] of Object.entries(registry)) {
      if (typeof sessionId !== 'string' || typeof dbPath !== 'string') {
        console.warn(`Warning: Ignoring invalid registry entry: ${sessionId} -> ${dbPath}`);
        continue;
      }
      const resolvedDbPath = path.resolve(dbPath);
      if (fs.existsSync(resolvedDbPath)) {
        cleaned[sessionId] = resolvedDbPath;
      }
    }
    return cleaned;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`Warning: Session registry file ${file} contains invalid JSON, reinitializing. Parse error: ${error.message}`);
    } else {
      console.warn(`Warning: Failed to read session registry file ${file}, reinitializing. Error: ${error}`);
    }
    return {};
  }
}

function writeSessionDbRegistry(registry: Record<string, string>): void {
  const file = getSessionRegistryFilePath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Atomic write: write to temp file then rename
  const tempFile = `${file}.tmp.${Date.now()}.${Math.random().toString(36)}`;
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(registry, null, 2)}\n`);
    fs.chmodSync(tempFile, 0o600);
    fs.renameSync(tempFile, file);
  } catch (error) {
    // Clean up temp file on error
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
