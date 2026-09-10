# Shared protocol code

This directory owns message types, validation, serialization, and framing shared
by TUI and Terminal implementations. `docs/protocol/` owns the design drafts;
moving code here does not make the API stable or the drafts normative.

- Keep `src/` independent of SDK, prototype, renderer, and transport code.
- Maintain one shared implementation rather than consumer-specific copies.
- Keep tests under `test/`, with concrete behavior names and bounded claims.
- For semantic changes, consult the corresponding draft and update affected
  documentation. Do not infer protocol changes from a directory refactor.
- Run root `pnpm typecheck` and `pnpm test`; verify affected browser consumers
  when changing browser-facing imports or behavior.
