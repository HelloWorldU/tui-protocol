# tui-protocol

Exploring a terminal protocol for dynamic TUIs in the age of AI agents.

As AI agents develop, terminal interfaces need to support more than a stream
of output: content is generated, revised, and finalized throughout an ongoing
interaction. Traditional terminal control remains useful, but does not fully
express the content model these dynamic applications need.

Our vision is for applications to work with terminal content as identifiable,
updatable components—somewhat like updating nodes in a document—while terminals
retain responsibility for rendering, history, and native interaction. This
project explores the protocol contract that could make that possible.

This project is an early research prototype, not a standard or a stable
protocol.

## Milestones

- **2026-08-01 - Protocol primitives:** Defined the initial Block and Operation
  primitives for mutable, identifiable terminal content.
- **2026-08-12 - Executable protocol path:** Established the first complete
  terminal-side path from framed Messages through codec and Session execution
  to deterministic state changes and correlated responses.
- **2026-08-14 - End-to-end validation:** Validated protocol-driven mutation of
  xterm.js-owned history while preserving the tested reading-anchor and
  tail-following behavior across resize and reflow.

## Documentation

- [Documentation index](docs/README.md)
- [RFC 0001: Mutable Terminal History and Reading Anchors](docs/rfcs/0001-mutable-terminal-history-and-reading-anchors.md)
- [Prior art and project evidence](docs/prior-art.md)

## The problem

Applications manage meaningful content with an identity and a lifecycle;
traditional terminal interaction primarily expresses character output and
screen operations. The terminal does not generally receive the information
needed to distinguish a revision of existing content from a redraw of rows.

This mismatch becomes more visible as interactions remain active and content
changes over time. Updating earlier output without duplicating history, or
preserving a user's reading position while content changes, are manifestations
of that gap—not separate problems to solve with another redraw algorithm.

We want applications to express what content changes, while terminals decide
how to present it without giving up their native capabilities. The
[RFC](docs/rfcs/0001-mutable-terminal-history-and-reading-anchors.md) develops
this responsibility boundary and its initial scope.

## Goals

The project explores whether a terminal protocol can provide all three of
these properties together:

1. Preserve terminal-owned scrollback and the native terminal capabilities
   built around it.
2. Update or reflow dynamic content after it has left the active screen.
3. Keep the user's reading position anchored to logical content when output
   continues or content above it changes.

## License

[MIT License](LICENSE)
