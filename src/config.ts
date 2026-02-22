import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_DB_DIR = path.join(os.homedir(), ".talk-broker");

export function getDefaultDbPath(sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(DEFAULT_DB_DIR, `${safeSessionId}.db`);
}

export function resolveDbPath(sessionId: string, explicitDbPath?: string): string {
  if (explicitDbPath) {
    return path.resolve(explicitDbPath);
  }
  return getDefaultDbPath(sessionId);
}

export function ensureDbParentDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
