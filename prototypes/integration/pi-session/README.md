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
[Operation semantics](../../../docs/protocol/operations.md).

**The default Pi session uses a local deterministic model fixture.** The trial
pins the published Pi SDK to 0.86.1 and exercises actual session events and a
read-only tool without model network requests or user credentials. A separate,
opt-in OpenAI Codex subscription entry has live browser evidence for completion,
search, and cancellation in the checkpoint below.

The original hand-authored replay remains useful for isolated mapping tests.
Its consumed-field slice follows [Pi's agent event definitions][agent-events]
and [session event additions][session-events] at commit `3390bd9` (0.86.1).
Those fixtures retain only the fields consumed by the adapter.

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
| `main-live.ts`, `live-source.ts` | Opt-in OpenAI Codex subscription source using Pi's own local OAuth storage. |
| `live-source.test.ts`, `live-cancel-check.ts`, `live-cancel-check.test.ts` | Reject missing/wrong credentials or unknown models offline, and provide an explicitly armed one-shot browser cancellation check. |
| `session.test.ts`, `application.test.ts` | Exercise the installed Pi SDK and application lifecycle using in-process byte transport. |
| `vite.config.ts`, `browser.ts`, `index.html` | Launch the fixed child through the existing PTY bridge and reuse the supporting terminal host. |
| `checks.html`, `checks.ts` | Run two browser scenarios against fresh child/terminal instances. |

Pi-specific dependencies and presentation policy live in this experimental
frontend. The separate
[reading UX comparison](ux/README.md) uses fixed actual Pi sessions to compare
three reading/selection scenarios against Pi's regular frontend.

The [entered-prompt multi-round trial](multi-round/README.md) separately extends
this mapping to one retained Pi conversation with a form, cancellation followed
by another turn, and a five-turn local limit. That record includes local-provider
checks, a four-prompt live subscription run, and the use of Pi's public
stop-after-turn hook for tool-boundary cancellation.

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

In this trial's plain-text frontend, thinking is always visible with a label.
Text parts are joined with blank lines; Markdown stays literal.
Tool-call arguments and intermediate call construction
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

The source uses an allocated temporary working directory and in-memory session
storage, and disables resource discovery, compaction, automatic agent retry,
and cache warming. Fixture credentials are in memory; live credentials use Pi's
local store. Its only tool reads `fixtures/sample.txt`; it cannot
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
lockfile. Workspace release-age exceptions name only the six pinned Pi 0.86.1
packages. The trial has a separate TypeScript project with
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
xterm adapter. Node 24+ and the repository's pnpm dependencies are required;
no Pi login or model key is needed for the default fixture.

Recorded on 2026-09-20:

- Replay, strict source type checking, 29 focused Node tests, the 253-test Node
  suite, and the browser build passed. The build reports the existing large
  xterm bundle warning.
- Real Pi session plus local provider: two streamed responses, one executed
  read-only tool, and four sealed Blocks in an explicitly closed Context.
- Browser completion: the tool result appears once and remains searchable
  during the final response; the running label is replaced and the child exits 0.
- Browser cancellation: partial assistant text remains searchable with an abort
  label, no tool executes, the Context closes, and the child exits 0.
- Node regressions also cover unsupported/redirected output without session
  creation, encoded terminal rejection, input EOF, idle deadline, output budget,
  cleanup, and the earlier synthetic mapping cases.

The Node endpoint fixtures check logical state; the browser runs check rendering
and interaction. This trial uses a separate plain-text frontend. Stock Pi
editor/extensions, rich content, sustained producer pressure, and long-running
or cross-platform behavior remain outside its coverage.

## Opt-in subscription trial

`pnpm prototype:pi-live` starts the same host with an OpenAI Codex source.
It requires an `openai-codex` OAuth entry in `~/.pi/agent/auth.json`, created
through Pi's login flow. Never paste tokens in chat or commit this file.
The source does not read Codex's credential cache and does not fall back to
an API key. Models/config extensions are not loaded from the user directory.

The initial model is `gpt-5.5` with low thinking effort; `PI_TRIAL_MODEL` can
select another ID in the pinned Pi Codex catalog. Catalog presence is not proof
of account entitlement. Token refresh and model requests use Pi's provider.
Live model requests explicitly use Pi's `sse` transport setting after the
WebSocket failure recorded below. This affects the Pi-to-model connection, not
our OSC carrier or the browser-to-PTY WebSocket bridge.
Starting a turn consumes subscription allowance and sends the fixed prompt,
system instructions, tool definition, and sample result to OpenAI, not project
files. The same finite application limits and read-only tool apply.

Fixture mode remains the default. The automatic browser checks page is disabled
in live mode because it assumes deterministic responses and should not silently
issue model calls. For a deliberate cancellation check, select **Cancel once
assistant text appears** before starting one turn. The helper watches the
displayed report and presses the ordinary cancel button once mutable assistant
text is visible; it never starts a model call. If the answer finishes before
that state is observed, the run is not cancellation evidence.

### Live checkpoint, 2026-09-20

- OpenAI Codex subscription, `gpt-5.5`, low thinking, Pi 0.86.1, Windows bundled
  ConPTY, and the experimental xterm host. No Kimi model was used.
- With provider transport `auto`, one browser run completed the tool but failed
  on the final assistant response with `WebSocket error`. Prior content remained
  searchable, the child exited 1 without the completion marker, and EOF closed
  the previously open Context. The transport failure's root cause is unresolved.
- With explicit SSE, two browser runs completed with four sealed Blocks, an
  explicit Context close before EOF, and child exit 0. The tool result and final
  answer were visible, and searching `Trial sample:` succeeded. One of these
  runs finished before a manual cancel could be sent; it counts only as completion.
- In a separate SSE run, the armed one-shot check cancelled the final response
  after `Trial` appeared. That partial text remained visible with an abort label;
  `Request was aborted` was searchable, the Context explicitly closed, and the
  child exited 0 with `[stopped by user]`, not the completion marker.

A local provider-error regression checks rejection of completion after the tool
result and Context closure at EOF. Live model calls are opt-in and separate
from `pnpm test`.

After these changes, type checking, 33 focused Node tests, all 257 Node tests,
and both fixture/live browser builds passed. The two automatic local-fixture
browser checks were rerun and passed; the live checks page was verified to
disable automatic calls.

[agent-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/types.ts
[session-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/agent-session.ts#L153
