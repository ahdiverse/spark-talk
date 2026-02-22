import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface BrokerRuntimeFiles {
  runtimeDir: string;
  pidFile: string;
  logFile: string;
}

export interface BrokerDaemonResult {
  pid: number;
  started: boolean;
}

export function getBrokerRuntimeFiles(
  sessionId: string,
  dbPath: string
): BrokerRuntimeFiles {
  const runtimeDir = path.join(path.dirname(path.resolve(dbPath)), ".spark-talk-runtime");
  const key = createHash("sha1")
    .update(`${path.resolve(dbPath)}::${sessionId}`)
    .digest("hex")
    .slice(0, 16);

  return {
    runtimeDir,
    pidFile: path.join(runtimeDir, `${key}.pid`),
    logFile: path.join(runtimeDir, `${key}.log`)
  };
}

export function readBrokerPid(sessionId: string, dbPath: string): number | null {
  const files = getBrokerRuntimeFiles(sessionId, dbPath);
  if (!fs.existsSync(files.pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(files.pidFile, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }

  return pid;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeBrokerPid(
  sessionId: string,
  dbPath: string,
  pid: number
): void {
  const files = getBrokerRuntimeFiles(sessionId, dbPath);
  fs.mkdirSync(files.runtimeDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(files.pidFile, `${pid}\n`);
  fs.chmodSync(files.pidFile, 0o600);
}

export function clearBrokerPid(
  sessionId: string,
  dbPath: string,
  expectedPid?: number
): void {
  const files = getBrokerRuntimeFiles(sessionId, dbPath);
  if (!fs.existsSync(files.pidFile)) {
    return;
  }

  if (expectedPid !== undefined) {
    const current = readBrokerPid(sessionId, dbPath);
    if (current !== expectedPid) {
      return;
    }
  }

  fs.unlinkSync(files.pidFile);
}

export function getRunningBrokerPid(
  sessionId: string,
  dbPath: string
): number | null {
  const pid = readBrokerPid(sessionId, dbPath);
  if (!pid) {
    return null;
  }

  if (!isProcessAlive(pid)) {
    clearBrokerPid(sessionId, dbPath, pid);
    return null;
  }

  return pid;
}

export function ensureBrokerDaemon(
  sessionId: string,
  dbPath: string
): BrokerDaemonResult {
  const runningPid = getRunningBrokerPid(sessionId, dbPath);
  if (runningPid) {
    return { pid: runningPid, started: false };
  }

  const files = getBrokerRuntimeFiles(sessionId, dbPath);
  fs.mkdirSync(files.runtimeDir, { recursive: true, mode: 0o700 });

  const outFd = fs.openSync(files.logFile, "a");
  const cliEntryPath = process.argv[1] ? path.resolve(process.argv[1]) : path.resolve("dist/cli.js");

  const child = spawn(
    process.execPath,
    [...process.execArgv, cliEntryPath, "talk", "start", sessionId, "--db", dbPath, "--worker"],
    {
      detached: true,
      stdio: ["ignore", outFd, outFd],
      cwd: process.cwd(),
      env: process.env
    }
  );

  child.unref();

  if (!child.pid || child.pid <= 0) {
    throw new Error("failed to start broker daemon process");
  }

  writeBrokerPid(sessionId, dbPath, child.pid);
  return { pid: child.pid, started: true };
}

export async function stopBrokerDaemon(
  sessionId: string,
  dbPath: string,
  timeoutMs = 3000
): Promise<{ pid: number | null; stopped: boolean }> {
  const pid = getRunningBrokerPid(sessionId, dbPath);
  if (!pid) {
    return { pid: null, stopped: false };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    clearBrokerPid(sessionId, dbPath, pid);
    return { pid, stopped: true };
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isProcessAlive(pid)) {
      clearBrokerPid(sessionId, dbPath, pid);
      return { pid, stopped: true };
    }
    await sleep(100);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }

  clearBrokerPid(sessionId, dbPath, pid);
  return { pid, stopped: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
