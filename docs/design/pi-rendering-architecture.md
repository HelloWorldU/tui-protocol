# Pi Rendering Architecture and Candidate Integration Boundaries

Read-only research note, 2026-09-20. Upstream facts below refer to
[earendil-works/pi at `3390bd9`](https://github.com/earendil-works/pi/tree/3390bd93630965a12a0a1a5c36ce890ec22f7e1d),
whose coding-agent package declares version 0.86.1. This is a static trace of
the interactive CLI and selected SDK/RPC interfaces, not a full repository
audit, executed Pi trial, or compatibility claim. Recommendations are ours,
not upstream decisions or new protocol requirements.

## 1. The Overall Path

Pi separates agent execution from presentation. The default interactive CLI
connects them through session events; `pi-tui` lays out components and updates
the terminal. It is a UI library inside Pi, not the terminal emulator.

```text
User prompt
  -> InteractiveMode -> AgentSession -> Agent / model runtime / tools
                            |
                     session events
                            v
                     InteractiveMode
                            |
             assistant, tool, editor, footer components
                            |
                  pi-tui layout and renderer
                            |
              ProcessTerminal -> process stdout
                            |
                 terminal transport (often PTY)
                            |
                     terminal emulator
```

The last two stages describe the normal deployment boundary, not a transport
implemented by `pi-tui`. In particular, Pi's `Terminal` interface is a process
I/O abstraction; it is not our terminal-side Session or history adapter.

| Part | Responsibility on this path |
| --- | --- |
| `coding-agent/main.ts` | Resolve services/settings/session and choose interactive, RPC, or print mode. |
| `AgentSessionRuntime` | Own the active session and its services; replace them on session switches and rebind the UI. |
| `AgentSession` | Connect agent events, extension hooks, session persistence, and application operations. |
| `pi-agent-core` and model runtime | Drive model streaming and tool execution; emit message/tool events. |
| `InteractiveMode` | Turn those events into changes to chat components and coordinate editor, status, widgets, and commands. |
| `pi-tui` | Render components at a width, handle input/focus, and write terminal drawing instructions. |

Sources: [CLI composition][main], [runtime ownership][runtime],
[agent construction][sdk-source], [agent event production][agent-loop],
[session event delivery][session]. This diagram follows the CLI branch in
`main.ts`; it does not assume every package in Pi's monorepo participates in it.

## 2. Follow One Streaming Response

1. `InteractiveMode` submits input through `session.prompt(...)` and subscribes
   to session events. Model text/thinking/tool-call deltas are represented in
   `message_update`, alongside the current assistant message.
2. On assistant `message_start`, it creates an `AssistantMessageComponent`
   and adds it to `chatContainer`.
3. On `message_update`, it updates that component. Tool calls also create or
   update separate `ToolExecutionComponent` instances, keyed by tool-call ID.
4. On `message_end`, it supplies the final assistant content. Tool execution
   has its own start/update/end events and component updates.
5. These handlers call `ui.requestRender()`. `TuiBase` coalesces requests and
   schedules rendering; this is not one terminal write per model token.
6. Components implement `render(width): string[]`. The regular renderer
   compares rendered lines, constructs cursor/erase/output sequences, and
   writes through `Terminal.write(...)`; `ProcessTerminal` writes to stdout.

Sources: [interactive event handlers][interactive-events],
[assistant component][assistant], [component contract and scheduler][tui],
[main-screen rendering][main-screen], [process I/O][terminal].

Input runs the other way: `ProcessTerminal` reads stdin and separates input
sequences; `TuiBase` handles terminal replies/listeners and forwards remaining
input to the focused component. The editor/interactive mode interprets a
submission and calls the session. Resize requests another render. Thus input
parsing, protocol replies, editor focus, and output cannot be treated as wholly
independent channels ([process I/O][terminal], [TUI input handling][tui]).

## 3. Two Different History Strategies

The setting defaults to `regular`; `createInteractiveTui` selects the renderer
([default setting][settings], [renderer factory][renderer-factory]).

| Mode | What the inspected code does |
| --- | --- |
| `regular` / `TuiMainScreen` | Uses the main screen and terminal scrollback. Compares old/new lines; falls back to full redraw for width changes and changes above the previous viewport, among other conditions. Its clearing full redraw emits screen/home/scrollback erase sequences. |
| `fullscreen` / `TuiAltScreen` | Enters the alternate screen and manages viewport scrolling, selection, and transcript search inside the application; clipboard handling is wired by the coding-agent renderer factory. |

Sources: [regular rendering][main-screen], [fullscreen rendering][alt-screen].
These are implementation observations, not reproduced UX bugs. Fullscreen
does not mean selection/search are absent: Pi implements those interactions
itself rather than relying on the main-screen scrollback for that UI.

**Our inference:** the regular transcript is the closer first comparison for
our goal of terminal-owned mutable history. Replacing fullscreen behavior
would additionally change who owns those interactions.

## 4. Where We Could Connect

| Boundary | Available interface | Assessment for our project |
| --- | --- | --- |
| Session events | Pi SDK: `createAgentSession`, `session.subscribe`, `session.prompt` | Cleanest candidate for a small, separate protocol frontend. Preserves structured content, but does not reuse the stock interactive UI automatically. |
| Headless process | `pi --mode rpc`, JSONL commands/events over stdin/stdout | Another frontend boundary with process isolation. Pi RPC is not our terminal wire protocol; it needs a translator. Its documented extension-UI support is narrower than interactive mode. |
| Interactive presentation | `InteractiveMode`, components, `createInteractiveTui` | Best place to study reuse of the existing UI, but requires handling transcript/editor/layout coupling. The factory currently chooses two concrete renderers, not a documented third-party protocol backend. |
| Extension UI | Widgets, custom focused/overlay components, custom editor, tool/message renderers | Useful customization inside Pi's presentation system. These hooks do not by themselves replace the built-in assistant transcript renderer. |
| `Terminal.write` / stdout | Already-rendered strings and terminal commands | Useful for observing output; too late to directly obtain Block identity, logical content, or lifecycle. Not a semantic adapter by itself. |

Sources: [SDK documentation][sdk-doc], [RPC documentation][rpc-doc],
[extension UI/tool/message contracts][extensions], [renderer factory][renderer-factory].
The assessments in the last column are our inferences, not claims that these
interfaces have been integrated or that extensions cannot perform other work.

## 5. Couplings That Change the Integration Design

- **Logical content versus rendered rows.** The assistant component turns
  text/thinking into themed Markdown components, spacing, and sometimes OSC
  133 markers. Our baseline [plain text](../protocol/plain-text.md) executes
  neither ANSI drawing sequences nor Markdown. Copying `render(width)` output
  into a Block would not preserve Pi's UI semantics. A first trial should
  explicitly choose a plain-text projection, not silently strip styling and
  claim equivalent rendering ([assistant component][assistant]).
- **Generation end versus display lifetime.** Thinking visibility can still
  change after generation. Therefore `message_end` is not automatically a
  `Seal` for a Block whose visible content may later change. A restricted trial
  can omit folding, but must state that limitation ([assistant component][assistant]).
- **Transcript versus active controls.** Interactive mode composes chat with
  header, status, widgets, editor, and footer, and selects a fullscreen layout
  when appropriate. Sending transcript Blocks while leaving an unmodified
  regular renderer to redraw the same region risks conflicting writers. A
  later stock-UI integration needs explicit region/output ownership
  ([interactive composition][interactive-layout]).
- **Events versus output completion.** `AgentSession._emit` calls listeners
  without awaiting their returned work. An `async` subscriber alone does not
  backpressure model generation. A protocol frontend needs ordered output,
  bounded pending work or an explicit stop policy, and a plan for operation
  errors; our SDK's returned Operation ID means sent, not rendered
  ([session delivery][session], [our SDK contract](../../sdk/README.md#api-behavior)).
- **Session replacement versus Block identity.** `/new`, resume, and fork can
  replace the Pi session and rebind UI subscriptions. Trial-local Block IDs
  and our Context lifetime must be mapped explicitly, not assumed identical
  to Pi's persistence IDs ([runtime][runtime], [SDK runtime notes][sdk-doc]).
- **Replies versus keystrokes.** Pi already interprets keyboard-protocol and
  other terminal replies. Our negotiation/responses must be routed without
  feeding them into the editor or disrupting Pi's existing queries. Merely
  adding a second independent stdin listener is not a verified solution
  ([process I/O][terminal], [TUI input handling][tui]).

## 6. Recommended Next Step

Our recommendation is a **separate, finite Pi SDK frontend trial** first,
not an upstream patch or replacement of all `pi-tui` rendering. It offers a
small path from real Pi events to our current SDK without reverse-engineering
terminal drawing commands. It would prove that path only, not integration
with the stock Pi interactive UI or all Pi extensions.

Before coding, specify one mapping: one prompt, streamed assistant text,
one tool result, and completion/abort, using baseline plain text. Define
trial-owned Block IDs, when content remains mutable, error/queue handling,
and what happens without protocol support. Replay captured or synthetic
events first; a live model run would be a separate validation step.

Run it only in an explicitly supporting host, initially our experimental
[terminal host](../../examples/terminal-host/README.md). Pi-side changes
cannot add mutable history support to an arbitrary unmodified terminal.
Keep the [existing compatibility limits](next-stage-validation.md#remaining-work-and-decision-points)
visible. After that trial, assess whether a stock-UI integration is worth
the additional transcript/editor and rich-content work above.

No Pi code was changed, dependencies installed, model requests made, or Pi
tests run for this source investigation. That investigation established neither
Pi runtime behavior nor upstream acceptance. The research checkout is local under
`.tmp/pi-research`; the separate existing Pi checkout was left untouched.

Follow-up: the [Pi session experiment](../../prototypes/integration/pi-session/README.md)
retains the synthetic replay and now runs the pinned Pi SDK with local fixtures
and an opt-in OpenAI subscription source through ConPTY and the experimental
xterm host. Finite browser evidence covers completion/search and cancellation;
the record also preserves a model WebSocket failure and the explicit SSE choice.
Stock UI compatibility and Pi producer backpressure remain unproven.
This later experiment is separate from
the read-only source investigation above.

The subsequent [reading UX comparison](../../prototypes/integration/pi-session/ux/README.md)
records three fixed paired scenarios using actual `InteractiveMode` as the
regular baseline. It observes reading/selection differences for earlier-tool
shrink and resize, but not tail streaming. Capturing that baseline is not
integration of our protocol into Pi's stock UI, and the two frontends remain
different in features and presentation.

[main]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/main.ts#L736
[runtime]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/agent-session-runtime.ts
[sdk-source]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/sdk.ts#L368
[agent-loop]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/agent-loop.ts#L340
[session]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/agent-session.ts#L623
[interactive-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3243
[assistant]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/modes/interactive/components/assistant-message.ts
[tui]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/tui/src/tui.ts
[main-screen]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/tui/src/tui-main-screen.ts#L247
[terminal]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/tui/src/terminal.ts
[settings]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/settings-manager.ts#L1265
[renderer-factory]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/modes/interactive/tui-renderer.ts
[alt-screen]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/tui/src/tui-alt-screen.ts
[sdk-doc]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/docs/sdk.md
[rpc-doc]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/docs/rpc.md
[extensions]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/extensions/types.ts
[interactive-layout]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L549
