# Protocol Versioning Policy

This document defines how `spark talk` protocol compatibility is managed for public-core releases.

## Current Version

- Protocol: `1.0`
- First stable release: `v1.0.0`

## Compatibility Rules

1. A broker and clients are compatible when they share the same major protocol version.
2. Patch updates (`1.0.x`) must not break payload shape, required fields, or command semantics.
3. Minor updates within major version `1` may add optional fields only.
4. Any removal, rename, required-field addition, or semantic change that can break existing clients requires a new major protocol version.

## Envelope Contract

All public transports must preserve these fields for protocol `1.0`:

- `protocolVersion`
- `sessionId`
- `turnId`
- `from`
- `to`
- `body`
- `replyToTurnId` (optional)
- `createdAt`
- `deliveredAt` (optional)
- `ackedAt` (optional)
- `status`
- `meta` (optional)

## Command Compatibility

For protocol `1.x`:

1. Existing commands must remain backward compatible:
   - `spark talk open`
   - `spark talk join`
   - `spark talk close`
   - `spark talk start`
   - `spark talk ack`
   - `spark talk send`
   - `spark talk watch`
   - `spark talk status`
2. New commands may be added, but existing command behavior cannot be broken.
3. New flags may be added if they are optional.

## Change Process

1. Update this policy and `README.md` when protocol behavior changes.
2. Add integration tests that validate compatibility for the changed path.
3. Record protocol-impacting changes in `CHANGELOG.md`.
4. For breaking changes, ship a migration guide and bump protocol major version.
