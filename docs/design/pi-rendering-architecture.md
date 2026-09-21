# Pi Rendering Architecture and Candidate Integration Boundaries

Source investigation, 2026-09-20, based on
[Pi 0.86.1 at `3390bd9`](https://github.com/earendil-works/pi/tree/3390bd93630965a12a0a1a5c36ce890ec22f7e1d),
tracing the interactive CLI, rendering path, and candidate SDK/RPC interfaces
for our protocol frontend. Integration assessments below are our design
judgments; subsequent experiments are linked at the end.

## 1. The Overall Path

Pi separates agent execution from presentation. The default interactive CLI
connects them through session events. Its `pi-tui` UI library lays out
components and emits drawing commands for the terminal emulator.

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

Pi's `Terminal` interface abstracts process I/O. `ProcessTerminal` connects it
to stdin/stdout; the deployment's transport carries those bytes to the terminal
emulator, where our terminal-side Session and history adapter would run.

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
[session event delivery][session].

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
   schedules rendering.
6. Components implement `render(width): string[]`. The regular renderer
   compares rendered lines, constructs cursor/erase/output sequences, and
   writes through `Terminal.write(...)`; `ProcessTerminal` writes to stdout.

Sources: [interactive event handlers][interactive-events],
[assistant component][assistant], [component contract and scheduler][tui],
[main-screen rendering][main-screen], [process I/O][terminal].

Input runs the other way: `ProcessTerminal` reads stdin and separates input
sequences; `TuiBase` handles terminal replies/listeners and forwards remaining
input to the focused component. The editor/interactive mode interprets a
submission and calls the session. Resize requests another render. Protocol
replies and keystrokes share the input parser, which routes them to query
handlers or the focused component ([process I/O][terminal],
[TUI input handling][tui]).

## 3. Two Different History Strategies

The setting defaults to `regular`; `createInteractiveTui` selects the renderer
([default setting][settings], [renderer factory][renderer-factory]).

| Mode | What the inspected code does |
| --- | --- |
| `regular` / `TuiMainScreen` | Uses the main screen and terminal scrollback. Compares old/new lines; falls back to full redraw for width changes and changes above the previous viewport, among other conditions. Its clearing full redraw emits screen/home/scrollback erase sequences. |
| `fullscreen` / `TuiAltScreen` | Enters the alternate screen and manages viewport scrolling, selection, and transcript search inside the application; clipboard handling is wired by the coding-agent renderer factory. |

Sources: [regular rendering][main-screen], [fullscreen rendering][alt-screen].

**Our inference:** the regular transcript is the closer first comparison for
our goal of terminal-owned mutable history. Replacing fullscreen behavior
would additionally change who owns those interactions.

## 4. Where We Could Connect

| Boundary | Available interface | Assessment for our project |
| --- | --- | --- |
| Session events | Pi SDK: `createAgentSession`, `session.subscribe`, `session.prompt` | Cleanest candidate for a small protocol frontend. Preserves structured content; presentation is supplied by the new frontend. |
| Headless process | `pi --mode rpc`, JSONL commands/events over stdin/stdout | Provides process isolation and requires translating Pi RPC into our terminal protocol. Its documented extension-UI support is narrower than interactive mode. |
| Interactive presentation | `InteractiveMode`, components, `createInteractiveTui` | Candidate for reusing the existing UI. Requires handling transcript/editor/layout coupling and extending a factory that currently selects two concrete renderers. |
| Extension UI | Widgets, custom focused/overlay components, custom editor, tool/message renderers | Useful customization inside Pi's presentation system. These hooks do not by themselves replace the built-in assistant transcript renderer. |
| `Terminal.write` / stdout | Already-rendered strings and terminal commands | Useful for observing output; explicit content identity and lifecycle are available at earlier layers. |

Sources: [SDK documentation][sdk-doc], [RPC documentation][rpc-doc],
[extension UI/tool/message contracts][extensions], [renderer factory][renderer-factory].

## 5. Couplings That Change the Integration Design

- **Logical content versus rendered rows.** The assistant component turns
  text/thinking into themed Markdown components, spacing, and sometimes OSC
  133 markers. Our baseline [plain text](../protocol/plain-text.md) executes
  neither ANSI drawing sequences nor Markdown. Copying `render(width)` output
  into a Block would not preserve Pi's UI semantics. A first trial can use a
  plain-text projection; retaining styled Markdown requires further content
  and rendering design ([assistant component][assistant]).
- **Generation end versus display lifetime.** Thinking visibility can still
  change after generation. Therefore `message_end` is not automatically a
  `Seal` for a Block whose visible content may later change
  ([assistant component][assistant]).
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
  and our Context lifetime need an explicit mapping to Pi's session lifecycle
  ([runtime][runtime], [SDK runtime notes][sdk-doc]).
- **Replies versus keystrokes.** Pi already interprets keyboard-protocol and
  other terminal replies. Our negotiation/responses need to join this routing
  so the editor receives keystrokes and each query handler receives its replies
  ([process I/O][terminal], [TUI input handling][tui]).

## 6. Recommended Next Step

The initial recommendation was a **separate, finite Pi SDK frontend trial**.
Session events preserve the structured content needed for a protocol adapter.
This lets us test the mapping before taking on Pi's existing editor, rich
presentation, and extension UI.

The proposed mapping covers one prompt, streamed assistant text, one tool
result, and completion/abort using baseline plain text. It needs trial-owned
Block IDs, content lifecycles, error/queue handling, and an unsupported-terminal
policy. Replay comes first, followed by a live model run.

The receiver must implement mutable history, initially through our experimental
[terminal host](../../examples/terminal-host/README.md). The
[validation plan](next-stage-validation.md#remaining-work-and-decision-points)
tracks subsequent integration choices and compatibility work.

## Subsequent Experiments

The [Pi session experiment](../../prototypes/integration/pi-session/README.md)
retains the synthetic replay and now runs the pinned Pi SDK with local fixtures
and an opt-in OpenAI subscription source through ConPTY and the experimental
xterm host. Finite browser evidence covers completion/search and cancellation;
the record also preserves a model WebSocket failure and the explicit SSE choice.

The [reading UX comparison](../../prototypes/integration/pi-session/ux/README.md)
records three fixed paired scenarios using actual `InteractiveMode` as the
regular baseline. It observes reading/selection differences for earlier-tool
shrink and resize; both paths preserve reading during tail streaming. The
comparison uses a simplified protocol frontend alongside Pi's regular UI.

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
