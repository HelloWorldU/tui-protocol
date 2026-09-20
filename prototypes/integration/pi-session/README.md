# Pi Session Event Mapping Experiment

## Question and scope

Can a finite sequence shaped like Pi session events preserve content order and
content-state IDs when translated into our Block Operations and passed through
the SDK, byte codec, and terminal Session?

This is the first executable step after the
[Pi architecture assessment](../../../docs/design/pi-rendering-architecture.md),
composing the [TUI SDK](../../../sdk/README.md),
[shared codec](../../../protocol/README.md), and
[terminal endpoint](../../../terminal/README.md). It tests application use of
[Operation semantics](../../../docs/protocol/operations.md), not a new protocol.

**The input is hand-authored, not recorded from Pi.** The structural event slice
follows [Pi's agent event definitions][agent-events] and
[session event additions][session-events] at commit `3390bd9` (0.86.1).
No Pi dependency is installed or imported. Unused upstream fields are omitted;
these fixtures are neither complete Pi events nor a version-compatibility test.

## Layout

| File | Responsibility |
| --- | --- |
| `event-adapter.ts` | Consume the selected event fields, track trial-local Blocks, and call the SDK Context interface. |
| `fixtures/tool-turn.ts` | Synthetic prompt, assistant stream, one tool, and final response; expected transcript. |
| `event-adapter.test.ts` | Check event-to-Operation decisions using a recording writer. |
| `replay.ts` | Wire the adapter to the real SDK and in-process terminal endpoint; print Session state. |
| `integration.test.ts` | Assert final content/lifecycle, byte-response errors, unsupported negotiation, and incomplete input. |

There is no live `main.ts` yet. Pi-specific policy stays here, outside the
generic SDK; this is not a published adapter or a stock Pi extension.

## Trial mapping

| Input | Trial presentation and Operations |
| --- | --- |
| One user message start/end | One immediately sealed Block with a `User:` label; end must retain the same text. |
| Assistant start | Append a mutable `Assistant:` Block, even when initially empty. |
| Assistant update | Project the current snapshot, not both snapshot and delta. Unchanged text sends nothing; strict tail growth uses Extend; other changes use ReplaceSuffix at the common Unicode-scalar prefix. |
| Assistant end | Apply final content, add a plain error/abort/length label if needed, then Seal. |
| Tool execution start/update/end | Create one mutable `Tool:` Block per call ID; replace the running label with result snapshots and Seal on completion. Tool errors add a label. |
| Tool-result message start/end | Do not duplicate output already supplied by completed tool execution; require its known, sealed call ID. |
| Agent end | Finish only without retry, an active assistant, or an unfinished tool. The replay then closes the Context. |

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

Only the event types in `TrialEvent` are accepted. Images, custom/system
messages, retries, compaction, session replacement, and `agent_settled` are
outside this fixture stream. Unknown events, unsupported content, invalid
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
responses; **this is not Pi producer backpressure**. A live subscription still
needs a transport budget, input routing, cancellation, and shutdown handling.

## Run and evidence

From the repository root:

```sh
pnpm prototype:pi-session
pnpm test:pi-session
pnpm typecheck
pnpm test
```

The fixed replay produces four sealed Blocks in a closed Context: user input,
first assistant text, one tool result, and final assistant text. The focused
tests also check sent-state chaining, Unicode suffix replacement, abort labels,
duplicate tool IDs, unsupported content, local limits, failed writes, late
failure notification, and an encoded Operation rejection.

Recorded on 2026-09-20: the replay, type checking, 20 focused tests, and the
244-test Node suite passed. These counts describe the local checkpoint, not
exhaustive input coverage or a Pi runtime result.

The endpoint's capability flag is enabled as a **synthetic responder fixture**.
Its Operation consumer records accepted Operations; it does not render anything.
Session state assertions therefore prove neither screen output nor native
selection/search behavior. No browser, PTY, real Pi session, model request,
stock editor, extension compatibility, or new terminal compatibility was tested.

Next: connect this mapping to an actual pinned Pi event source and a supporting
terminal host, with explicit lifecycle, input, failure, and queue ownership.
Do not interpret this replay as completion of that integration.

[agent-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/types.ts
[session-events]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/src/core/agent-session.ts#L153
