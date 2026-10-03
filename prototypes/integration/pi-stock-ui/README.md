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
adds negotiation-negative, lifecycle, and input-routing edge cases. The
2026-09-28 boundary failure that motivated host region ownership is kept
below for the record.

## Layout

| File | Responsibility |
| --- | --- |
| `main.ts` | Child entry: fixture model, trial runtime, fail-stop on latched failure. |
| `application.ts` | Composition root: negotiation before UI start; stock fallback or gate+bridge activation. |
| `render-gate.ts` | Trial flag and the `prototype.render` wraps (the patch report). |
| `terminal.ts` | Trial-owned pi-tui `Terminal`: chrome passthrough, OSC 9002 input splitting, escape timeout. |
| `bridge.ts` | Second `session.subscribe` listener; per-turn Context lifecycle with serialized work. |
| `event-adapter.ts` | Pi event → Block Operation mapping (matches the pi-session trial, plus multi-user runs). |
| `session-source.ts` | Isolated real Pi 0.87.1 runtime through the public composition; one read-only tool; in-memory session/settings. |
| `fixtures/` | Deterministic local provider and the fixed sample text. |
| `fake-host.ts` | In-process terminal host for Node tests (chrome recorder + real endpoint + reply path). |
| `stock-ui.test.ts`, `render-gate.test.ts`, `terminal.test.ts`, `bridge.test.ts` | Focused Node checks. |
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

## Run

From the repository root (Windows, Node 24+, pnpm 11.9.0):

```sh
pnpm prototype:pi-stock-ui
# http://127.0.0.1:4181/              protocol path (completes a fixture turn)
# http://127.0.0.1:4181/?stock=1      stock fallback
# http://127.0.0.1:4181/?pace=2400    slower fixture stream (long cancel window)
# http://127.0.0.1:4181/checks.html   the four automated scenarios
pnpm typecheck
pnpm test
pnpm build:pi-stock-ui
```

## Limits

- Kitty keyboard negotiation is not performed (`kittyProtocolActive` stays
  false); editor keys beyond typing, Enter, Escape, and Backspace are
  unverified.
- Local deterministic provider only; no live model, credentials, or network.
- Windows bundled ConPTY only; 60x24 viewport in the browser fixture.
- The render gate keeps transcript components updating offscreen (wasted
  per-token work), accepted for the smallest behavioral delta.
- A resize clear re-materializes Blocks, but a reading anchor, an active
  selection, or search-match positions across the clear are best-effort or
  lost; the active search term survives via save/restore.
- Session replacement (`/new`, resume, fork) and compaction are out of scope
  and fail the trial instead of being hidden.

Related: [design draft](../../../docs/design/pi-stock-ui-trial.md),
[Pi rendering architecture](../../../docs/design/pi-rendering-architecture.md),
[pi-session trial](../pi-session/README.md),
[terminal host example](../../../examples/terminal-host/README.md),
[xterm protocol endpoint](../xterm-protocol-endpoint/README.md).
