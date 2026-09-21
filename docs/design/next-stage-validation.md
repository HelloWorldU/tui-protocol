# From Controlled Experiments to Trial Use

Working plan, updated 2026-09-21. Engineering judgments and priorities, not
new protocol requirements or a release commitment. The [protocol drafts](../README.md)
remain authoritative for agreed semantics.

## Current Assessment

The codec, SDK, terminal Session, and experimental xterm renderer form an
executable path. Fixed single-round and multi-round applications run through
Windows bundled ConPTY. The pre-trial checklist below is implemented and has
bounded test evidence; it does not establish production readiness, complete
conformance, or general terminal compatibility.

The [read-only Pi assessment](pi-rendering-architecture.md) traces its rendering
boundary and candidate interfaces. It recommends mapping one finite interaction
through a separate Pi SDK frontend before considering a stock-UI integration
or upstream change. The [Pi session experiment](../../prototypes/integration/pi-session/README.md)
now connects the pinned Pi SDK and one read-only tool through SDK bytes, Windows
ConPTY, and the experimental xterm host. Both local fixtures and a finite OpenAI
subscription trial have browser evidence for completion/search and cancellation.
The live source uses SSE after a recorded model WebSocket failure whose root
cause remains unresolved. This is not the stock Pi UI or a general stability claim.
Other terminals still need their own rendering/history integration; extracting
a production xterm adapter is not a prerequisite for assessing an application.

A separate [paired Pi reading comparison](../../prototypes/integration/pi-session/ux/README.md)
uses fixed actual Pi sessions and captured pre-PTY output. Both frontends
preserved reading during tail streaming. In the tested earlier-tool shrink and
resize cases, the protocol frontend preserved reading/selection where Pi's
regular frontend did not. Neither path showed duplication of the checked text.
The simplified frontend is not feature-equivalent to Pi; this narrows the UX
claim, not the remaining compatibility or long-session work.

The [entered-prompt multi-round Pi frontend](../../prototypes/integration/pi-session/multi-round/README.md)
completes the bounded third-stage interactive trial: one in-memory Pi
conversation with separate display Contexts per turn. Local-provider ConPTY/xterm
checks cover follow-up, assistant/tool cancellation then continuation, old
reading/selection/copy, retained search, and orderly exit. Pi's public
stop-after-turn hook avoids preparing another model request after tool
cancellation; genuine errors still stop the connection. A separate
[four-prompt subscription checkpoint](../../prototypes/integration/pi-session/multi-round/live-checkpoint.md)
observed live context retention and assistant cancellation then continuation.
This is a finite supporting-host frontend, not a production terminal or full Pi UI.

## Completed Work and Evidence

The linked records own scenario details, measured values, commands, and limits.
Dates describe recorded checkpoints, not tests rerun on every document edit.

| Work | Recorded result | Evidence |
| --- | --- | --- |
| Update of the Block being read, 2026-09-14 | Replacement-start viewport policy; seven Node and three browser cases | [Anchored Update](../../prototypes/integration/xterm-protocol-endpoint/README.md#updating-the-block-being-read) |
| Full-Block eviction and render failure | Reject mutation of evicted content; stop after injected partial rendering failure | [Eviction and containment](../../prototypes/integration/xterm-protocol-endpoint/README.md#eviction-and-unrecoverable-rendering-failure) |
| Finite multi-round use, 2026-09-15 | Three commanded rounds and orderly mid-round quit; separate application checks | [Multi-round example](../../examples/multi-round/README.md) |
| Local queue accumulation, 2026-09-16 | Ordering alone does not bound pending pushes; local batch waiting reduces the measured backlog | [Ingress pressure](../../prototypes/integration/ingress-pressure/README.md) |
| Browser consumption credits, 2026-09-16 | Opt-in PTY pause/resume and finite completion; watermark overshoot observed | [PTY pressure](../../prototypes/integration/pty-pressure/README.md) |
| Producer waiting, 2026-09-17–18 | Synchronous writes waited during paused reading and overlapped the composed browser hold | [Isolated probe](../../prototypes/integration/pty-pressure/upstream.md), [composed run](../../prototypes/integration/pty-pressure/composed.md) |
| Permanent consumer stall, 2026-09-19 | Stop forwarding, request child termination, observe exit, and fail the connection | [Stall experiment](../../prototypes/integration/pty-pressure/stalled.md) |

These findings retain important distinctions: zero stdout drain events did not
mean zero waiting; a high watermark is not a hard memory limit; stopping after
partial rendering is not rollback. The anchored-Update policy is a terminal
choice, and clamping below one screen does not preserve separate off-tail
intent in the current renderer.

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
   records remain charged. These are opt-in local policies, not negotiated
   limits, general reclamation, or total process-memory bounds.
3. **Application failure handling.** [Lifecycle tests](../../examples/streaming-text/lifecycle.test.mjs)
   distinguish unsupported/silent startup negotiation from failure after
   protocol output starts. Tested runtime failures stop later sends without
   fallback; cleanup restores input mode and removes handlers. Synthetic
   streams are not OS-level input-mode fault tests.
4. **Content samples.** The [sample report](trial-content-samples.md) records
   seven Node and four browser cases for literal code, Chinese, long lines,
   selected Unicode sequences, and unsupported Tab mapping. Stored Buffer
   text is not evidence of glyph shaping or general Unicode interaction.

That checkpoint passed type checking, 224 Node tests, four affected browser
builds, 73 browser endpoint scenarios, two single-round and two multi-round
browser checks, and the permanent-consumer-stall check. The latter three
fixtures use local Windows bundled ConPTY. Normal examples select the trial
budgets but still omit the pressure fixtures' consumption credits/watchdog.

## Remaining Work and Decision Points

- **Pi integration scope:** the bounded entered-prompt trial above is complete.
  Next choose an actual coding workflow and explicit tool/file permissions before
  exposing project access, or assess stock-UI reuse if preserving Pi's editor,
  Markdown, and extensions is the next priority. These are scope decisions, not
  reasons to silently enable Pi's default tools in this read-only trial.
  Stock UI/extension compatibility, a full fallback frontend, and maintainer
  acceptance have not been established.
- **Capacity and retention:** partial-Block or unmanaged-row eviction, general
  snapshot reclamation, and long-session behavior remain open. Full-Block
  eviction semantics are already [defined](../protocol/terminal-native-behavior.md#5-scrollback-capacity);
  they do not need to be redesigned.
- **Failure and pressure:** no automatic rollback/recovery, whole-process memory
  bound, fairness guarantee, or general policy for slow-but-progressing consumers.
  See the [host contract](../../terminal/README.md#host-adapter-boundary).
- **Compatibility:** wider Unicode interaction, arbitrary terminal controls,
  Unix, SSH/tmux, and other terminals need targeted evidence from actual
  integration requirements.

No new Operation, optional content type, stable API, npm publication, production
adapter extraction, or milestone is required merely to assess the next workflow.
