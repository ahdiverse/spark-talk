# Talk Broker v1 Plan (Local SQLite, Homebrew-First, Public Core)

## Summary
Build a small Node.js CLI broker exposed as `spark talk` that relays messages between two Codex app threads through a shared SQLite queue, with durable turn logging and watcher UX.

Locked decisions from this planning session:
1. Scope: local machine only in v1, SQLite default.
2. Distribution: Homebrew tap first.
3. Source model: public core + private extensions.

## Goals
1. Relay messages `agent-a -> broker -> agent-b -> broker -> agent-a`.
2. Persist every turn with deterministic turn IDs and lifecycle state.
3. Provide simple CLI workflows:
   1. `spark talk start <sessionId>`
   2. `spark talk send --from <agent> --to <agent> "<text>"`
   3. `spark talk watch`
4. Keep transport pluggable so Redis can be added later without CLI breakage.

## Non-Goals (v1)
1. Cross-machine routing by default.
2. Direct Codex API integration or auth brokering.
3. Rich attachments/binary payloads.
4. Multi-tenant server deployment.

## Language Archetype
1. Runtime: Node.js 22+.
2. Language: TypeScript (compiled to ESM JS).
3. CLI framework: `commander`.
4. Validation: `zod`.
5. Storage: `better-sqlite3` (sync, predictable single-host behavior).
6. Logging: `pino` with JSON logs.

Rationale: fastest path for CLI ergonomics, strong schema validation, and clean future transport abstraction.

## Public Interfaces (Decision-Complete)

### CLI Contract
1. `spark talk start <sessionId> [--db <path>] [--agents <a,b>]`
   1. Creates DB if missing.
   2. Creates session row.
   3. Starts broker loop for that session.
   4. Prints DB path and session metadata.
2. `spark talk send --session <id> --from <agent> --to <agent> "<message>" [--reply-to <turnId>] [--meta <json>]`
   1. Validates envelope.
   2. Enqueues outbound turn with `status=queued`.
   3. Prints assigned `turnId`.
3. `spark talk watch --session <id> [--agent <name>] [--follow] [--json]`
   1. Streams turns in order.
   2. Optional agent filter.
   3. `--json` outputs machine-readable lines.
4. `spark talk ack --session <id> --turn <id> --agent <name>`
   1. Marks delivered turn acknowledged by recipient.
5. `spark talk status --session <id>`
   1. Shows queue depth, oldest queued age, last turn per agent.

### Message Envelope
```ts
type TurnStatus = "queued" | "delivered" | "acked" | "failed";

interface MessageEnvelope {
  protocolVersion: "1.0";
  sessionId: string;
  turnId: number;           // monotonic per session
  from: string;             // e.g. backend
  to: string;               // e.g. frontend
  body: string;             // utf-8 text
  replyToTurnId?: number;
  createdAt: string;        // ISO8601
  deliveredAt?: string;     // ISO8601
  ackedAt?: string;         // ISO8601
  status: TurnStatus;
  meta?: Record<string, unknown>;
}
```

### SQLite Schema
1. `sessions(session_id TEXT PK, created_at TEXT, created_by TEXT, state TEXT)`
2. `turns(id INTEGER PK AUTOINCREMENT, session_id TEXT, from_agent TEXT, to_agent TEXT, body TEXT, reply_to_turn_id INTEGER NULL, status TEXT, created_at TEXT, delivered_at TEXT NULL, acked_at TEXT NULL, meta_json TEXT NULL)`
3. `delivery_attempts(id INTEGER PK AUTOINCREMENT, turn_id INTEGER, attempt_no INTEGER, error_text TEXT NULL, created_at TEXT)`
4. `watch_cursors(session_id TEXT, agent TEXT, last_seen_turn_id INTEGER, PRIMARY KEY(session_id, agent))`
5. Indexes:
   1. `turns(session_id, id)`
   2. `turns(session_id, status, created_at)`

## Broker Behavior
1. `spark talk start` runs broker loop (foreground in v1).
2. Loop interval default: 150ms.
3. For each queued turn:
   1. Transition `queued -> delivered`.
   2. Stamp `delivered_at`.
   3. Record attempt.
4. `ack` is explicit by recipient agent/thread.
5. Retries:
   1. Retry only on internal broker DB errors.
   2. Max 3 attempts, then `failed`.
6. Ordering:
   1. FIFO by `id` within each session.
   2. No cross-session ordering guarantees.
7. Concurrency:
   1. Single writer model via one broker process per session.
   2. SQLite WAL enabled.
8. Security defaults:
   1. DB path default `~/.talk-broker/<sessionId>.db`.
   2. Create directory/file with user-only permissions.

## Homebrew-First Installation Plan
1. Publish tap: `org/homebrew-talk`.
2. Install flow:
   1. `brew tap org/talk`
   2. `brew install spark-talk`
3. Formula strategy:
   1. `depends_on "node@22"`.
   2. Download release tarball with built `dist/`.
   3. Install executable wrapper script `bin/spark`.
4. Keep npm package published too, but secondary in docs.

## Open Source Recommendation
1. Use public-core/private-extension model.
2. Open-source:
   1. CLI core.
   2. Protocol spec.
   3. SQLite transport.
   4. Basic docs/examples.
3. Keep private:
   1. Internal adapters for proprietary workflows.
   2. Org-specific automation wrappers.
4. License default: Apache-2.0 for core.
5. Governance:
   1. Public issue tracker for core bugs/features.
   2. Security policy with private disclosure channel.

## Rollout Plan

### Phase 0 (Day 0-1): Bootstrap
1. Initialize repo layout and tooling.
2. Implement schema + migration-on-start.
3. Implement `start/send/watch/status` commands.
4. Add structured logs and deterministic error codes.

### Phase 1 (Day 2-3): Reliability Hardening
1. Add `ack` flow and status transitions.
2. Add retry/failure handling and attempt logs.
3. Add crash-restart recovery tests.

### Phase 2 (Day 4): Packaging
1. Build release artifact.
2. Create Homebrew tap and formula.
3. Validate clean install on macOS arm64 and x64.

### Phase 3 (Day 5): Dogfood
1. Run two real Codex threads through broker for 50+ turns.
2. Track dropped/duplicated turn rate (target 0).
3. Capture UX friction and adjust command ergonomics.

### Phase 4 (Day 6-7): Public Core Launch
1. Open-source core repository.
2. Publish docs and protocol versioning policy.
3. Tag `v1.0.0` and announce install instructions.

## Test Cases and Acceptance Criteria

### Unit
1. Envelope validation rejects malformed fields.
2. Turn status transitions are legal only in allowed order.
3. Turn ID monotonicity per session is preserved.

### Integration
1. Two-process relay: A sends, B watches, B replies, A watches.
2. Broker restart with pending queued items resumes correctly.
3. Concurrent `send` calls preserve FIFO delivery order.

### E2E
1. Fresh machine install via Homebrew tap succeeds.
2. `spark talk start/send/watch/status/ack` complete without manual DB edits.
3. Logs contain turn IDs and timestamps for every transition.

### SLO/Acceptance
1. No lost turns in 1,000-turn local stress run.
2. No duplicate `delivered` transitions.
3. Median enqueue-to-delivered latency under 300ms on local host.

## Assumptions and Defaults
1. v1 targets exactly two named agents by convention, but schema supports more.
2. Local-machine communication is sufficient for initial use case.
3. SQLite is default transport; Redis deferred to v1.1 plugin.
4. Homebrew is primary install path; npm remains supported but secondary.
5. Apache-2.0 is the default core license unless changed later.
