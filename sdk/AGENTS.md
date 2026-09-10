# SDK guidance

## Scope

This directory contains application-facing protocol APIs. The initial TypeScript
client is experimental and unpublished; protocol drafts remain the source of
semantic decisions. Prototype consumers belong under `prototypes/`.

## Changes and verification

- Keep transport ownership, fallback, and application decisions explicit.
- Document observable API behavior and limitations in the README; do not
  describe a sent Operation as terminal acceptance or rendered completion.
- Add focused tests for changed API behavior, using concrete scenario names.
- Run `pnpm typecheck` and `pnpm test` from the root. When changing the real
  PTY consumer, verify its guided browser scenario as well.
- Keep evidence claims bounded to the checks actually performed.
