# Pi stock-UI protocol trial

## Question and status

Can Pi 0.87.1's stock `InteractiveMode` keep its editor, footer, and status
while the transcript (user prompts, assistant text, one tool type) is owned by
protocol Blocks through the experimental xterm host?

This is the Path B trial from the
[design draft](../../../docs/design/pi-stock-ui-trial.md). It composes the real
`InteractiveMode`, `AgentSessionRuntime`, and transcript component classes from
the published Pi 0.87.1 packages (pin `2b0a123`); no Pi files are modified.

**Status, 2026-09-28: the Pi-side composition works; the host side cannot yet
mix chrome drawing with Block-owned history.** In Node-level integration the
stock UI runs with the transcript sealed into Blocks and the chrome stream
carrying no transcript text, and the stock fallback completes a full turn
through the real ConPTY/browser host. In the protocol browser run, Pi's chrome
redraw erases land inside adapter-owned Block rows; the host invalidates the
Context as designed, and the trial fail-stops. That failure is the draft's
central boundary-coordination unknown observed running; host-side region
ownership is the next work item.

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

`pnpm typecheck`, 21 focused tests, all 304 repository Node tests, and the
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

## Browser evidence, 2026-09-28 (manual, Windows bundled ConPTY)

- **Stock fallback passes.** With the trial flag off (`?stock=1`), the real
  ConPTY/browser path runs stock Pi 0.87.1: the fixture turn completes, Pi
  renders its own transcript and chrome, and no protocol state appears.
- **Protocol path fail-stops at the boundary.** Negotiation succeeds and the
  patch report prints; the user prompt seals as Block `pi-1`; the assistant
  Block `pi-2` opens mutable. Pi's chrome redraw (the Working indicator and
  editor box) then erases rows that the adapter has placed inside Block
  territory; the mixed ingress — which watches `CSI K` / `CSI J` / `ESC c` —
  invalidates the Context as designed, the next Operation is rejected, and
  the child fail-stops with exit 1. `checks.html` scenario 1 times out at
  "assistant Block streaming" for this reason; scenarios 2–4 did not run.

## The central finding: region ownership is the missing host feature

The mixed ingress invalidates any Context whose Block rows intersect a native
erase. That defense is correct — it refuses silent transcript corruption. The
conflict is structural: Blocks and chrome share one coordinate space, Pi's
renderer positions its chrome by absolute cursor math that cannot see the
rows the adapter inserted for Blocks, and its erase lands inside them. All
previous trials avoided this because the application emitted protocol frames
only; this is the first trial with two live writers on one screen.

The missing host feature is an app-owned region: a defined screen region
(here, the chrome at the bottom) where native erases do not invalidate
Contexts, with Block growth relocating the region and resize reflowing it.
That is significant terminal-side work and was not attempted in this
skeleton; the design is drafted in
[terminal-host region ownership](../../../docs/design/host-region-ownership.md),
and the acceptance scenarios 1–3 in the design draft remain unmet until it
exists.

## Run

From the repository root (Windows, Node 24+, pnpm 11.9.0):

```sh
pnpm prototype:pi-stock-ui
# http://127.0.0.1:4181/         protocol path (fail-stops as documented above)
# http://127.0.0.1:4181/?stock=1 stock fallback (completes a fixture turn)
# http://127.0.0.1:4181/checks.html
pnpm typecheck
pnpm test
pnpm build:pi-stock-ui
```

## Limits

- Kitty keyboard negotiation is not performed (`kittyProtocolActive` stays
  false); editor keys beyond typing, Enter, and Escape are unverified.
- Local deterministic provider only; no live model, credentials, or network.
- Windows bundled ConPTY only; 60x24 viewport in the browser fixture.
- The render gate keeps transcript components updating offscreen (wasted
  per-token work), accepted for the smallest behavioral delta.
- Session replacement (`/new`, resume, fork) and compaction are out of scope
  and fail the trial instead of being hidden.
- `checks.html` currently fails at scenario 1 for the documented reason; the
  file is retained so the scenarios run unchanged once region ownership exists.

Related: [design draft](../../../docs/design/pi-stock-ui-trial.md),
[Pi rendering architecture](../../../docs/design/pi-rendering-architecture.md),
[pi-session trial](../pi-session/README.md),
[terminal host example](../../../examples/terminal-host/README.md),
[xterm protocol endpoint](../xterm-protocol-endpoint/README.md).
