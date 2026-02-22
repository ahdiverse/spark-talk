# Changelog

All notable changes to this project are documented in this file.

## [1.0.1] - 2026-02-22

### Fixed

- Enforced strict session/DB ownership:
  - one session ID can only attach to one DB path
  - one DB path can only belong to one session ID
- Prevented cross-DB split-brain behavior where agents used the same session ID on different DB files.

### Added

- Integration coverage for reverse DB ownership rejection (same DB reused by a different session ID).

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

### Changed

- Standardized project branding to Spark Talk in package metadata and docs.
- Updated security and conduct contacts to `sparktalk@ahdiverse.com`.
- Hardened Homebrew CI workflow by disabling auto-update and cleanup noise.

### Notes

- Homebrew is the primary install path.
- npm remains a secondary install path.
- Local SQLite remains default transport for v1.
- Turn lifecycle supports `queued -> delivered -> acked`, with failed delivery after max retry attempts on internal broker errors.
