# xterm Protocol Endpoint Integration Prototype

This integration prototype asks whether the current protocol endpoint can
drive mutable terminal-owned xterm.js history while preserving the reading
behavior defined by the protocol drafts.

It composes:

- the [terminal protocol endpoint](../protocol-endpoint/README.md), which
  decodes OSC `9002` Message bytes and executes them through the protocol
  Session; and
- the [xterm-headless feasibility spike](../../xterm-headless/README.md), whose
  deliberately private core path can replace materialized Block ranges in an
  xterm.js Buffer.

Only Block Operations accepted by the Session enter an ordered rendering
queue. Tests await `drain()` before observing the resulting xterm.js history.

## Proven

- Tested Capability and Context control bytes establish a supported protocol
  path before Block Operations are sent.
- Tested OSC `9002` Append and Update Message bytes materialize `text/plain`
  Blocks in real xterm.js Buffer lines.
- Growing and shrinking an earlier mutable Block keeps a later logical history
  row at the same viewport-relative position without duplicated or missing
  rows.
- When the viewport is already following the tail, growing an earlier Block
  keeps it following the new tail.
- A tested Update rejected because its Block is sealed returns correlated
  `protocol.error` bytes and does not change rendered history.

These results provide experimental evidence for the reading-anchor and
tail-following requirements in [Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md).

## Experimental Boundaries

- xterm.js history replacement still uses private core fields and is not a
  proposed public API or production implementation.
- Incoming bytes go directly to the protocol-only endpoint. Ordinary terminal
  data, a real terminal parser, PTY, multiplexer, and remote transport are not
  part of this experiment.
- Session acceptance occurs before asynchronous rendering. The prototype does
  not prove failure atomicity between Session state and renderer failures,
  backpressure, partial rendering, or recovery.
- Context and Block IDs are combined into an internal rendering key. The key
  is an implementation fixture and has no wire-level meaning.
- Context closure has no separate visual effect in this renderer; rejected
  later Operations remain enforced by the Session.
- Scrollback-capacity trimming and Update of the Block containing the reading
  anchor remain unsupported by the private history spike.
- Resize/reflow, selection, search, content metadata, active input, browser
  rendering, and real user interaction are not exercised here.

## Run

```sh
pnpm typecheck
pnpm test
```
