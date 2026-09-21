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

An experimental `XtermTerminalAdapter` owns the conversion from accepted
protocol Operations to the Block-history model, the internal Context-and-Block
key, capacity preparation, and the ordered rendering queue. Only Block
Operations committed by the Session are accepted by this adapter. Tests await
`drain()` before observing the resulting xterm.js history.

An optional experimental parser addon registers OSC `9002` with the xterm.js
parser and forwards completed payloads to the same endpoint. Its framing and
ordering restrictions are recorded under Experimental Boundaries below.

A separate experimental raw mixed-stream ingress asks the reference decoder
to preserve ordinary bytes, then executes ordinary xterm.js writes and
completed protocol events through one asynchronous queue. Its experimental
native-control observer covers the bounded line erase, display erase,
scrollback clear, and full-reset cases listed below.

## Observed Behavior

- Tested Capability and Context control bytes establish a supported protocol
  path before Block Operations are sent.
- Tested OSC `9002` Append, Update, Extend, and ReplaceSuffix Message bytes
  materialize `text/plain` Blocks in real xterm.js Buffer lines.
- In a tested parser-addon path, ordinary startup output remains visible while
  a Capability query split across two xterm.js writes is consumed without
  displaying its carrier bytes. Capability and Context responses reach the
  tested response callback, and subsequent Append and Update Messages reach
  both Session state and rendered history.
- A tested invalid OSC `9002` payload produces a framing diagnostic, is not
  displayed, and does not prevent later ordinary output from being displayed.
- In one tested raw chunk, Append A renders before following ordinary text,
  Append B starts on a terminal-supplied line boundary after that text, and
  explicit Block ranges exclude the intervening unmanaged row. A later Update
  of A moves the ordinary row and B together without replacing either one.
- In one retained ASCII fixture, the user places a complete unmanaged row at
  the viewport top while reading history. Growing and then shrinking an earlier
  Block keeps that same row at the viewport top, moves the later Block range by
  the corresponding row delta, and leaves the Context open.
- Two tested mixed-stream `push()` calls retain the same order even when the
  caller starts the second before awaiting completion of the first render.
- In one tested near-capacity stream containing two Blocks and intervening
  unmanaged rows, an unsafe earlier-Block growth returns `resource_exhausted`
  without changing the Block snapshot or xterm.js rows; a later fitting Update
  still succeeds. The same result is tested with repeated wide CJK characters.
- A tested full-line erase and rewrite confined to the unmanaged tail executes
  normally, leaves its Context open, and permits a later Update.
- Erasing a tested alternate-screen row does not invalidate a Context whose
  Block remains in normal-screen history; that Block can still be updated.
- A tested cursor move followed by full-line erase of a managed Block executes
  normally, invalidates that Block's Context without sealing it, and causes an
  Update later in the same mixed chunk to return `context_not_open`.
- A tested erase from the cursor to the end of a managed row preserves the
  row's prefix, invalidates its Context, and causes a following Update to
  return `context_not_open`.
- A tested erase from the start of a managed row through the cursor preserves
  the row's suffix, invalidates its Context, and causes a following Update to
  return `context_not_open`.
- With Blocks from two Contexts interleaved, erasing one Context's first Block
  invalidates that Context and retires both of its managed ranges. The other
  Context retains its range and can still Update, while the unaffected sibling
  content remains visible as unmanaged history.
- In separate tested cases, clearing a normal-screen viewport invalidates a
  Context whose Block it erases, while clearing scrollback invalidates the
  Context whose old Block is removed and leaves a current viewport Block's
  Context usable for both a fitting Update and a later correlated capacity
  rejection. The removed Block is retired from the managed range index.
- Clearing scrollback also retires the removed Block range of an already closed
  Context without changing its closed state or poisoning a later capacity
  check for another open Context.
- A tested full terminal reset invalidates both Contexts that own the two
  rendered Blocks, retires both managed ranges, clears the tested xterm.js
  Buffer, and does not Seal either Block.
- Closing an invalidated Context through the same mixed ingress returns a
  correlated `context.close.response` with `context_not_open` and does not
  Seal its mutable Block.
- In a tested pair of Contexts, the same Block ID produces separate rendered
  ranges, and updating one Context's Block leaves the other unchanged.
- Tested Append and Update Messages decoded from one input chunk retain their
  order while rendering is queued and materialize the updated Block.
- Growing and shrinking an earlier mutable Block keeps a later logical history
  row at the same viewport-relative position without duplicated or missing
  rows.
- A tested Extend keeps both a later Block being read and a pre-existing row
  in its own Block at the same viewport-relative position.
- A tested Extend with a stale content base returns
  `content_state_mismatch` and never enters the rendering queue.
- A tested ReplaceSuffix keeps a retained-prefix row in place, maps a row in
  the removed suffix to the replacement boundary, and preserves a later Block
  being read when the target's rendered height changes.
- A tested invalid ReplaceSuffix boundary returns
  `invalid_content_boundary` and never enters the rendering queue.
- Resizing the tested Terminal reflows Block ranges while keeping the later
  history row being read at the viewport top; a subsequent earlier-Block
  Update preserves that position.
- When the viewport is already following the tail, growing an earlier Block
  and a tested resize keep it following the new tail.
- A tested Update rejected because its Block is sealed returns correlated
  `protocol.error` bytes and does not change rendered history.
- When a tested Update would grow xterm.js history beyond its available
  capacity, it returns correlated `resource_exhausted` bytes without changing
  Block content or rendered history; a later fitting Update still succeeds.
- The same tested capacity rejection for Extend leaves Block content and
  rendered history unchanged and leaves the prior content base usable by a
  later fitting Extend.
- The equivalent tested rejection for ReplaceSuffix leaves Block content and
  rendered history unchanged and leaves the prior content base usable by a
  fitting replacement.
- In one tested capacity-aligned Update, the required trim removes exactly one
  complete oldest Block. A later history row being read stays at the viewport
  top, and a following Extend from the same input chunk still renders.
- When the same complete-Block trim removes the Block being read, the tested
  viewport moves to the next retained Block and remains in history-reading
  state instead of following the tail.
- In one no-pending-render, dedicated managed-history fixture, an ASCII Append
  trims exactly one complete oldest Block. A later capacity-aligned Update
  trims the next complete Block, demonstrating that the first trim removed its
  stale range entry before the second trim was planned and rendered.

These results provide experimental evidence for the reading-anchor and
tail-following requirements in [Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md).

## Capacity Boundary

Capacity-limited tests deliberately grow a Block through Update, Extend, and
ReplaceSuffix beyond what the private xterm.js history spike can materialize.
The integration checks this known limit while the Operation is prepared,
rejects it with `resource_exhausted`, and leaves Block content and xterm.js
Buffer rows unchanged. As with other rejected Operations, its Operation ID
remains used under the protocol replay rules.

When no earlier render is pending, the check projects the replacement against
the xterm.js Buffer's current physical row count, including unmanaged rows.
If the exact excess cannot be removed as complete leading Blocks, it rejects
the Operation before Block mutation. ASCII and basic CJK use the pinned width
fixture for exact row estimates; other printable scalars retain a conservative
two-cell estimate. If that estimate alone crosses capacity, the Operation is rejected
rather than using an inexact count to schedule trimming. The tested ASCII and
repeated-CJK cases now reject before Session commit and keep content and rendered
rows unchanged.

A separate tested path permits normal trimming only when the exact required
row count consists of complete oldest Blocks and the changed or newly appended
Block remains retained. The private xterm range index removes those Block
ranges, preserves a surviving history-reading position, or moves a removed
position to the next retained Block without following the tail. The accepted
Append fixture additionally requires no earlier render to be pending, a
dedicated contiguous managed layout, and an exact fixture row count (ASCII in
the tested Append case). It trims one
complete leading Block; a following tested Update trims the next one. Later
queued rendering remains ordered. Append layouts that fail these preconditions,
including ones containing unmanaged rows, return `resource_exhausted` when
trimming would be required. Partial-Block and unmanaged-row eviction remain
unsupported. The range index discards evicted rows; Session retains logical
snapshots and identities. Later content changes to an evicted Block are covered
under Eviction and Unrecoverable Rendering Failure below.

## Experimental Boundaries

The [trial content corpus](../../../docs/design/trial-content-samples.md) records
additional Buffer-text checks and explicit unsupported-Tab rejection cases.
Optional [resource budgets](../../../docs/design/trial-resource-budgets.md) bound
retained Session structures and owned pending input; they do not supply memory
reclamation or general Unicode mapping.

The [plain-text tests](plain-text.test.ts) additionally exercise normalized
CR/LF/CRLF, visible control labels, host Tab alignment, raw scalar positions
across content-changing Operations, and a CRLF pair split between Append and
Extend. The [capacity tests](capacity.test.ts) include rejection before state
mutation when control-label expansion would exceed the available rows. Six
additional cases combine Update, Extend, and ReplaceSuffix with Tab or ESC
expansion at a full five-row Buffer: rejection leaves raw content and rows
unchanged, and a smaller Extend still accepts the original content-state ID.
A queued case fills the remaining row with a Tab expansion, rejects the next
ESC expansion, and then successfully applies ReplaceSuffix using the accepted
Tab Operation's ID.
The shared [projection](../../xterm-headless/plain-text.ts) uses `<U+XXXX>`
labels and fixed logical-line Tab stops from the host's `tabStopWidth` option.
Those are terminal fixtures for [Plain Text Content](../../../docs/protocol/plain-text.md),
not prescribed label spellings or tab widths. Session retains the original
text; ordinary frame-external control execution is unchanged.

The same plain-text tests exercise Chinese beside Tabs at `9` columns through
Append, Extend, ReplaceSuffix, and Update, checking rendered rows and raw Session
content. A capacity test rejects Chinese/Tab growth beyond three available rows
without changing content or its base ID; a smaller Extend then succeeds.
The [browser Chinese scenarios](../xterm-browser-protocol-endpoint/scenarios/plain-text-chinese.ts)
separately test selection and copy through resize and subsequent Operations.
The [search-offset tests](search-projection.test.ts) check a browser-search
helper against real headless Buffer cells; they do not run browser search.
The composed endpoint's [Chinese search cases](../xterm-browser-protocol-endpoint/scenarios/chinese-search.ts)
supply that separate browser evidence.

The [browser endpoint](../xterm-browser-protocol-endpoint/README.md) separately
tests projected-text growth that evicts one complete oldest Block, preserving
an unaffected reading position and Tab copy source or clearing an evicted one.

- `XtermTerminalAdapter` and its xterm.js private-core access are experimental
  integration interfaces.
- Most tests still send incoming bytes directly to the protocol-only endpoint.
  The parser-addon tests add one narrow real-parser path, but a PTY,
  multiplexer, remote transport, and bidirectional connection are not part of
  this experiment.
- The xterm.js OSC handler exposes only a completed payload, not its original
  terminator or intervening stream events. The addon always reconstructs an
  ST-ended frame for the current codec, so it cannot enforce the ST-only rule
  and would treat an otherwise valid BEL-ended payload as ST-ended. It also
  cannot observe ordinary output or another control between Message fragments
  and would continue rather than interrupt that assembly. The positive tests
  therefore use single-frame Messages, and this addon is not a complete
  mixed-stream ingress.
- Only the raw mixed-stream ingress waits for each accepted Block render before
  executing later stream traffic. Ordering against adjacent ordinary bytes
  remains unverified for the synchronous OSC addon.
- The explicit private Block ranges exclude the one tested intervening
  unmanaged row. Arbitrary terminal controls, styled or image output, and
  Unicode layout beyond the listed repeated-CJK and Chinese/Tab cases remain
  untested.
- The mixed-stream ingress and the protocol-only `push()` entry point must not
  be mixed on one endpoint, either concurrently or sequentially. Protocol-only
  pushes bypass the mixed ingress's single ordering queue and can enter a
  planned-only capacity check while unmanaged rows are present.
- Control-label projection is tested for the defined C0/DEL/C1 ranges, not all
  Unicode formatting or bidirectional characters. Tab stops are held fixed
  while content is retained; runtime Tab-setting changes are not tested.
- Accepted Operations render asynchronously after Session commit. A thrown
  render stops the endpoint as detailed below. General rollback and recovery
  are not implemented.
- Capacity preflight counts expanded controls and Tabs. It aligns Tabs beside
  basic CJK ideographs `U+4E00..U+9FFF` under the pinned default Unicode provider
  and rejects Tabs beside other Unicode. Conservative estimates for unmapped
  Unicode may reject a layout xterm could fit.
  The [Chinese capacity browser cases](../xterm-browser-protocol-endpoint/scenarios/chinese-capacity.ts)
  exercise one Update-driven complete-Block eviction with the basic-CJK fixture;
  the [Chinese Append browser cases](../xterm-browser-protocol-endpoint/scenarios/chinese-append-capacity.ts)
  add one exact two-row eviction arrangement. Three [queued Node cases](capacity.test.ts)
  check Update/Extend/ReplaceSuffix-triggered Chinese eviction, rejection of an
  edit to the evicted Block, and a retained content chain before rendering drains.
- The adapter combines Context and Block IDs into an internal rendering key.
  The key is an implementation fixture and has no wire-level meaning.
- Context closure has no separate visual effect in this renderer; rejected
  later Operations remain enforced by the Session.
- Native-control invalidation is demonstrated only for the listed `CSI 0 K`,
  `CSI 1 K`, `CSI 2 K`, `CSI 2 J`, `CSI 3 J`, and `ESC c` sequences and the tested
  alternate-screen isolation case. The line-erase observer is deliberately
  row-granular rather than cell-exact, so erasing only unchanged blank cells on
  a managed row can conservatively invalidate its Context. `CSI 0 J`, `CSI 1 J`,
  selective erase, character or line insertion and deletion, scrolling
  regions, printable overwrite, soft reset, `scrollOnEraseInDisplay: true`, and
  other alternate-buffer effects remain unproven.
- The headless mixed-stream reading-anchor case uses one retained ASCII row
  at the viewport top while an earlier Block grows and shrinks. Other unmanaged
  anchor positions and their resize/capacity interactions need further checks.
- The positive Capability result remains a configured host assertion, not
  evidence that this headless experiment satisfies the complete terminal
  baseline.

### Browser Evidence

`@xterm/headless` 6.0.0 exposes no selection service. The separate
[selection](../xterm-browser-selection/README.md) and
[search](../xterm-browser-search/README.md) experiments apply Operations directly
to browser history. The [browser protocol endpoint](../xterm-browser-protocol-endpoint/README.md)
adds encoded OSC Messages, Session execution, and native-state checks, including
mixed-output selections. That record lists the tested ASCII/basic-CJK/Tab
layouts, resize dimensions, and complete-Block eviction cases.

## Updating the Block Being Read

The [anchored-Update tests](anchored-update.test.ts) exercise growth, shrinkage,
same-height and empty replacement while the viewport reads the target Block.
The host moves reading toward the replacement's first row, clamped to the
available viewport range. This is a prototype choice under the
[existing draft](../../../docs/protocol/terminal-native-behavior.md#4-updating-the-anchored-block),
not a mapping of old text into new content or a prescribed terminal UX.

Seven Node cases check exact retained rows, queued Extend and subsequent resize,
one exact complete-leading-Block eviction, unchanged content/reading/base after
capacity rejection, and shrinking below one screen. The last case checks blank
screen rows and the native cursor; once all content fits, the physical viewport
also lies at the tail. The prototype does not retain a separate off-tail intent
in that arrangement. Existing Extend and ReplaceSuffix mappings are unchanged.
Three composed ASCII [browser cases](../xterm-browser-protocol-endpoint/scenarios/anchored-update.ts)
add selection/copy/search checks and ordinary output after shrinking below one
screen.

## Eviction and Unrecoverable Rendering Failure

[Evicted-Block checks](evicted-block.test.ts) exercise a fully trimmed mutable
Block: Update, Extend, and ReplaceSuffix return `resource_exhausted`, leave
content unchanged, and never restore its range. Consumed Operation IDs and the
old Block ID cannot be reused. A fresh Block can display the content when
capacity permits; freeing capacity does not revive the old identity. The
prototype still retains logical snapshots and does not reclaim their memory.

[Fault-injection checks](fatal-render.test.ts) deliberately write partial native
output and throw during rendering. The adapter aborts the endpoint, skips later
queued rendering, and reports the failure through `drain()` or mixed `push()`.
Future input and `finish()` reject rather than declaring successful closure.
Mixed ingress also stops queued ordinary bytes and control requests. No normal
`internal_error` or fatal wire notification is generated. Hosts must observe
the rejection and retire the affected connection/renderer; this code neither
clears the partial output nor restarts the host.

Protocol-only batches may already have committed later logical Operations
before asynchronous rendering fails. Their diagnostic snapshots are not proof
of rendering completion and cannot be reused as live state. The tests verify
stopping and isolation of a separate endpoint, not rollback, recovery, real
failure frequency, or detection of a renderer that silently corrupts state.

## Run

```sh
pnpm typecheck
pnpm test
```
