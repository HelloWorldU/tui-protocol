# tui-protocol

An experiment in mutable, anchored content for terminal-native TUI
applications.

Modern TUIs ask more of terminals: earlier messages should remain easy to
revisit even when they continue to change. This project explores a contract
where applications describe logical content and terminals retain control of
rendering and history. The vision is to work with historical messages as
identifiable components—somewhat like updating nodes in a document—without
giving up the native terminal experience.

This project is an early research prototype, not a standard or a stable
protocol.

## Milestones

- **2026-07-31:** Initialized the repository and documented the protocol's
  motivation and goals.
- **2026-08-01:** Defined the initial Block and Operation model and added its
  first executable prototype.
- **2026-08-04:** Connected experimental OSC Operations to mutable xterm
  history end to end.
- **2026-08-09:** Documented the initial logical Message model, JSON
  serialization, and OSC framing.
- **2026-08-10:** Added the first TypeScript reference codec and an in-memory
  terminal-side protocol session for deterministic Message execution.
- **2026-08-12:** Connected the codec and session into a terminal-side byte
  path, including correlated responses for schema-invalid Messages with
  reliable identities.
- **2026-08-13:** Defined the initial terminal-native behavior for reading
  anchors, reflow, selection, search, content metadata, and active input across
  Block changes and scrollback-capacity trimming, then connected protocol bytes
  to mutable xterm.js history in the first end-to-end reading-anchor experiment.
- **2026-08-14:** Extended the xterm.js integration experiment to preserve its
  tested history-reading and tail-following states across resize and reflow.
- **2026-08-17:** Connected prepared Operations to an xterm.js capacity check,
  so the tested oversized historical Update returns `resource_exhausted`
  without splitting Session state from rendered history.

## Documentation

- [Documentation index](docs/README.md)
- [RFC 0001: Mutable Terminal History and Reading Anchors](docs/rfcs/0001-mutable-terminal-history-and-reading-anchors.md)
- [Prior art and project evidence](docs/prior-art.md)

## The problem

Dynamic TUI applications often need to revise earlier output as content
streams, finalizes, or reflows. At the same time, users expect the terminal's
native history and its surrounding ecosystem to keep working.

The project explores whether a terminal protocol can provide all three of
these properties together:

1. Preserve terminal-owned scrollback and the native terminal capabilities
   built around it.
2. Update or reflow dynamic content after it has left the active screen.
3. Keep the user's reading position anchored to logical content when output
   continues or content above it changes.

Ordinary terminal protocols expose an editable active screen, while the
terminal owns scrollback as physical character rows. Once output enters that
history, an application generally cannot address it by stable content
identity, mutate it safely, or express which logical content should remain
visually anchored.

## License

[MIT License](LICENSE)
