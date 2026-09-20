# Pi Session Integration Experiment

## Question and scope

Can one finite Pi session translate streaming text and a tool result into Block
Operations, display them through a supporting terminal host, and stop cleanly
on completion, cancellation, or a reported protocol failure?

This follows the
[Pi architecture assessment](../../../docs/design/pi-rendering-architecture.md),
composing the [TUI SDK](../../../sdk/README.md),
[shared codec](../../../protocol/README.md), and
[terminal endpoint](../../../terminal/README.md), and experimental
[terminal host](../../../examples/terminal-host/README.md). It tests application use of
[Operation semantics](../../../docs/protocol/operations.md), not a new protocol.

**The Pi session is real; its model responses are a local deterministic fixture.**
The trial pins the published Pi SDK to 0.86.1. It exercises actual session events
and a read-only tool without model network requests or user credentials. Live
model acceptance is pending maintainer configuration, not counted as completed.

The original hand-authored replay remains useful for isolated mapping tests.
Its consumed-field slice follows [Pi's agent event definitions][agent-events]
and [session event additions][session-events] at commit `3390bd9` (0.86.1).
Those fixtures omit unused fields and are not a full Pi compatibility test.

## Layout

| File | Responsibility |
| --- | --- |
| `event-adapter.ts` | Consume the selected event fields, track trial-local Blocks, and call the SDK Context interface. |
| `fixtures/tool-turn.ts` | Synthetic prompt, assistant stream, one tool, and final response; expected transcript. |
| `event-adapter.test.ts` | Check event-to-Operation decisions using a recording writer. |
| `replay.ts` | Wire the adapter to the real SDK and in-process terminal endpoint; print Session state. |
| `integration.test.ts` | Assert final content/lifecycle, byte-response errors, unsupported negotiation, and incomplete input. |
| `session-source.ts` | Create an isolated Pi session with one fixed read-only tool and in-memory settings/session storage. |
| `session-runner.ts` | Subscribe to actual Pi events, select transcript events, and contain listener failures/cancellation. |
| `application.ts` | Own stdin routing, negotiation, output budget, cancellation, Context close, and cleanup. |
| `main.ts`, `fixtures/provider.ts`, `fixtures/sample.txt` | Run the local model fixture and read its fixed sample; no live provider selection. |
| `session.test.ts`, `application.test.ts` | Exercise the installed Pi SDK and application lifecycle using in-process byte transport. |
| `vite.config.ts`, `browser.ts`, `index.html` | Launch the fixed child through the existing PTY bridge and reuse the supporting terminal host. |
| `checks.html`, `checks.ts` | Run two browser scenarios against fresh child/terminal instances. |

Pi-specific dependencies and policy stay here, outside the generic SDK. This
is neither a published adapter nor a stock Pi extension.

## Trial mapping

| Input | Trial presentation and Operations |
| --- | --- |
| One user message start/end | One immediately sealed Block with a `User:` label; end must retain the same text. |
| Assistant start | Append a mutable `Assistant:` Block, even when initially empty. |
| Assistant update | Project the current snapshot, not both snapshot and delta. Unchanged text sends nothing; strict tail growth uses Extend; other changes use ReplaceSuffix at the common Unicode-scalar prefix. |
| Assistant end | Apply final content, add a plain error/abort/length label if needed, then Seal. |
| Tool execution start/update/end | Create one mutable `Tool:` Block per call ID; replace the running label with result snapshots and Seal on completion. Tool errors add a label. |
| Tool-result message start/end | Do not duplicate output already supplied by completed tool execution; require its known, sealed call ID. |
| Agent end | Finish only without retry, an active assistant, or an unfinished tool. The replay/application then closes the Context. |

These are **experiment presentation choices**, not Pi's UI or protocol rules.
Thinking is always visible with a label. Text parts are joined with blank lines;
Markdown stays literal. Tool-call arguments and intermediate call construction
are not displayed; tool execution has its own Block. No folding, editing after
completion, or theme changes exist here, which is why sealing on message end
is acceptable for this trial. A stock-UI integration must revisit that choice.

Block IDs are generated as `pi-1`, `pi-2`, etc. within the supplied dedicated
Context. Use one adapter per Context/run; these are not Pi persistence IDs.
Incremental operations use the last **sent content Operation ID**, not the
Seal ID or an assumed acknowledgement. Positions count Unicode scalars, not
UTF-16 units. Full Update is not needed for this snapshot-to-suffix mapping.

Only the event types in `TrialEvent` reach the mapping adapter. The real-session
wrapper ignores `agent_settled`, queue notifications, and system messages;
they are not transcript Blocks. Images, custom messages, retries, compaction,
and session replacement are unsupported. Unknown events, unsupported content, invalid
lifecycle, unpaired surrogates, and writer exceptions stop the adapter. The
type is a trusted in-process consumed-field contract, not a parser or validator
for arbitrary external JSON. It does not validate all relationships among
upstream messages, arguments, and tool results.

## Failure and resource boundaries

The adapter retains a failure and rejects later events. A host must also call
`fail` on asynchronous transport/protocol errors. This does not undo already
sent Operations, cancel Pi, or close remote resources by itself.

The replay splits response frames, routes `protocol.error` back through the
SDK, and fails the local run instead of falling back or retrying after output
starts. One event can send final content and Seal before an asynchronous error
arrives; stopping cannot recall that Seal or undo prior content. A regression
checks that rejection still fails the run rather than reporting completion.
A negative capability response returns `unsupported` without consuming
events or sending Block Operations. A fallback UI is not implemented here.

Default local budgets allow 256 events, 32 Blocks, and 65,536 UTF-16 units per
projected text/checked identifier. They bound this adapter's selected retained
state and work count, not incoming event allocation, temporary projection
memory, terminal retention, or transport queues. The adapter is synchronous
and does not enqueue events. Replay yields after each event to deliver local
responses; **this is not Pi producer backpressure**.

## Real-session wiring

The child owns stdin. Protocol replies go to `TuiClient`; ordinary `n` starts
one turn and `q`/Ctrl+C cancels it. Pi's stock editor/renderer never owns this
input stream. Negotiation happens before constructing the Pi session. Redirected
or unsupported output prints a short notice without starting Pi; this is not
a full traditional-terminal fallback frontend.

The source uses an allocated temporary working directory, in-memory credentials
and session storage, and disables resource discovery, compaction, automatic
retry, and cache warming. Its only tool reads `fixtures/sample.txt`; it cannot
choose another path or execute shell commands. The local provider returns a
tool call and then requires its actual result before the final answer.

User cancellation requests Pi abort, retains/seals the partial response, and
closes the Context. Protocol errors, input EOF, output failure, or the default
60-second deadline fail the run instead of reporting completion or restarting
in fallback mode. Handlers, raw input mode, Pi subscriptions, and the temporary
directory are cleaned up. The deadline requests cooperative cancellation; it
does not prove a bound for an unresponsive external provider or tool.

The writer refuses a batch if it would exceed 256 KiB of Node writable-buffer
occupancy plus that batch. This is a local fail-stop budget, not a total memory
bound or upstream flow-control mechanism. Abort cannot recall already sent
Operations. No unbounded application event queue is introduced.

Dependencies are isolated in this private workspace package and pinned in the
lockfile. Initial installation used `pnpm install --ignore-scripts`; there is
no global Pi installation. Workspace release-age exceptions name only the six
pinned Pi 0.86.1 packages. The trial has a separate TypeScript project with
`skipLibCheck` for upstream declaration issues (NodeNext JSON imports and an
optional MCP declaration dependency). Our source remains strictly checked
against the installed SDK; the other repository projects keep their existing
declaration checking.

## Run and evidence

From the repository root:

```sh
pnpm prototype:pi-session
pnpm test:pi-session
pnpm typecheck
pnpm test
pnpm build:pi-host
pnpm prototype:pi-host
```

The fixed replay produces four sealed Blocks in a closed Context: user input,
first assistant text, one tool result, and final assistant text. The focused
tests also check sent-state chaining, Unicode suffix replacement, abort labels,
duplicate tool IDs, unsupported content, local limits, failed writes, late
failure notification, and an encoded Operation rejection.

For the browser trial, open `http://127.0.0.1:4178/`, connect, wait for `[ready]`,
then start or cancel. `http://127.0.0.1:4178/checks.html` runs the two checks.
This host currently requires Windows bundled ConPTY and reuses the existing
loopback/token-guarded bridge. It uses experimental OSC 9002 and the experimental
xterm adapter, not an unmodified external terminal. Node 24+ and the repository's
pnpm dependencies are required; no Pi login or model key is needed.

Recorded on 2026-09-20:

- Replay, strict source type checking, 29 focused Node tests, the 253-test Node
  suite, and the browser build passed. These counts describe this checkpoint,
  not exhaustive input coverage. The build reports the existing large xterm
  bundle warning; it is not evidence of runtime correctness.
- Real Pi session plus local provider: two streamed responses, one executed
  read-only tool, and four sealed Blocks in an explicitly closed Context.
- Browser completion: the tool result appears once and remains searchable
  during the final response; the running label is replaced and the child exits 0.
- Browser cancellation: partial assistant text remains searchable with an abort
  label, no tool executes, the Context closes, and the child exits 0.
- Node regressions also cover unsupported/redirected output without session
  creation, encoded terminal rejection, input EOF, idle deadline, output budget,
  cleanup, and the earlier synthetic mapping cases.

The Node endpoint fixtures alone do not render; browser evidence comes only
from the two scenarios above. These checks do not establish live provider
behavior, stock editor/extension compatibility, rich content support, sustained
producer pressure, long-running stability, or other terminal/OS compatibility.

Next: use maintainer-provided model configuration to run the same finite path
against a real provider, checking its actual streaming/tool/abort behavior.
Do not treat the local fixture result as that acceptance check.

[agent-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/types.ts
[session-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/agent-session.ts#L153
