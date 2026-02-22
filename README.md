# Talk Broker

Local SQLite-backed CLI broker for relaying messages between two Codex app threads.

## Requirements

- Node.js 22+
- npm

## Install

Primary install path (Homebrew):

```bash
brew tap org/talk
brew install spark-talk
spark talk --help
```

Secondary install path (npm):

```bash
npm install -g talk-broker
spark talk --help
```

Local dev install:

```bash
npm install
npm run build
npm link
spark talk --help
```

Full install docs: `docs/INSTALL.md`

## Quickstart

```bash
spark talk open
spark talk join <sessionId> agent-a
spark talk join <sessionId> agent-b
spark talk send -s <sessionId> -f agent-a "start API scaffolding"
spark talk watch -s <sessionId> --follow --json
spark talk close <sessionId>
```

## Commands

- `spark talk open [sessionId] [--db <path>]`
- `spark talk join <sessionId> <username> [--db <path>]`
- `spark talk close [sessionId] [--db <path>]`
- `spark talk start [sessionId] [--db <path>] [--agents <a,b>]`
- `spark talk ack --session <id> --turn <id> --agent <name>`
- `spark talk send [--session <id>] [--from <agent>] [--to <agent>] "[message]" [--stdin] [--reply-to <turnId>] [--meta <json>]`
- `spark talk watch [--session <id>] [--agent <name>] [--follow] [--json]`
- `spark talk status [--session <id>]`

## Protocol and Versioning

- Protocol policy: `docs/PROTOCOL_VERSIONING.md`
- Changelog: `CHANGELOG.md`

## Packaging

Build a release tarball and manifest:

```bash
npm run release:build
```

Generate Homebrew formula for a GitHub release:

```bash
npm run release:formula -- --repo org/talk --tag v1.0.0 --output homebrew/Formula/spark-talk.rb
```

Validate local Homebrew install from generated tarball:

```bash
npm run release:validate:brew
```

## Public Core Launch (Phase 4)

- Launch checklist: `docs/PUBLIC_CORE_LAUNCH_CHECKLIST.md`
- Announcement template: `docs/ANNOUNCEMENT_v1.0.0.md`
- Security policy: `SECURITY.md`
- Contributing guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`

## Notes

- Default DB path is managed automatically from session ID.
- `TALK_SESSION` and `TALK_DB` can be used as defaults for operational commands.
- Sessions allow max 2 participants; recipient is inferred for `send` when both are known.
- Turn lifecycle is `queued -> delivered -> acked` with explicit recipient `ack`.
- Delivery attempts are logged and failed after 3 internal delivery errors.
- Scope is local-machine only for v1.
