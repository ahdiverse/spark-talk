import type { Logger } from "pino";
import { deliverQueuedTurns, TalkDatabase } from "./db.js";

export interface RunBrokerLoopOptions {
  db: TalkDatabase;
  sessionId: string;
  pollIntervalMs?: number;
  signal: AbortSignal;
  logger?: Logger;
}

export function runBrokerTick(db: TalkDatabase, sessionId: string): number[] {
  return deliverQueuedTurns(db, sessionId);
}

export async function runBrokerLoop(options: RunBrokerLoopOptions): Promise<void> {
  const { db, sessionId, signal, logger } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 150;

  while (!signal.aborted) {
    const delivered = runBrokerTick(db, sessionId);
    if (delivered.length > 0) {
      logger?.info({ sessionId, deliveredCount: delivered.length, delivered }, "delivered turns");
    }

    await sleep(pollIntervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
