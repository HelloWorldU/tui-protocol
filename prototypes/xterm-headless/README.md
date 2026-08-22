# xterm-headless OSC Spike

This spike connects the in-memory
[Block model](../block-model/README.md) to the real `@xterm/headless` parser.
It validates that an OSC sequence can carry experimental Block Operations
through arbitrary write boundaries.

The spike deliberately uses OSC 777 with a JSON payload. Both the identifier
and encoding are temporary test fixtures, not the subsequently selected OSC
carrier and Base64 framing.

## Proven

- xterm.js can register a custom OSC handler through its proposed parser API
  when `allowProposedApi` is enabled.
- The handler can decode and validate Append, Update, and Seal Operations.
- Split writes are reassembled by the xterm.js parser before dispatch.
- Protocol and decoding failures can be isolated from the terminal write
  pipeline.
- Terminal resize events can drive reflow in the semantic Block model.
- A deliberately private core experiment can replace an existing Block's real
  xterm.js `BufferLine` range.
- When an earlier Block grows or shrinks, a later reading position and marker
  can remain attached to the same content without duplicating history.
- Marker-backed Block boundaries and a tested history-reading position survive
  terminal resize reflow and still identify the correct history range for a
  later Update.
- The experimental OSC transport and private-core mutation path work together:
  an in-band Update can replace real xterm.js history end to end.

## Public API Boundary

The public xterm.js buffer API is read-only. This addon can receive semantic
Operations, but it cannot replace rows already stored in xterm.js scrollback.
It therefore does not render Block content into the xterm buffer.

`private-core-history.ts` separately reaches through xterm.js private fields to
test the missing mutation. This is intentional prototype scaffolding, not an
API recommendation. It uses xterm.js markers as a resize-aware Block range
index. Its internal Extend and ReplaceSuffix projections are exercised by the
separate
[xterm protocol endpoint integration](../integration/xterm-protocol-endpoint/README.md)
and currently materializes the resulting complete Block range.
`private-core-osc-addon.ts` connects the older temporary OSC transport through
a deferred Operation queue.

The parser hook is also gated by `allowProposedApi` in xterm.js 6.0.0, so the
integration is suitable for a spike but not yet a stable compatibility layer.

A real terminal experiment will need a narrow xterm.js core hook that lets the
terminal associate logical Blocks with buffer content and re-layout affected
history while preserving the viewport anchor.

## Likely Core Integration Seam

Source inspection narrows the experiment to three layers:

1. `InputHandler` receives and validates the in-band Operation.
2. A core-owned Block store keeps Block identity, content, and lifecycle.
3. `BufferService` materializes a changed Block by atomically replacing its
   affected `BufferLine` range.

The third step is the missing xterm.js capability. Calling
`CircularList.splice` alone would be incorrect. A replacement may change the
number of physical rows, so the same transaction must also preserve or update:

- `ybase` and `ydisp`, including the reader's viewport anchor;
- the active and saved cursor positions;
- wrapped-line boundaries and buffer capacity trimming;
- markers, decorations, and OSC hyperlinks that follow line events;
- selections, which are stored in physical buffer coordinates;
- scroll and refresh notifications.

This suggests a narrow core experiment adjacent to `BufferService`, not a
general mutable public Buffer API. The Block store should remain the semantic
source of truth; xterm.js `BufferLine`s are its current materialization.

This is an implementation finding, not yet a protocol requirement. The private
experiment now provides a concrete test case against which a narrow core API
can be designed.

## Current Private-Core Limits

- The spike models one implicit Protocol Context and does not implement its
  control exchanges or Context IDs on Operations.
- Plain text only; terminal control sequences are not part of the experiment.
- A dedicated terminal owns all writes while Block ranges are tracked.
- Complete Update of the Block containing the viewport anchor remains
  undefined; the xterm integration separately exercises ReplaceSuffix's
  narrower mapping.
- The private range index supports one tested trimming boundary: exact removal
  of complete oldest Blocks. It preserves a surviving reading position and
  moves a removed one to the next retained Block without following the tail.
  Append-driven trimming, partial-Block trimming, and later mutation of a
  fully trimmed Block remain unsupported. The composed Session also retains
  the logical snapshot after this private range index drops rendered rows.
- Browser rendering and selection behavior are not exercised by headless
  tests. The separate [browser selection
  experiment](../integration/xterm-browser-selection/README.md) exercises
  complete-Update and single-line ASCII ReplaceSuffix scenarios for that
  boundary in browser-hosted xterm.js.

## Run

```sh
pnpm test
pnpm typecheck
```
