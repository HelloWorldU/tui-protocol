# Pi stock-UI protocol trial

## Question and status

Can Pi 0.87.1's stock `InteractiveMode` keep its editor, footer, and status
while the transcript (user prompts, assistant text, one tool type) is owned by
protocol Blocks through the experimental xterm host?

This is the Path B trial from the
[design draft](../../../docs/design/pi-stock-ui-trial.md). It composes the real
`InteractiveMode`, `AgentSessionRuntime`, and transcript component classes from
the published Pi 0.87.1 packages (pin `2b0a123`); no Pi files are modified.

**Status, 2026-10-03: Path B works end to end.** With the experimental
region-aware history mode wired on the protocol path, all four browser
checks pass through the real ConPTY/xterm host: one turn with the editor
accepting input during streaming, cancel mid-stream plus a further turn, a
60/36/60 resize round trip, and the stock fallback. Node-level integration
adds negotiation-negative, lifecycle, and input-routing edge cases. On
2026-10-19 the same checks passed with styled assistant Blocks, plus a fifth
that verifies Pi's styling in the painted cells. The
2026-09-28 boundary failure that motivated host region ownership is kept
below for the record.

**Status, 2026-10-16: assistant Blocks carry Pi's real styling when the
terminal confirms `text/styled`.** A follow-up experiment on the same
composition: the event adapter renders each assistant message through Pi's
own `AssistantMessageComponent` and sends the visible result as span lists,
so markdown emphasis, thinking, and error styling reach the terminal as
`text/styled` content instead of being flattened to the trial's plain text.
User and tool Blocks stay `text/plain`; Block content types mix freely
inside one Context. See [Styled transcript content](#styled-transcript-content).

## Layout

| File | Responsibility |
| --- | --- |
| `main.ts` | Child entry: fixture model, trial runtime, fail-stop on latched failure. |
| `application.ts` | Composition root: negotiation before UI start; stock fallback or gate+bridge activation. |
| `render-gate.ts` | Trial flag and the `prototype.render` wraps (the patch report). |
| `terminal.ts` | Trial-owned pi-tui `Terminal`: chrome passthrough, OSC 9002 input splitting, escape timeout. |
| `bridge.ts` | Second `session.subscribe` listener; per-turn Context lifecycle with serialized work; picks the styled path from `client.supportsStyledContent`. |
| `event-adapter.ts` | Pi event → Block Operation mapping (matches the pi-session trial, plus multi-user runs); span-level diffing for styled Blocks. |
| `styled-renderer.ts` | Renders assistant messages through Pi's real `AssistantMessageComponent` and normalizes the SGR lines into `text/styled` spans. |
| `session-source.ts` | Isolated real Pi 0.87.1 runtime through the public composition; one read-only tool; in-memory session/settings. |
| `fixtures/` | Deterministic local provider and the fixed sample text; optional fragment overrides for styled checks. |
| `wrap-sample.ts`, `wrap-experiment.ts`, `wrap-probe.ts`, `wrap-baking.test.ts` | Wrap-baking experiment: Pi's layout at one width versus terminal reflow at others. |
| `lines-from-render.ts`, `lines-probe.ts`, `lines-layout.test.ts` | RFC 0003 check: Pi's wide render as `text/lines`, laid out by the [line layout engine](../../line-layout/README.md), against Pi's own render. |
| `record-ansi.ts` | Records one stock-mode turn's raw ConPTY output as the SDK's real-output ANSI fixture. |
| `fake-host.ts` | In-process terminal host for Node tests (chrome recorder + real endpoint + reply path), with an xterm-backed endpoint variant. |
| `stock-ui.test.ts`, `render-gate.test.ts`, `terminal.test.ts`, `bridge.test.ts` | Focused Node checks; the stock-ui suite is also the plain-text fallback path. |
| `styled-content.test.ts`, `styled-test-env.ts` | Styled-mode Node checks; the env module forces chalk color emission for deterministic style assertions. |
| `vite.config.ts`, `browser.ts`, `index.html`, `checks.html`, `checks.ts` | PTY bridge and the experimental xterm host page on port 4181. |

## Patch report

No Pi source files are changed. The trial wraps `render(width)` on exactly
eight transcript component classes from `@earendil-works/pi-coding-agent@0.87.1`
(pin `2b0a123`), returning zero lines while the trial flag is active and
delegating otherwise:

`AssistantMessageComponent`, `UserMessageComponent`, `ToolExecutionComponent`,
`SkillInvocationMessageComponent`, `BashExecutionComponent`,
`CompactionSummaryMessageComponent`, `BranchSummaryMessageComponent`,
`CustomMessageComponent`.

Chrome classes (editor, footer, status, widgets, dialogs) are never wrapped;
the structured report prints at startup. Pi itself ships a precedent for a
zero-line render switch (`ToolExecutionComponent.hideComponent`).

## Node evidence, 2026-09-28

`pnpm typecheck`, 21 focused tests, all 317 repository Node tests, and the
browser build pass. The focused tests cover:

- the gate wraps exactly the eight render methods, once, defaults to stock,
  and flips behavior only with the flag;
- trial flag off: no protocol bytes cross and the transcript renders in the
  chrome stream;
- negotiation negative: only the capability query crosses, no Context opens,
  the transcript stays in the chrome stream;
- negotiation positive: the transcript seals into Blocks and the chrome stream
  carries no transcript text;
- cancel mid-stream seals the partial assistant Block with an abort label, and
  a second turn completes;
- typing into the editor during streaming reaches Pi and echoes in the chrome
  stream; resize re-renders chrome without disturbing sealed Block state;
- input splitting: keystrokes pass untouched and in order around reply frames,
  a reply frame split across chunks arrives exactly once, a lone Escape is
  released after the escape timeout, terminal color-query replies stay
  ordinary input, an OSC prefix lookalike stays ordinary, a BEL-terminated
  protocol frame fails as protocol input rather than editor input, and input
  typed before the UI starts replays in order;
- a compaction event is outside this trial and fails instead of being hidden.

## Browser evidence

2026-10-03, automated `checks.html` through Windows bundled ConPTY and the
experimental xterm host, with the region-aware history mode on the protocol
path — **all four scenarios passed**:

1. One turn completes with the transcript in four sealed Blocks; the editor
   accepted input during streaming; transcript text appears exactly once in
   native rows.
2. Cancel mid-stream keeps a sealed partial Block with an abort label; the
   tool never runs; the editor stays responsive; a further prompt completes.
3. A 60/36/60 column round trip keeps sealed Blocks, exactly one copy of
   each transcript line, a live editor, and non-blank chrome. Pi's resize
   emits a full screen+scrollback clear; the host re-materializes the Blocks
   afterwards instead of invalidating the Context.
4. With the trial flag off, Pi renders its own transcript through the same
   host and no protocol state appears.

The scenarios synchronize on stable states (an open Context, a sealed
Block) rather than transient ones, and each scenario can set its own fixture
pacing (`?pace=<ms>`; the cancel scenario uses 2400 ms so an automated
Escape lands mid-stream).

2026-10-19, the same `checks.html` with `browser.ts` advertising
`text/styled`, so assistant Blocks travel as span lists — **all five
scenarios passed**: the four above, now on the styled path, plus

5. With the markdown fixture text (`?demo=1`), Pi's own styling reaches the
   painted xterm cells: the DOM renderer paints the `**…**` phrase with
   `xterm-bold`, the surrounding prose without it, and the inline code in its
   own color (Pi's dark-theme `mdCode`, `rgb(138, 190, 183)`); the Blocks'
   logical text carries no markdown markers. The paint holds at 36 columns
   and after returning to 60.

Scenario 2 on the styled path exposed a stale assumption: a real Escape ends
the assistant Block with Pi's default `Operation aborted` label, not the
`Cancelled by user` text the Node fixture provider sets. The check now
accepts `[aborted]` (plain) or `Operation aborted` (styled).

The DOM renderer paints only visible rows, and Chrome pauses painting in a
hidden page or an off-screen iframe; scenario 5 scrolls the terminal into
view, and the page must be visible while it runs.

### Earlier record, 2026-09-28 (manual, before region ownership)

- **Stock fallback passes** through the real ConPTY/browser path.
- **Protocol path fail-stops at the boundary**: after the user Block sealed
  and the assistant Block opened, Pi's chrome redraw erased rows inside
  adapter-owned Block territory; the mixed-ingress watchdog invalidated the
  Context as designed and the child exited 1. This was the first observed
  two-writer conflict and motivated region ownership.
- Correction: the automated checks at that time timed out for a different
  reason — they submitted before Pi's startup finished and never retried.
  The conflict above was observed on the manual path, and the checks now
  wait for the turn to actually start.

## Region ownership: the resolved host feature

The 2026-09-28 conflict was structural: Blocks and chrome share one
coordinate space and Pi's absolute cursor math cannot see adapter-inserted
rows. The fix is the experimental
[region-aware history mode](../xterm-protocol-endpoint/README.md#region-ownership-experimental)
from the [region-ownership design](../../../docs/design/host-region-ownership.md):
a passive app-region estimate confines the application's ANSI drawing to its
own rows, cursor compensation after every Block materialization keeps the
application's frame math valid, the watchdog stays armed for genuine
conflicts, and application resize clears re-materialize the Blocks instead
of invalidating Contexts. This trial's `browser.ts` wires the mode on the
protocol path only; the stock fallback registers nothing.

## Styled transcript content

When the terminal confirms `text/styled` during negotiation
(`client.supportsStyledContent`), the bridge hands the event adapter an
assistant span renderer and assistant Blocks go out as span lists; user and
tool Blocks stay `text/plain`. Without the confirmation the trial is
byte-for-byte the plain mapping, which is what the stock-ui Node suite
exercises.

The renderer is Pi's own, not a copy: `styled-renderer.ts` keeps one
`AssistantMessageComponent` (exported from the published
`@earendil-works/pi-coding-agent` package root, same source as the render
gate's report), feeds it each message snapshot via `updateContent`, and
calls `render(width)` offscreen. The render gate suppresses Pi's transcript
UI through a prototype wrap that would also catch this instance, so the
renderer lifts the gate for its own synchronous render call; the gate file
itself is unchanged. The component is constructed with `outputPad` 0 so no
chrome gutter becomes logical text; each rendered line then goes through the
SDK's `spansFromAnsi` (SGR → spans, OSC 133 zone markers and other non-SGR
sequences discarded), trailing width padding is trimmed per line, the outer
spacer lines are dropped, and lines join through `"\n"` spans behind an
unstyled `Assistant:\n` label span. Pi's theme emits emphasis through chalk,
whose color level follows the process TTY: on the real PTY child the SGR
attributes are present; in Node tests `styled-test-env.ts` forces
`FORCE_COLOR=3` and truecolor capabilities before chalk loads, or bold and
italic would silently vanish from the rendered lines.

Updates diff at span granularity: when the previous spans form an exact
content prefix of the next render (a boundary span may grow with unchanged
style) the tail goes out as one Extend — the common streaming case. A
re-render that restyles earlier text (for example a completing `**bold**`
marker) shortens the span-exact common prefix and the update degrades to a
ReplaceSuffix whose retain counts the shared prefix's logical scalars, using
`spanPrefix`/`spanDrop` from the terminal module. The render width comes
from a `() => number` provider wired from `TrialTerminal.columns` through
the bridge into the adapter, so width is read at each render.

Node evidence, 2026-10-16: `styled-content.test.ts` adds 8 checks — pure
streaming growth emits Extend only and its logical text equals the
plain-mode transcript; thinking content keeps Pi's italic thinkingText
style; an error end carries Pi's own error label in the error color;
markdown `**bold**`, `` `code` ``, and `*italic*` become the corresponding
spans; a restyling re-render degrades to ReplaceSuffix at the span-exact
prefix; user and tool Blocks stay `text/plain` inside a styled Context. Two
checks run the full trial against the fake host with the xterm endpoint and
a real `@xterm/headless` buffer: the fixture turn keeps the plain text
projection row for row with `text/styled` assistant Blocks, and a
markdown-marked fixture variant lands bold cells, italic cells, and the dark
theme's code color at the expected buffer positions while its logical text
still equals the marker-free plain transcript.

Known divergences from the plain mapping, all consequences of adopting Pi's
rendered projection as the logical text:

- Thinking content renders with Pi's italic thinkingText style and no
  `[Thinking]` label; the plain mapping's label exists only in plain mode.
- Abort, error, and truncation ends show Pi's own labels (`Operation
  aborted` for a real Escape, the provider's message such as the Node
  fixture's `Cancelled by user` otherwise, `Error: …`) in the error color
  instead of the plain `[aborted] …` suffix.
- Markdown constructs appear in their displayed form: `**bold**` arrives as
  a bold `bold` span, so the logical text of markdown-heavy messages differs
  from the plain mapping's raw text. For the prose-only fixture the two
  projections are identical.
- Line wrapping is baked at the render width: the logical text carries the
  newlines of the width-60/80 render, and a later narrower width re-flows
  those already-split lines. This is the tension between renderer-owned
  layout and terminal-owned reflow that the experiment exists to expose;
  the browser resize scenario is where to watch it.

## Wrap-baking experiment

`wrap-baking.test.ts` renders a fixed markdown sample (`wrap-sample.ts`)
through the same `AssistantMessageComponent` at 60 columns and at a wide
1000 columns, appends each as a styled Block through the xterm endpoint, and
compares the native rows after resizing with Pi's own layout at the display
width (`wrap-experiment.ts`; `wrap-probe.ts` prints the table). Seven checks
pass, 2026-10-19:

- a render at the display width reproduces Pi's layout row for row;
- shown at 36 columns, the 60-column render keeps 17 of Pi's 29 rows, with 6
  mid-word splits and 3 list or quote continuations missing their prefix;
  shown at 100 it keeps its 60-column breaks, 5 rows more than Pi;
- the wide render carries only content breaks (the 60-column render adds 6),
  so a paragraph copies as one line, but the terminal's cell-based reflow
  splits words and drops continuation prefixes at every narrower width;
- Pi's rule, drawn at a fixed length, spills onto extra rows when narrower.

Neither width choice reproduces Pi's layout once the display width changes.
The analysis and the layout capabilities this points to are in
[Renderer-owned layout and reflow](../../../docs/design/renderer-layout-and-reflow.md).

## Run

From the repository root (Windows, Node 24+, pnpm 11.9.0):

```sh
pnpm prototype:pi-stock-ui
# http://127.0.0.1:4181/              protocol path (completes a fixture turn)
# http://127.0.0.1:4181/?stock=1      stock fallback
# http://127.0.0.1:4181/?pace=2400    slower fixture stream (long cancel window)
# http://127.0.0.1:4181/?demo=1       markdown fixture text (visible styling)
# http://127.0.0.1:4181/checks.html   the five automated scenarios (keep the page visible)
pnpm typecheck
pnpm test
pnpm build:pi-stock-ui
```

`record-ansi.ts` re-records the SDK's real-output ANSI fixture: one stock-mode
turn with the markdown text through bundled ConPTY at 60x24, with the temp
working directory replaced by `<trial-cwd>`.

```sh
node prototypes/integration/pi-stock-ui/record-ansi.ts sdk/test/fixtures/pi-0.87.1-stock-turn.ansi
```

## Limits

- Kitty keyboard negotiation is not performed (`kittyProtocolActive` stays
  false); editor keys beyond typing, Enter, Escape, and Backspace are
  unverified.
- Local deterministic provider only; no live model, credentials, or network.
- Windows bundled ConPTY only; 60x24 viewport in the browser fixture.
- The render gate keeps transcript components updating offscreen (wasted
  per-token work), accepted for the smallest behavioral delta. The styled
  path adds one offscreen render per message event on top.
- User and tool Blocks stay `text/plain` even when the terminal confirms
  `text/styled`; only assistant messages carry styling.
- The styled Block's logical text is the rendered projection: thinking has
  no `[Thinking]` label, abort/error ends use Pi's own labels, and markdown
  constructs appear in displayed form. See the divergences list in
  [Styled transcript content](#styled-transcript-content).
- Rendered wrapping is baked into the logical text at the current width;
  narrower reflow afterwards splits those lines again. The
  [wrap-baking experiment](#wrap-baking-experiment) measures the cost.
- The styled browser check samples three paint attributes (bold, its
  absence on prose, and the code color) on one fixture message; thinking,
  error styling, and other themes are covered by Node buffer checks only.
- A resize clear re-materializes Blocks, but a reading anchor, an active
  selection, or search-match positions across the clear are best-effort or
  lost; the active search term survives via save/restore.
- Session replacement (`/new`, resume, fork) and compaction are out of scope
  and fail the trial instead of being hidden.

Related: [design draft](../../../docs/design/pi-stock-ui-trial.md),
[styled text content draft](../../../docs/protocol/styled-text.md),
[Pi rendering architecture](../../../docs/design/pi-rendering-architecture.md),
[pi-session trial](../pi-session/README.md),
[terminal host example](../../../examples/terminal-host/README.md),
[xterm protocol endpoint](../xterm-protocol-endpoint/README.md).
