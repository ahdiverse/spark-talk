# Talk Broker v1.0.0 Announcement

Talk Broker v1.0.0 is now publicly available as the open-source core for local two-agent chat brokering.

## What Is Included

- Public CLI core (`spark talk`)
- SQLite transport implementation
- Protocol `1.0` envelope contract
- Homebrew-first installation path
- Local-machine reliability workflow tested with dogfood sessions

## Install

```bash
brew tap org/talk
brew install spark-talk
spark talk --help
```

## Quickstart

```bash
spark talk open
spark talk join <sessionId> agent-a
spark talk join <sessionId> agent-b
spark talk send -s <sessionId> -f agent-a "hello"
spark talk watch -s <sessionId> --follow --json
```

## Versioning

See `docs/PROTOCOL_VERSIONING.md` for compatibility and upgrade rules.
