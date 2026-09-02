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
parser and forwards completed payloads to the same endpoint. It is a narrow
bridge experiment, not yet a complete mixed-stream ingress implementation.

A separate experimental raw mixed-stream ingress asks the reference decoder
to preserve ordinary bytes, then executes ordinary xterm.js writes and
completed protocol events through one asynchronous queue. Its experimental
native-control observer covers the bounded line erase, display erase,
scrollback clear, and full-reset cases listed below.

## Proven

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
the Operation before Block mutation. Non-ASCII scalars use a conservative
two-cell upper bound so the check cannot undercount the tested wide-character
case. If that upper bound alone crosses capacity, the Operation is rejected
rather than using an inexact count to schedule trimming. This closes the
previously observed split-state cases for the tested ASCII and repeated-CJK
content and dimensions; it is not evidence that all renderer failures are
detected before Block mutation.

A separate tested path permits normal trimming only when the exact required
row count consists of complete oldest Blocks and the changed Block remains
retained. The private xterm range index removes those Block ranges, preserves
a surviving history-reading position, or moves a removed position to the next
retained Block without following the tail. Later queued rendering remains
ordered. This is a narrow feasibility result, not a general trimming
implementation.

## Experimental Boundaries

- xterm.js history replacement still uses private core fields and is not a
  proposed public API or production implementation.
- `XtermTerminalAdapter` is an integration-prototype boundary, not a stable or
  proposed Terminal API.
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
- The synchronous OSC addon still does not prove ordering against adjacent
  ordinary bytes. Only the separate raw mixed-stream ingress waits for each
  accepted Block render before executing later stream traffic.
- The explicit private Block ranges exclude the one tested intervening
  unmanaged row. Arbitrary terminal controls, styled or image output, and
  Unicode layout beyond the listed repeated-CJK case remain untested.
- The mixed-stream ingress and the protocol-only `push()` entry point must not
  be mixed on one endpoint, either concurrently or sequentially. Protocol-only
  pushes bypass the mixed ingress's single ordering queue and can enter a
  planned-only capacity check while unmanaged rows are present.
- The private renderer does not yet define a safe physical projection for
  C0 or C1 controls inside `text/plain`, apart from its modeled CR/LF line
  breaks. Such payloads are outside this experiment and must not be mistaken
  for frame-external native traffic.
- Known Update, Extend, and ReplaceSuffix capacity exhaustion is checked before
  Session commit, but accepted Operations still render asynchronously
  afterward. The prototype does not provide general failure atomicity,
  recovery, backpressure, or partial-rendering handling for other renderer
  failures.
- The capacity preflight accounts for current unmanaged rows in the tested
  no-pending-render case, but it does not implement or prove safe eviction of
  unmanaged rows. Mixed capacity layouts beyond the listed conservative
  rejection remain unproven. Its current non-ASCII upper bound may reject a
  layout that xterm.js could fit, and capacity preflight conservatively rejects
  a mutation whose resulting `text/plain` contains unsupported C0 or C1
  controls other than the modeled CR/LF line breaks.
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
- The mixed-stream reading-anchor evidence is limited to one retained ASCII
  row at the viewport top while an earlier Block grows and shrinks. Other
  unmanaged anchor positions and resize/reflow or capacity interactions remain
  untested. A separate [browser endpoint
  composition](../xterm-browser-protocol-endpoint/README.md) exercises two
  20-column selection-and-copy fixtures with unwrapped printable-ASCII content,
  each across one managed/unmanaged boundary.
- The positive Capability result remains a configured host assertion, not
  evidence that this headless experiment satisfies the complete terminal
  baseline.
- Append-driven trimming, partial-Block trimming, and mutating a fully trimmed
  Block remain unsupported and outside the current evidence. The preflight
  permits trimming only within the tested complete-Block replacement boundary
  and requires no earlier render to be pending. Other detected capacity cases
  continue through the existing `resource_exhausted` path. Complete Update of
  the Block containing the reading anchor remains unsupported independently of
  capacity.
- The xterm.js Buffer and range index discard a trimmed Block's rendered rows,
  but the in-memory Session retains its logical snapshot. This experiment does
  not yet establish a protocol lifecycle for forgotten Blocks or demonstrate
  complete memory reclamation.
- `@xterm/headless` 6.0.0 exposes no selection service or selection API, so
  selection and copying are not exercised by the headless tests in this
  integration. A separate [browser-host
  experiment](../xterm-browser-selection/README.md)
  exercises complete-Update and single-line ASCII ReplaceSuffix selection
  cases, two resize/reflow cases, both complete-Block capacity eviction
  outcomes, and selection preservation across Extend, Append, and Seal without
  composing this endpoint. A separate [browser search
  experiment](../xterm-browser-search/README.md) checks Search behavior for
  Update, Extend, ReplaceSuffix, Append, Seal, resize/reflow, and the tested
  complete-Block capacity boundary without composing this endpoint. Content
  metadata, active input, mouse selection, and other real user interaction
  remain untested in this headless fixture. A [browser protocol endpoint
  experiment](../xterm-browser-protocol-endpoint/README.md) composes all five
  current Block Operation Messages encoded in OSC with reading position,
  selection, search, tail-following, lifecycle rejection, and active input
  checks. It also composes those browser states with the tested resize/reflow
  and Update-driven complete-Block capacity boundary. Selection evidence is
  limited to the listed printable-ASCII fixtures and tested dimensions.

## Run

```sh
pnpm typecheck
pnpm test
```
