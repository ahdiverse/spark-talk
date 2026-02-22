# Contributing

Thanks for contributing to Talk Broker.

## Development Setup

```bash
npm install
npm run build
npm test
```

## Pull Request Expectations

1. Keep changes scoped and documented.
2. Add or update tests for behavior changes.
3. Update docs when CLI contracts or protocol behavior changes.
4. Keep backward compatibility for protocol `1.x` unless explicitly shipping a major bump.

## Commit/PR Checklist

- [ ] Build passes: `npm run build`
- [ ] Tests pass: `npm test`
- [ ] Relevant docs updated
- [ ] Changelog updated for user-facing changes
