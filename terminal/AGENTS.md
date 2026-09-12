# Terminal module guidance

This directory owns transport-independent terminal protocol execution, not a
renderer. Keep `src/` dependent only on shared `protocol/` code, never on the
TUI SDK, prototypes, xterm, or PTY libraries. Protocol drafts remain authoritative;
the module and adapter API are experimental and unpublished.

Keep host capability assertions, synchronous preparation/commit, asynchronous
rendering limitations, and mixed-input ownership explicit in documentation.
Use concrete test names and bounded evidence. Run root type checking, tests,
the isolated build check, and affected browser examples after changes.
