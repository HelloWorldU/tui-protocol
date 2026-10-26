# From Controlled Experiments to Trial Use

Working plan, updated 2026-09-22; Pi stock-UI status added 2026-10-11;
content-model phase and ordered next steps updated 2026-10-26. This document
tracks implementation evidence and engineering priorities; its
[Next Steps](#next-steps) section is the current hand-off list. Agreed semantics are recorded in the
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

The content-model phase is complete. [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md),
[RFC 0002](../rfcs/0002-styled-text-content.md) (`text/styled`), and
[RFC 0003](../rfcs/0003-line-layout-attributes.md) (`text/lines`) are
Accepted, with protocol drafts for [styled text](../protocol/styled-text.md)
and [line layout text](../protocol/lines-text.md). Both types run through the
protocol, terminal, and SDK modules. In the
[Pi stock-UI trial](../../prototypes/integration/pi-stock-ui/README.md), Pi's
assistant answers travel as `text/lines` and the terminal lays them out at
every width beside Pi's own editor and footer; the
[layout experiment](renderer-layout-and-reflow.md) records why baking layout
at one width fails.

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
| Styled text content, 2026-10-16–19 | `text/styled` end to end; browser paint, copy, and search checks; ANSI conversion on recorded Pi output | [Styled text draft](../protocol/styled-text.md#experimental-evidence) |
| Renderer-baked layout, 2026-10-19 | Neither a current-width nor a wide render survives a width change under cell reflow | [Layout experiment](renderer-layout-and-reflow.md) |
| Line layout content, 2026-10-19–24 | `text/lines` matches Pi's own layout at every width from 20 to 100 columns for a Chinese and nested-list sample; real-Pi browser checks pass at 36 and 60 columns | [Line layout draft](../protocol/lines-text.md#experimental-evidence), [Pi trial](../../prototypes/integration/pi-stock-ui/README.md#line-layout-transcript-content) |

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

## Next Steps

Ordered by current priority, following the demo-first strategy in the
[adoption path](adoption-path.md#the-realistic-ladder-ordered) (revised
2026-10-26). State at 2026-10-26: `pnpm typecheck`, 466 Node tests, and the
documentation check pass on `main`.

1. **A runnable demo terminal.** First, research whether the receiver side
   can ship as a plugin of an existing terminal built on xterm.js (for
   example Hyper or Tabby): whether their plugin APIs expose the terminal
   instance, its buffer, and the PTY byte stream, verified from their
   official documentation or source. A plugin in a terminal people already
   use is a stronger demonstration. Otherwise, build an installable desktop
   program (for example Electron with xterm.js, node-pty, and the terminal
   module) that runs the real Pi and an ordinary shell in one window, with
   the protocol host built in. Either way, an ordinary terminal cannot show
   the protocol: it ignores the capability query, so a protocol-enabled Pi
   falls back to its stock rendering there. It replaces the browser test pages
   as the thing people run. The demonstration must retain protocol Blocks and
   ordinary output in one terminal history, with enough robustness for a long
   demo session. A terminal vendor's native integration can control its own
   buffer directly rather than reuse a plugin's xterm.js adapter.

   Progress, 2026-10-26: the plugin approach is feasible and the
   [Tabby vertical slice](../../prototypes/integration/tabby-demo/README.md)
   is complete. It loads in Tabby 1.0.238 and verifies ordinary shell output,
   an SDK round trip, two real Pi stock-UI rounds, resize recovery, and two
   sequential independent SDK applications in one tab. Request IDs are now
   namespaced per SDK client, so later applications cannot receive an earlier
   application's cached closed Context. The single-history plugin retains its
   private history adapter, guarded by a host-version declaration and private-
   structure check before activation. Incompatible hosts leave the capability
   query unanswered and notify once, allowing ordinary application fallback;
   both this path and the compatible two-round Pi path have desktop evidence.
   The remaining blocker for a longer demonstration is the long-session policy.
2. **A side-by-side demonstration.** The same Pi session in an ordinary
   terminal and in the demo terminal: layout after resize, updates to content
   already in scrollback, a stable reading position, and copy and search on
   logical text. A scripted walkthrough and a recording, plus Pi's unmodified
   fallback in the ordinary terminal.
3. **A terminal vendor kit.** What a terminal maker needs to evaluate and
   embed the receiver side: a concise protocol summary, the terminal module as
   an embeddable reference implementation under its Apache-2.0 license, a
   host-adapter integration guide, and the conformance checks to run.
4. **Vendor conversations**, only after 1–3, with dated, reproducible
   evidence. A vendor's own integration then becomes the independent second
   terminal-side implementation.

Supporting work, scheduled when the demo needs it:

- **Emit layout attributes from the application renderer.** The Pi trial
  reads layout intent back from rendered shapes
  ([`lines-from-render.ts`](../../prototypes/integration/pi-stock-ui/lines-from-render.ts)),
  so tables and other constructs get only word wrapping.
- **Relayout without an application redraw.** In region mode the host relies
  on Pi's resize redraw and clear recovery to re-materialize `text/lines`
  Blocks; an application that does not redraw keeps cell-reflowed rows.
- **Long-session behavior:** snapshot reclamation, process memory bounds,
  and a slow-consumer policy, as listed below.
- **Propose public history-line editing in xterm.js, long term.** Research on
  2026-10-27 found related discussion but no public API covering this need: the
  current [`IBuffer`](https://github.com/xtermjs/xterm.js/blob/master/typings/xterm.d.ts#L1631-L1686)
  exposes read access, not arbitrary history insertion, deletion, or
  replacement. In [#2105](https://github.com/xtermjs/xterm.js/issues/2105#issuecomment-552096285),
  maintainers rejected direct Buffer editing because of required post-actions
  and the static-scrollback assumption. The open contributor issue
  [#5999](https://github.com/xtermjs/xterm.js/issues/5999) proposes
  encapsulating `Buffer.lines`, including a `spliceLines` method; it is not an
  accepted public extension API. Other contributors discuss a controlled
  [`setLine` and `_voffset` consistency](https://github.com/xtermjs/xterm.js/issues/5176#issuecomment-4503224745)
  and [stable identity across circular-buffer trimming](https://github.com/xtermjs/xterm.js/issues/3368#issuecomment-859648015).
  Before drafting an upstream proposal, define atomic row replacement, marker
  and viewport preservation, selection/search invalidation, reflow, capacity
  trimming, and redraw behavior; merely exposing `CircularList` would skip
  those requirements. This project has not filed an upstream proposal. This
  could remove the Tabby plugin's private adapter later, but is not a current
  demo blocker.
- **Platforms:** only Windows bundled ConPTY is verified; macOS, Linux, SSH,
  and tmux are untested.

## Remaining Work and Decision Points

- **Pi integration scope:** the entered-prompt trial and one generated-project
  coding workflow are complete, and stock-UI reuse is verified: the
  [Pi stock-UI trial](../../prototypes/integration/pi-stock-ui/README.md) runs
  Pi's stock interactive UI with a protocol-owned transcript through
  terminal-host region ownership; its browser checks pass (four on
  2026-10-03, six including `text/lines` layout on 2026-10-24). Real repository access needs a selected project, explicit
  permissions, and execution isolation. A full fallback frontend and an
  upstream proposal remain follow-up choices; broader adoption is scoped in
  the [adoption path](adoption-path.md).
- **Capacity and retention:** partial-Block or unmanaged-row eviction, general
  snapshot reclamation, and long-session behavior remain open. Full-Block
  eviction follows the [existing semantics](../protocol/terminal-native-behavior.md#5-scrollback-capacity).
- **Failure and pressure:** automatic rollback/recovery, whole-process memory
  bounds, fairness, and a policy for slow-but-progressing consumers remain open.
  See the [host contract](../../terminal/README.md#host-adapter-boundary).
- **Compatibility:** wider Unicode interaction, arbitrary terminal controls,
  Unix, SSH/tmux, and other terminals need targeted evidence from actual
  integration requirements. A second, independent terminal-side
  implementation is the cold-start constraint recorded in the
  [adoption path](adoption-path.md).
