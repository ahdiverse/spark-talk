# Changelog

All notable changes to this project are documented in this file.

## [1.0.0] - 2026-02-22

### Added

- Stable public-core release for `spark talk` local broker workflow.
- Session lifecycle commands for open/join/close flows.
- Recipient acknowledgement command: `spark talk ack`.
- SQLite-backed turn relay with durable turn IDs and lifecycle timestamps.
- Homebrew packaging workflow and formula generation scripts.
- Phase 3 dogfood harness and reporting artifacts.
- Public protocol and versioning policy in `docs/PROTOCOL_VERSIONING.md`.
- Public install documentation and launch announcement docs.

### Notes

- Homebrew is the primary install path.
- npm remains a secondary install path.
- Local SQLite remains default transport for v1.
- Turn lifecycle supports `queued -> delivered -> acked`, with failed delivery after max retry attempts on internal broker errors.
