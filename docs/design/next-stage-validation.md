# From Controlled Experiments to Trial Use

Working plan, updated 2026-09-22. This document tracks implementation evidence
and engineering priorities. Agreed semantics are recorded in the
[protocol drafts](../README.md).

## Current Assessment

The codec, SDK, terminal Session, and experimental xterm renderer form an
executable path. Fixed single-round and multi-round applications run through
Windows bundled ConPTY. The pre-trial checklist below is implemented, with
recorded tests for each item.

Following the [Pi architecture assessment](pi-rendering-architecture.md), the
[Pi session experiment](../../prototypes/integration/pi-session/README.md)
connects the pinned Pi SDK and one read-only tool through SDK bytes, Windows
ConPTY, and the experimental xterm host. Both local fixtures and a finite OpenAI
subscription trial have browser evidence for completion/search and cancellation.
The live source uses SSE after a recorded model WebSocket failure whose root
cause remains unresolved. The trial uses a separate plain-text frontend;
Pi's editor and extension UI remain integration work. Other terminals need
their own rendering/history integration.

A separate [paired Pi reading comparison](../../prototypes/integration/pi-session/ux/README.md)
uses fixed actual Pi sessions and captured pre-PTY output. Both frontends
preserved reading during tail streaming. In the tested earlier-tool shrink and
resize cases, the protocol frontend preserved reading/selection where Pi's
regular frontend did not. Neither path showed duplication of the checked text.

The [entered-prompt multi-round Pi frontend](../../prototypes/integration/pi-session/multi-round/README.md)
completes the bounded third-stage interactive trial: one in-memory Pi
conversation with separate display Contexts per turn. Local-provider ConPTY/xterm
checks cover follow-up, assistant/tool cancellation then continuation, old
reading/selection/copy, retained search, and orderly exit. Pi's public
stop-after-turn hook avoids preparing another model request after tool
cancellation; genuine errors still stop the connection. A separate
[four-prompt subscription checkpoint](../../prototypes/integration/pi-session/multi-round/live-checkpoint.md)
observed live context retention and assistant cancellation then continuation.

The [coding trial](../../prototypes/integration/pi-session/coding/README.md)
adds a generated project with two readable files, one editable source, and a
fixed test command. Local-provider and live subscription runs reproduced three
failures, applied a quantity fix, passed all six tests, and repeated the tests
in a second turn. Earlier failure output remained searchable and copyable.

## Completed Work and Evidence

The linked records provide scenario details, measurements, commands, and
limits for each dated checkpoint.

| Work | Recorded result | Evidence |
| --- | --- | --- |
| Update of the Block being read, 2026-09-14 | Replacement-start viewport policy; seven Node and three browser cases | [Anchored Update](../../prototypes/integration/xterm-protocol-endpoint/README.md#updating-the-block-being-read) |
| Full-Block eviction and render failure | Reject mutation of evicted content; stop after injected partial rendering failure | [Eviction and containment](../../prototypes/integration/xterm-protocol-endpoint/README.md#eviction-and-unrecoverable-rendering-failure) |
| Finite multi-round use, 2026-09-15 | Three commanded rounds and orderly mid-round quit; separate application checks | [Multi-round example](../../examples/multi-round/README.md) |
| Local queue accumulation, 2026-09-16 | Ordering alone does not bound pending pushes; local batch waiting reduces the measured backlog | [Ingress pressure](../../prototypes/integration/ingress-pressure/README.md) |
| Browser consumption credits, 2026-09-16 | Opt-in PTY pause/resume and finite completion; watermark overshoot observed | [PTY pressure](../../prototypes/integration/pty-pressure/README.md) |
| Producer waiting, 2026-09-17–18 | Synchronous writes waited during paused reading and overlapped the composed browser hold | [Isolated probe](../../prototypes/integration/pty-pressure/upstream.md), [composed run](../../prototypes/integration/pty-pressure/composed.md) |
| Permanent consumer stall, 2026-09-19 | Stop forwarding, request child termination, observe exit, and fail the connection | [Stall experiment](../../prototypes/integration/pty-pressure/stalled.md) |

The pressure experiments observed producer waiting even with zero stdout drain
events, and queues could exceed their high watermark. After partial rendering
failure, the host stops with the partial state retained. The anchored-Update
experiment uses a terminal-chosen policy; below one screen of content, viewport
clamping loses separate off-tail reading intent.

## Pre-trial Checklist Completed on 2026-09-19

1. **Cleanup failures.** [Fault-injection tests](../../prototypes/integration/pty-demo/connection.test.ts)
   exercise missing/late exit, failed kill, unresponsive socket closure,
   trailing output, and failed exit notification. The shared bridge keeps its
   child slot until both exit and socket closure are observed. Fake events
   and timers test failure ordering; the real stalled-consumer browser run
   supplies separate bundled-ConPTY evidence.
2. **Resource accounting.** [Trial budgets](trial-resource-budgets.md) bound
   selected retained content, identity/replay structures, and owned pending
   input. Content overflow rejects atomically; identity/replay exhaustion stops
   execution rather than forgetting protocol meaning. Closed and evicted
   records remain charged. Hosts opt into these local limits; total process
   memory and reclamation still need separate handling.
3. **Application failure handling.** [Lifecycle tests](../../examples/streaming-text/lifecycle.test.mjs)
   distinguish unsupported/silent startup negotiation from failure after
   protocol output starts. Tested runtime failures stop later sends without
   fallback; cleanup restores input mode and removes handlers. These tests
   inject failures through synthetic streams.
4. **Content samples.** The [sample report](trial-content-samples.md) records
   seven Node and four browser cases for literal code, Chinese, long lines,
   selected Unicode sequences, and unsupported Tab mapping. Assertions inspect
   stored Buffer text and Session content; glyph shaping and native interaction
   for these Unicode sequences need further tests.

That checkpoint passed type checking, 224 Node tests, four affected browser
builds, 73 browser endpoint scenarios, two single-round and two multi-round
browser checks, and the permanent-consumer-stall check. The latter three
fixtures use local Windows bundled ConPTY. Normal examples select the trial
budgets but still omit the pressure fixtures' consumption credits/watchdog.

## Remaining Work and Decision Points

- **Pi integration scope:** the entered-prompt trial and one generated-project
  coding workflow are complete. Real repository access needs a selected project,
  explicit permissions, and execution isolation. Stock-UI reuse, a full fallback
  frontend, and an upstream proposal remain follow-up choices.
- **Capacity and retention:** partial-Block or unmanaged-row eviction, general
  snapshot reclamation, and long-session behavior remain open. Full-Block
  eviction follows the [existing semantics](../protocol/terminal-native-behavior.md#5-scrollback-capacity).
- **Failure and pressure:** automatic rollback/recovery, whole-process memory
  bounds, fairness, and a policy for slow-but-progressing consumers remain open.
  See the [host contract](../../terminal/README.md#host-adapter-boundary).
- **Compatibility:** wider Unicode interaction, arbitrary terminal controls,
  Unix, SSH/tmux, and other terminals need targeted evidence from actual
  integration requirements.
