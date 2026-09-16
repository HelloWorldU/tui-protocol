# Ingress pressure experiment

## Question

When a producer outpaces rendering, does ordered execution also limit queued
input? Compare a burst with a producer that waits for each local batch to finish.
This is an integration experiment for the
[next-stage plan](../../../docs/design/next-stage-validation.md), composing the
[TUI SDK](../../../sdk/README.md),
[mixed xterm ingress](../xterm-protocol-endpoint/README.md), and
[private history renderer](../../xterm-headless/README.md).

## Method

[probe.ts](probe.ts) connects the real SDK byte writer to the real headless
mixed ingress in one process, with encoded responses routed back to the SDK.
After negotiation and Append, a test subclass holds the first Extend immediately
before native rendering. The producer sends 16, 64, or 256 distinct ASCII
fragments, either all at once or waiting after every eight or one SDK writes.
The barrier is then released and the actual history renderer runs normally.

The counters surround `ingress.push()` and decrement when its Promise settles:

- **Unsettled pushes** include the currently processing push and those waiting.
- **Unsettled bytes** sum the original byte lengths of those pushes. They are
  not heap usage, buffered-character counts, or the adapter's queue length.
- Measurement covers only Extend writes, one SDK byte batch per Operation in
  these fixtures. Setup, subsequent Seal, ordinary output, and close are excluded.

While held, only the first Extend has reached Session commit and no fragment
has rendered. After release, assertions check exact Session text and rendered
rows, all Extends completed, zero outstanding counters, a following ordinary
`DONE` line appearing once, and successful Seal/Context closure. This does not
promise atomic agreement between Session and renderer during execution.

No sleep-based throughput target is used. The controlled stall isolates a queue
property; it does not simulate a particular terminal speed or benchmark latency.
The batch sizes are experiment fixtures, not selected limits or wire semantics.

## Observed results

Local run on 2026-09-16, pinned xterm 6.0, 80-by-8 viewport, 1000 scrollback rows:

| Extends | Burst peak pushes / bytes | Wait every 8: peak pushes / bytes | Wait every 1: peak pushes / bytes |
| --- | --- | --- | --- |
| 16 | 16 / 3,738 | 8 / 1,872 | 1 / 234 |
| 64 | 64 / 14,970 | 8 / 1,872 | 1 / 234 |
| 256 | 256 / 60,690 | 8 / 1,912 | 1 / 239 |

All nine runs drained and passed the final-state assertions. Larger numeric IDs
change encoded lengths, so the peak bytes for an eight-write batch need not be
those of the first held batch. This table is one bounded observation, not a
capacity recommendation. The three parameterized regression tests compare all
three policies at each size and check their byte totals agree.
Type checking and the full 179-test Node suite passed in the same checkout.

## Conclusion and next boundary

The current ingress can preserve these fragments in order while outstanding
input grows with a burst. Waiting at this local boundary limits outstanding
pushes in the tested arrangements; ordering alone does not provide such a limit.

That is **not yet end-to-end backpressure**. The fixture's producer can directly
await the terminal's local completion Promise; an external TUI cannot. The
[SDK callback](../../../sdk/src/client.ts) accepts bytes synchronously and an
Operation ID means sent, not rendered. Making that callback `async` would not
cause the current SDK to wait.

Source inspection shows additional places outside this measurement: the
[browser host](../../../examples/terminal-host/main.ts) chains incoming events
on its own Promise before calling ingress, and the
[PTY bridge](../pty-demo/vite.config.ts) forwards child output into WebSocket.
Neither currently implements an explicit queue-byte budget or coordinated
pause/resume. These are code observations, not measured queue sizes.

Next, measure that host/transport boundary and test whether slowing consumption
can propagate toward the producer. Do not add protocol-level acknowledgements,
discard dependent incremental Operations, or declare memory bounded on the
strength of this local comparison. No runtime queue policy is changed here.

## Run and limits

```sh
pnpm prototype:ingress-pressure
pnpm typecheck
pnpm test
```

The probe prints JSON; the root tests include [pressure.test.ts](pressure.test.ts).
The barrier has a ten-second failure deadline and each regression has a
thirty-second test deadline. No browser or child application is launched.

This checks one Block, finite Extend sequences, fixed ASCII layout, and normal
completion after an artificial stall. It does not measure process memory,
retained Session history, PTY/OS/WebSocket buffers, sustained throughput,
browser responsiveness, native selection/search, eviction, or fault recovery.
The xterm adapter still uses private APIs and experimental OSC 9002. No stable
transport API, automatic rate control, or general terminal compatibility is
established by these results.
