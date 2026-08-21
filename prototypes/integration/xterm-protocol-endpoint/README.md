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
- Tested OSC `9002` Append, Update, and Extend Message bytes materialize
  `text/plain` Blocks in real xterm.js Buffer lines.
- Tested Append and Update Messages decoded from one input chunk retain their
  order while rendering is queued and materialize the updated Block.
- Growing and shrinking an earlier mutable Block keeps a later logical history
  row at the same viewport-relative position without duplicated or missing
  rows.
- A tested Extend keeps both a later Block being read and a pre-existing row
  in its own Block at the same viewport-relative position.
- A tested Extend with a stale content base returns
  `content_state_mismatch` and never enters the rendering queue.
- Resizing the tested Terminal reflows Block ranges while keeping the later
  history row being read at the viewport top; a subsequent earlier-Block
  Update preserves that position.
- When the viewport is already following the tail, growing an earlier Block
  and a tested resize keep it following the new tail.
- A tested Update rejected because its Block is sealed returns correlated
  `protocol.error` bytes and does not change rendered history.
- When a tested Update would grow xterm.js history beyond its available
  capacity, it returns correlated `resource_exhausted` bytes before changing
  either Session state or rendered history; a later fitting Update still
  succeeds.
- The same tested capacity rejection for Extend leaves both states unchanged
  and leaves the prior content base usable by a later fitting Extend.

These results provide experimental evidence for the reading-anchor and
tail-following requirements in [Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md).

## Capacity Boundary

Capacity-limited tests deliberately grow a Block through Update and Extend
beyond what the private xterm.js history spike can materialize. The integration
checks this known limit while the Operation is prepared, rejects it with
`resource_exhausted`, and leaves both Session state and xterm.js Buffer rows
unchanged.

The check uses the current plain-text Block layout model to predict the row
growth before Session commit. It closes the previously observed split-state
case for the tested ASCII content and dimensions; it is not evidence that all
renderer failures are detected before commit.

## Experimental Boundaries

- xterm.js history replacement still uses private core fields and is not a
  proposed public API or production implementation.
- Incoming bytes go directly to the protocol-only endpoint. Ordinary terminal
  data, a real terminal parser, PTY, multiplexer, and remote transport are not
  part of this experiment.
- Known Update and Extend capacity exhaustion is checked before Session commit,
  but accepted Operations still render asynchronously afterward. The prototype
  does not provide general failure atomicity, recovery, backpressure, or
  partial-rendering handling for other renderer failures.
- Context and Block IDs are combined into an internal rendering key. The key
  is an implementation fixture and has no wire-level meaning.
- Context closure has no separate visual effect in this renderer; rejected
  later Operations remain enforced by the Session.
- ReplaceSuffix is not implemented yet, so the tested positive Capability path
  is not evidence that this renderer implements the complete current baseline.
- Scrollback-capacity trimming and Update of the Block containing the reading
  anchor remain unsupported by the private history spike. The integration
  rejects only the tested capacity-overflow case instead of trimming.
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
