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
- Resizing the tested Terminal reflows Block ranges while keeping the later
  history row being read at the viewport top; a subsequent earlier-Block
  Update preserves that position.
- When the viewport is already following the tail, growing an earlier Block
  and a tested resize keep it following the new tail.
- A tested Update rejected because its Block is sealed returns correlated
  `protocol.error` bytes and does not change rendered history.

These results provide experimental evidence for the reading-anchor and
tail-following requirements in [Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md).

## Observed Failure Boundary

One capacity-limited test deliberately grows a Block beyond what the private
xterm.js history spike can materialize. The Session accepts the Update and
stores its new snapshot, then `drain()` reports the renderer failure while the
xterm.js Buffer retains its old rows.

This result demonstrates that the current composition is not failure-atomic
across Session state and rendering. It is a characterized prototype gap, not
selected protocol behavior. A later design must either make acceptance and
materialization one transaction or define a recovery path that restores a
consistent rendered projection.

## Experimental Boundaries

- xterm.js history replacement still uses private core fields and is not a
  proposed public API or production implementation.
- Incoming bytes go directly to the protocol-only endpoint. Ordinary terminal
  data, a real terminal parser, PTY, multiplexer, and remote transport are not
  part of this experiment.
- Session acceptance occurs before asynchronous rendering. The prototype does
  not provide failure atomicity, recovery, backpressure, or partial-rendering
  handling; the capacity-limited test above exposes the resulting split state.
- Context and Block IDs are combined into an internal rendering key. The key
  is an implementation fixture and has no wire-level meaning.
- Context closure has no separate visual effect in this renderer; rejected
  later Operations remain enforced by the Session.
- Scrollback-capacity trimming and Update of the Block containing the reading
  anchor remain unsupported by the private history spike.
- `@xterm/headless` 6.0.0 exposes no selection service or selection API, so
  selection and copying require a future browser-host experiment. Search,
  content metadata, active input, browser rendering, and real user interaction
  are also not exercised here. Resize/reflow evidence is limited to the tested
  dimensions, plain-text content, and viewport-top anchor.

## Run

```sh
pnpm typecheck
pnpm test
```
