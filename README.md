# tui-protocol

An experiment in mutable, anchored content for terminal-native TUI
applications.

## Status

This project is an early research prototype, not a standard or a stable
protocol. The first goal is to make the missing terminal semantics concrete
and testable before choosing a wire format.

## The problem

Dynamic TUI applications often need to revise earlier output as content
streams, finalizes, or reflows. At the same time, users expect the terminal's
native history and its surrounding ecosystem to keep working.

The project explores whether a terminal protocol can provide all three of
these properties together:

1. Preserve native scrollback, scrolling, selection, copy, search,
   multiplexers, SSH, and accessibility.
2. Update or reflow dynamic content after it has left the active screen.
3. Keep the user's reading position anchored to logical content when output
   continues or content above it changes.

Ordinary terminal protocols expose an editable active screen, while the
terminal owns scrollback as physical character rows. Once output enters that
history, an application generally cannot address it by stable content
identity, mutate it safely, or express which logical content should remain
visually anchored.

## Minimal hypothesis

Rather than replacing the terminal model, the initial investigation focuses
on the smallest potentially useful extension:

- capability negotiation;
- stable block identity;
- opening and updating mutable content;
- committing content so it becomes immutable;
- logical reading anchors or a terminal-defined anchoring policy;
- readable plain-text fallback for unsupported terminals;
- provenance and authorization rules for historical mutation.

The operation names and encoding are intentionally undecided.

## First prototype

The first decisive demo will pair a small producer with a prototype terminal:

1. Produce enough content to create native history.
2. Scroll up and read a logical message.
3. Change a block above that message from four physical rows to three.
4. Keep the message at the same visual reading position.
5. Leave the current history correct, with no duplicated or missing rows.
6. Avoid destructive history clearing and forced follow-to-bottom behavior.
7. Preserve readable output in an unsupported terminal.

This provides a concrete comparison with both classic normal-screen renderers
and application-owned alternate-screen viewports.

## Prior art

Before defining a new wire format, the project will evaluate at least:

- OSC 133 semantic prompt, command, and output boundaries;
- DomTerm OSC 72/721 keyed insertion and replacement;
- SpaceTerm Terminal Block Protocol (TBP) v1.

The outcome may be an extension of, interoperability with, or a clearly
defined difference from existing work.

## Contributing

Early contributions are most useful when they sharpen requirements, document
observable invariants, add deterministic reproductions, or compare terminal
extension points. Please avoid treating any proposed encoding as settled.

## License

Licensed under the [MIT License](LICENSE).
