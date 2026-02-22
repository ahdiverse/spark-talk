import fs from "node:fs";
import Database from "better-sqlite3";
import {
  DbTurnRow,
  MessageEnvelope,
  PROTOCOL_VERSION,
  SendInput
} from "./types.js";

export type TalkDatabase = InstanceType<typeof Database>;

export interface StatusSummary {
  queueDepth: number;
  oldestQueuedAgeSeconds: number | null;
  lastTurnPerAgent: Array<{ agent: string; lastTurnId: number }>;
  activeSessionId: string | null;
}

export interface AckInput {
  sessionId: string;
  turnId: number;
  agent: string;
}

export interface AckResult {
  sessionId: string;
  turnId: number;
  status: "acked";
  ackedAt: string;
  alreadyAcked: boolean;
}

export function openDatabase(dbPath: string): TalkDatabase {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  initSchema(db);

  if (fs.existsSync(dbPath)) {
    fs.chmodSync(dbPath, 0o600);
  }

  return db;
}

export function initSchema(db: TalkDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      state TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      body TEXT NOT NULL,
      reply_to_turn_id INTEGER NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT NULL,
      acked_at TEXT NULL,
      meta_json TEXT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(session_id)
    );

    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turn_id INTEGER NOT NULL,
      attempt_no INTEGER NOT NULL,
      error_text TEXT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(turn_id) REFERENCES turns(id)
    );

    CREATE TABLE IF NOT EXISTS watch_cursors (
      session_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      last_seen_turn_id INTEGER NOT NULL,
      PRIMARY KEY(session_id, agent)
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_agents (
      session_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(session_id, agent),
      FOREIGN KEY(session_id) REFERENCES sessions(session_id)
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session_id_id
      ON turns(session_id, id);

    CREATE INDEX IF NOT EXISTS idx_turns_session_status_created
      ON turns(session_id, status, created_at);

    CREATE INDEX IF NOT EXISTS idx_session_agents_session
      ON session_agents(session_id, agent);
  `);
}

export function ensureSession(
  db: TalkDatabase,
  sessionId: string,
  createdBy = "spark:talk"
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO sessions(session_id, created_at, created_by, state)
      VALUES (?, ?, ?, 'active')
      ON CONFLICT(session_id) DO NOTHING
    `
  ).run(sessionId, now, createdBy);
}

export function setSessionState(
  db: TalkDatabase,
  sessionId: string,
  state: "active" | "closed"
): void {
  db.prepare(
    `
      UPDATE sessions
      SET state = ?
      WHERE session_id = ?
    `
  ).run(state, sessionId);
}

export function upsertSessionAgents(
  db: TalkDatabase,
  sessionId: string,
  agents: string[]
): void {
  const existingAgents = listKnownAgents(db, sessionId);
  const merged = new Set([...existingAgents, ...agents]);
  if (merged.size > 2) {
    throw new Error(
      `session '${sessionId}' cannot have more than 2 participants; found ${merged.size}`
    );
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(
    `
      INSERT INTO session_agents(session_id, agent, last_seen_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, agent)
      DO UPDATE SET last_seen_at = excluded.last_seen_at
    `
  );

  const tx = db.transaction(() => {
    for (const agent of agents) {
      stmt.run(sessionId, agent, now);
    }
  });
  tx();
}

export function listKnownAgents(db: TalkDatabase, sessionId: string): string[] {
  const rows = db
    .prepare(
      `
        SELECT DISTINCT agent
        FROM (
          SELECT agent FROM session_agents WHERE session_id = ?
          UNION ALL
          SELECT from_agent AS agent FROM turns WHERE session_id = ?
          UNION ALL
          SELECT to_agent AS agent FROM turns WHERE session_id = ?
        )
        ORDER BY agent ASC
      `
    )
    .all(sessionId, sessionId, sessionId) as Array<{ agent: string }>;

  return rows.map((row) => row.agent);
}

export function listSessions(
  db: TalkDatabase
): Array<{ sessionId: string; createdAt: string; createdBy: string; state: string }> {
  const rows = db
    .prepare(
      `
        SELECT session_id, created_at, created_by, state
        FROM sessions
        ORDER BY created_at DESC
      `
    )
    .all() as Array<{
      session_id: string;
      created_at: string;
      created_by: string;
      state: string;
    }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    state: row.state
  }));
}

export function setActiveSession(db: TalkDatabase, sessionId: string): void {
  db.prepare(
    `
      INSERT INTO app_state(key, value)
      VALUES ('active_session_id', ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value
    `
  ).run(sessionId);
}

export function clearActiveSession(db: TalkDatabase): void {
  db.prepare("DELETE FROM app_state WHERE key = 'active_session_id'").run();
}

export function getActiveSession(db: TalkDatabase): string | null {
  const row = db
    .prepare(
      `
        SELECT value
        FROM app_state
        WHERE key = 'active_session_id'
        LIMIT 1
      `
    )
    .get() as { value: string } | undefined;

  return row?.value ?? null;
}

export function sessionExists(db: TalkDatabase, sessionId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sessions WHERE session_id = ? LIMIT 1")
    .get(sessionId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function enqueueTurn(db: TalkDatabase, input: SendInput): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
        INSERT INTO turns(
          session_id,
          from_agent,
          to_agent,
          body,
          reply_to_turn_id,
          status,
          created_at,
          meta_json
        )
        VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
      `
    )
    .run(
      input.sessionId,
      input.from,
      input.to,
      input.body,
      input.replyToTurnId ?? null,
      now,
      input.meta ? JSON.stringify(input.meta) : null
    );

  return Number(result.lastInsertRowid);
}

export function deliverQueuedTurns(
  db: TalkDatabase,
  sessionId: string,
  limit = 100
): number[] {
  const selectStmt = db.prepare(
    `
      SELECT id
      FROM turns
      WHERE session_id = ?
        AND status = 'queued'
      ORDER BY id ASC
      LIMIT ?
    `
  );

  const updateStmt = db.prepare(
    `
      UPDATE turns
      SET status = 'delivered', delivered_at = ?
      WHERE id = ?
        AND session_id = ?
        AND status = 'queued'
    `
  );

  const attemptStmt = db.prepare(
    `
      INSERT INTO delivery_attempts(turn_id, attempt_no, error_text, created_at)
      VALUES (?, ?, ?, ?)
    `
  );

  const failedStmt = db.prepare(
    `
      UPDATE turns
      SET status = 'failed'
      WHERE id = ?
        AND session_id = ?
        AND status = 'queued'
    `
  );

  const attemptNoStmt = db.prepare(
    `
      SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_attempt_no
      FROM delivery_attempts
      WHERE turn_id = ?
    `
  );

  const rows = selectStmt.all(sessionId, limit) as Array<{ id: number }>;
  if (rows.length === 0) {
    return [];
  }

  const deliveredIds: number[] = [];
  for (const row of rows) {
    const now = new Date().toISOString();
    const attemptNoRow = attemptNoStmt.get(row.id) as { next_attempt_no: number };
    const attemptNo = attemptNoRow.next_attempt_no;

    try {
      const update = updateStmt.run(now, row.id, sessionId);
      if (update.changes === 1) {
        attemptStmt.run(row.id, attemptNo, null, now);
        deliveredIds.push(row.id);
      } else {
        attemptStmt.run(row.id, attemptNo, "turn-not-queued", now);
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "unknown-delivery-error";
      attemptStmt.run(row.id, attemptNo, errorText, now);
      if (attemptNo >= 3) {
        failedStmt.run(row.id, sessionId);
      }
    }
  }

  return deliveredIds;
}

export function ackTurn(db: TalkDatabase, input: AckInput): AckResult {
  const row = db
    .prepare(
      `
        SELECT id, to_agent, status, acked_at
        FROM turns
        WHERE session_id = ?
          AND id = ?
        LIMIT 1
      `
    )
    .get(input.sessionId, input.turnId) as
    | {
        id: number;
        to_agent: string;
        status: string;
        acked_at: string | null;
      }
    | undefined;

  if (!row) {
    throw new Error(
      `turn ${input.turnId} was not found in session ${input.sessionId}`
    );
  }

  if (row.to_agent !== input.agent) {
    throw new Error(
      `agent '${input.agent}' cannot ack turn ${input.turnId}; recipient is '${row.to_agent}'`
    );
  }

  if (row.status === "acked" && row.acked_at) {
    return {
      sessionId: input.sessionId,
      turnId: input.turnId,
      status: "acked",
      ackedAt: row.acked_at,
      alreadyAcked: true
    };
  }

  if (row.status !== "delivered") {
    throw new Error(
      `turn ${input.turnId} is '${row.status}' and cannot be acked (requires delivered)`
    );
  }

  const ackedAt = new Date().toISOString();
  const result = db
    .prepare(
      `
        UPDATE turns
        SET status = 'acked', acked_at = ?
        WHERE session_id = ?
          AND id = ?
          AND to_agent = ?
          AND status = 'delivered'
      `
    )
    .run(ackedAt, input.sessionId, input.turnId, input.agent);

  if (result.changes !== 1) {
    throw new Error(`failed to ack turn ${input.turnId}`);
  }

  return {
    sessionId: input.sessionId,
    turnId: input.turnId,
    status: "acked",
    ackedAt,
    alreadyAcked: false
  };
}

export function listTurns(
  db: TalkDatabase,
  sessionId: string,
  options?: { afterTurnId?: number; agent?: string; limit?: number }
): MessageEnvelope[] {
  const params: Array<string | number> = [sessionId];

  let sql = `
    SELECT
      id,
      session_id,
      from_agent,
      to_agent,
      body,
      reply_to_turn_id,
      status,
      created_at,
      delivered_at,
      acked_at,
      meta_json
    FROM turns
    WHERE session_id = ?
  `;

  if (options?.afterTurnId !== undefined) {
    sql += " AND id > ?";
    params.push(options.afterTurnId);
  }

  if (options?.agent) {
    sql += " AND (from_agent = ? OR to_agent = ?)";
    params.push(options.agent, options.agent);
  }

  sql += " ORDER BY id ASC LIMIT ?";
  params.push(options?.limit ?? 500);

  const rows = db.prepare(sql).all(...params) as DbTurnRow[];
  return rows.map(toMessageEnvelope);
}

export function readWatchCursor(
  db: TalkDatabase,
  sessionId: string,
  agent: string
): number {
  const row = db
    .prepare(
      `
        SELECT last_seen_turn_id
        FROM watch_cursors
        WHERE session_id = ? AND agent = ?
        LIMIT 1
      `
    )
    .get(sessionId, agent) as { last_seen_turn_id: number } | undefined;

  return row?.last_seen_turn_id ?? 0;
}

export function writeWatchCursor(
  db: TalkDatabase,
  sessionId: string,
  agent: string,
  lastSeenTurnId: number
): void {
  db.prepare(
    `
      INSERT INTO watch_cursors(session_id, agent, last_seen_turn_id)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, agent)
      DO UPDATE SET last_seen_turn_id = excluded.last_seen_turn_id
    `
  ).run(sessionId, agent, lastSeenTurnId);
}

export function getStatusSummary(
  db: TalkDatabase,
  sessionId: string
): StatusSummary {
  const queueDepthRow = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM turns
        WHERE session_id = ?
          AND status = 'queued'
      `
    )
    .get(sessionId) as { count: number };

  const oldestQueuedRow = db
    .prepare(
      `
        SELECT created_at
        FROM turns
        WHERE session_id = ?
          AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get(sessionId) as { created_at: string } | undefined;

  const lastTurnRows = db
    .prepare(
      `
        SELECT agent, MAX(id) AS last_turn_id
        FROM (
          SELECT from_agent AS agent, id
          FROM turns
          WHERE session_id = ?
          UNION ALL
          SELECT to_agent AS agent, id
          FROM turns
          WHERE session_id = ?
        )
        GROUP BY agent
        ORDER BY agent ASC
      `
    )
    .all(sessionId, sessionId) as Array<{ agent: string; last_turn_id: number }>;

  let oldestQueuedAgeSeconds: number | null = null;
  if (oldestQueuedRow?.created_at) {
    const oldestMillis = Date.parse(oldestQueuedRow.created_at);
    oldestQueuedAgeSeconds = Math.max(
      0,
      Math.floor((Date.now() - oldestMillis) / 1000)
    );
  }

  return {
    queueDepth: queueDepthRow.count,
    oldestQueuedAgeSeconds,
    activeSessionId: getActiveSession(db),
    lastTurnPerAgent: lastTurnRows.map((row) => ({
      agent: row.agent,
      lastTurnId: row.last_turn_id
    }))
  };
}

export function getTableNames(db: TalkDatabase): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export function getIndexNames(db: TalkDatabase): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function toMessageEnvelope(row: DbTurnRow): MessageEnvelope {
  let meta: Record<string, unknown> | undefined;

  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json) as Record<string, unknown>;
    } catch {
      meta = undefined;
    }
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: row.session_id,
    turnId: row.id,
    from: row.from_agent,
    to: row.to_agent,
    body: row.body,
    replyToTurnId: row.reply_to_turn_id ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
    ackedAt: row.acked_at ?? undefined,
    status: row.status,
    meta
  };
}
