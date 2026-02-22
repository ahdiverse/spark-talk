# Public Core Launch Checklist (Phase 4)

## Scope

Phase 4 from `purpose.md`:

1. Open-source core repository.
2. Publish docs and protocol versioning policy.
3. Tag `v1.0.0` and announce install instructions.

## Repository Readiness

- [x] Apache-2.0 license present
- [x] Contributing guide present (`CONTRIBUTING.md`)
- [x] Security policy present (`SECURITY.md`)
- [x] Code of conduct present (`CODE_OF_CONDUCT.md`)
- [x] Changelog entry for `1.0.0`
- [x] Protocol versioning policy published (`docs/PROTOCOL_VERSIONING.md`)
- [x] Install docs published (`docs/INSTALL.md`)
- [x] Announcement template published (`docs/ANNOUNCEMENT_v1.0.0.md`)

## Release Steps

1. Verify build/tests:
   - `npm run build`
   - `npm test`
2. Publish release artifact:
   - `npm run release:build`
3. Generate formula:
   - `npm run release:formula -- --repo ahdiverse/spark-talk --tag v1.0.0 --output homebrew/Formula/spark-talk.rb`
4. Tag release:
   - `git tag v1.0.0`
   - `git push origin v1.0.0`
5. Publish announcement using `docs/ANNOUNCEMENT_v1.0.0.md`.
