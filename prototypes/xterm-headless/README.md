# xterm-headless OSC Spike

This spike connects the in-memory
[Block model](../block-model/README.md) to the real `@xterm/headless` parser.
It validates that an OSC sequence can carry experimental Block Operations
across a tested split write boundary.

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
- The private range index records start and exclusive-end markers around the
  physical rows xterm.js actually materialized. Tests cover carriage-return
  normalization and one wide-character wrapping case; the composed xterm
  endpoint separately covers one intervening unmanaged row.
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
and currently materialize the resulting complete Block range.
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
- Plain text only. The shared [projection](plain-text.ts) normalizes newlines,
  expands Tabs at host-selected logical-line stops, and renders other
  C0/DEL/C1 controls as visible `<U+XXXX>` labels without executing them.
  [Projection tests](plain-text.test.ts) enumerate those controls and check
  selected ASCII offset round trips and Chinese/Tab coordinates against actual
  xterm cells; the [composed endpoint](../integration/xterm-protocol-endpoint/README.md)
  records runtime evidence for [Plain Text Content](../../docs/protocol/plain-text.md).
  Labels and tab-stop implementation are experimental terminal choices. Mapping
  supports ASCII and basic CJK ideographs `U+4E00..U+9FFF` using a narrow width
  fixture checked against the pinned xterm default Unicode provider (`6`).
  Tabs alongside other Unicode remain unsupported by capacity preflight.
  General grapheme handling and runtime Unicode-provider changes are not tested.
- The standalone spike assumes a dedicated terminal. The composed xterm
  endpoint separately tests one narrow unmanaged-output gap and rejects one
  unsafe near-capacity growth against the Buffer's physical row count before
  Block mutation. The pinned basic-CJK width fixture covers one repeated-CJK
  rejection case. A [private-history test](private-core-history.test.ts) also
  checks Chinese/Tab Update growth evicting exactly a two-row oldest Block while
  preserving later rows. Unmapped Unicode estimates cannot authorize eviction.
  Safe eviction across mixed managed and unmanaged history and arbitrary
  mixed output remain outside this spike.
- Complete Update of the Block containing the viewport anchor uses a local
  replacement-start policy, clamped to the available viewport. The
  [composed endpoint checks](../integration/xterm-protocol-endpoint/README.md#updating-the-block-being-read)
  record its tested behavior. This is not an old-to-new content mapping or a
  protocol-mandated navigation policy. Shrinkage below one screen preserves
  blank screen rows and adjusts the following native cursor position.
- The private range index supports one tested trimming boundary: exact removal
  of complete oldest Blocks. It preserves a surviving reading position and
  moves a removed one to the next retained Block without following the tail.
  Its Append path accepts trimming only with no pending render, a dedicated
  contiguous managed layout, an exact fixture row count, and an excess composed
  exactly of complete leading Block ranges. The composed endpoint tests one
  such Block, followed by an Update that trims the next Block after stale range
  bookkeeping has been removed. When trimming would be required, Append layouts
  that fail those preconditions use the conservative `resource_exhausted` path;
  other exact Append arrangements remain unproven. Partial-Block trimming is
  unsupported; later content mutation of a fully trimmed Block is rejected
  without restoring it by the [composed endpoint](../integration/xterm-protocol-endpoint/README.md#eviction-and-unrecoverable-rendering-failure). The composed
  Session also retains the logical snapshot after this private range index
  drops rendered rows.
- Browser rendering and selection behavior are not exercised by headless
  tests. The separate [browser selection
  experiment](../integration/xterm-browser-selection/README.md) exercises
  complete-Update, single-line ASCII ReplaceSuffix, and two resize/reflow
  selection scenarios for that boundary in browser-hosted xterm.js. It also
  covers both selection outcomes when the tested capacity path evicts one
  complete oldest Block and selection preservation across Extend, Append, and
  Seal. A separate [browser search
  experiment](../integration/xterm-browser-search/README.md) checks Search
  behavior across Block Operations, resize/reflow, and the same tested
  complete-Block capacity boundary.

## Run

```sh
pnpm test
pnpm typecheck
```
