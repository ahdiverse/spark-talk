# Phase 3 Dogfood Runbook

Phase 3 objective from `purpose.md`:

1. Run two real Codex threads through broker for 50+ turns.
2. Track dropped/duplicated turn rate (target 0).
3. Capture UX friction and adjust command ergonomics.

## Automated Dogfood Simulation

Run the built-in 60-turn dogfood script:

```bash
npm run dogfood:phase3
```

Output:

- JSON report: `dogfood/reports/<session>-<timestamp>.json`
- Markdown report: `dogfood/reports/<session>-<timestamp>.md`

The script enforces Phase 3 metrics by computing:

- dropped turn count/rate
- duplicate turn count/rate
- median and p95 enqueue-to-delivered latency

The script exits non-zero if dropped or duplicate count is non-zero.

## Real Two-Thread Dogfood (Codex App)

### Terminal 1 (open persistent session)

```bash
spark talk open dogfood-real --db ~/.talk-broker/dogfood-real.db
```

### Codex Thread A setup

```bash
export TALK_SESSION=dogfood-real
export TALK_DB=~/.talk-broker/dogfood-real.db
spark talk join dogfood-real backend
```

Send from A to B:

```bash
echo "A: propose API contract v1" | spark talk send --stdin
```

Watch A-facing turns:

```bash
spark talk watch --follow -j
```

### Codex Thread B setup

```bash
export TALK_SESSION=dogfood-real
export TALK_DB=~/.talk-broker/dogfood-real.db
spark talk join dogfood-real frontend
```

Send from B to A:

```bash
echo "B: acknowledged, adding UI adapter" | spark talk send --stdin
```

Watch B-facing turns:

```bash
spark talk watch --follow -j
```

### Turn target

Run at least 50 total turns across both threads.

### Verify no drops/duplicates

Use JSON watch dump and inspect sequence continuity:

```bash
spark talk watch -j > /tmp/dogfood-real-turns.jsonl
```

Then parse/report using your internal analytics or by adapting `scripts/dogfood/run-phase3.mjs` logic.

### Close when done

```bash
spark talk close dogfood-real --db ~/.talk-broker/dogfood-real.db
```

## Ergonomics Adjustments Landed in Phase 3

1. `TALK_SESSION` env fallback for `send`, `watch`, `status`, and `start`.
2. `TALK_DB` env fallback for `send`, `watch`, `status`, and `start`.
3. Short flags: `-s` (session), `-d` (db), `-j` (json), `-f`/`-t` (from/to), `-r` (reply-to), `-m` (meta).
4. `spark talk send --stdin` for pipe-friendly/multiline messages.
5. `spark talk join <username>` for per-participant identity without `--from` every send.
