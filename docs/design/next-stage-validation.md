# From Controlled Experiments to Trial Use

Working plan, 2026-09-14. This records engineering judgments and proposed
priorities, not new protocol requirements or a release commitment. The
[protocol drafts](../README.md) remain authoritative for agreed semantics.

## Assessment

The codec, TUI SDK, terminal Session, and xterm experiments form an executable
path. The [terminal example](../../examples/terminal-host/README.md) also runs
a fixed application through Windows bundled ConPTY. These are bounded results,
not complete conformance or general terminal compatibility.

The next objective is to make a limited application useful to try, rather than
reorganize implementation directories. Other terminals implement their own
rendering and history integration; extracting our private xterm adapter is not
a prerequisite for their adoption.

## Gaps and Priority

1. **Implement an already-defined Update case.** The draft permits replacement
   of the Block containing the reading anchor without preserving its old
   internal position. The private renderer initially threw in that case.
   Complete this path before building a richer interactive example. See
   [the existing rule](../protocol/terminal-native-behavior.md#4-updating-the-anchored-block).
2. **Observe finite multi-round use.** Extend the application experience with
   user-triggered rounds, earlier content changing after later output exists,
   and reading/selection/search during generation. Use simulated output and
   bounded content, not a real-model dependency or an endurance claim.
3. **Implement post-eviction behavior.** The full-Block decision is now recorded:
   reject later content changes without restoring display. Partial eviction
   and general memory reclamation remain open; silently deleting identity
   state could change mutation and replay behavior. See
   [capacity semantics](../protocol/terminal-native-behavior.md#5-scrollback-capacity)
   and the [current implementation limits](../../prototypes/integration/xterm-protocol-endpoint/README.md#experimental-boundaries).
4. **Exercise failure and accumulation.** Preparation catches some known
   capacity failures, but later rendering failures are not generally rolled
   back. First test safe stopping after an injected failure. Measure queued
   work under a faster producer before choosing resource limits or transport
   backpressure. Do not add automatic retry or new wire messages by default.
   See the [host boundary](../../terminal/README.md#host-adapter-boundary) and
   [SDK limits](../../sdk/README.md#verification-and-remaining-limits).
5. **Prepare a bounded external trial.** Document what an application and a
   terminal must implement, and distinguish agreed requirements from reference
   implementation choices. Broader Unicode, Unix, SSH/tmux, and other terminals
   need targeted evidence; absence of tests alone does not prove impossibility.

## Current Work: Updating the Block Being Read

The prototype policy is to move the viewport toward the replacement Block's
first rendered row, clamped to the available viewport range. It does not claim
to map the old internal position into new content. Existing tail following,
incremental mappings, capacity rejection, and selection rules remain unchanged.

Implemented and checked on 2026-09-14: seven
[Node cases](../../prototypes/integration/xterm-protocol-endpoint/anchored-update.test.ts)
exercise growth, shrinkage, same-height/empty content, queued Extend, resize,
one complete-leading-Block capacity arrangement, and capacity rejection. Three
[browser cases](../../prototypes/integration/xterm-browser-protocol-endpoint/scenarios/anchored-update.ts)
check target versus unaffected selection/copy, new versus replaced searchable
text, and following ordinary output after shrinkage below one screen.

Self-review also found that shrinking below one screen could remove required
blank Buffer rows and leave the native cursor at its old row. The fix retains
those rows and moves the cursor with following content. In this arrangement
the viewport clamps to zero; the current renderer uses physical viewport
coordinates and does not preserve separate off-tail intent when all content
fits. This is a recorded implementation limit, not a new protocol rule.

Type checking, 168 Node tests, the browser build, and 69 browser endpoint
scenarios passed locally. These counts include earlier regression cases;
they do not prove general layout correctness, sustained use, or recovery.
Step 2 remains proposed work. The subsequent checkpoint below advances parts
of steps 3 and 4; resource reclamation, backpressure, and step 5 remain open.

## Follow-up: Eviction and Fault Containment

The agreed boundary is that a fully evicted Block must not be restored by content
Operations, and that execution must stop if a later failure leaves consistency
unrecoverable or unknown. The decisions are recorded in
[capacity semantics](../protocol/terminal-native-behavior.md#5-scrollback-capacity)
and [execution failure](../protocol/contexts.md#12-unrecoverable-execution-failure).
The existing `resource_exhausted` code is used for otherwise valid modifications
of fully evicted content; no new wire code or Message is introduced.

The [eviction test](../../prototypes/integration/xterm-protocol-endpoint/evicted-block.test.ts)
checks rejection, no resurrection, ID retention, and fresh Append. The
[fault tests](../../prototypes/integration/xterm-protocol-endpoint/fatal-render.test.ts)
inject partial native output followed by an exception and verify stopped
rendering and blocked session reuse through direct and mixed input. The
terminal endpoint also stops on a synchronous adapter accept exception.

This is fault containment, not rollback or automatic restart. Already committed
logical snapshots may differ from partial rendering and remain diagnostic only.
Hosts must retire the failed session; a new Context or ingress wrapper does
not repair it. Snapshot-memory reclamation, partial eviction, fault-frequency
measurement, and queue/backpressure limits are not implemented by this step.

The follow-up passed type checking, 172 Node tests (including isolated build
consumers), both affected browser builds, 69 browser endpoint regressions, and
the two existing real-PTY terminal-example checks. Injected-failure evidence is
from the Node tests, not a real browser crash or transport-recovery experiment.

## Deferred

No new Operation, optional content type, stable API, npm publication, adapter
extraction, or repository milestone is needed for this first step. Revisit the
order when an experiment or prospective implementer supplies a concrete reason.
