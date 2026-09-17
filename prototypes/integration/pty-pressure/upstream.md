# Producer-side ConPTY waiting

Follow-up measurement, 2026-09-17. The earlier
[browser pressure check](README.md) observed PTY pause/resume but no stdout
`drain` waits. This experiment asks whether paused reading can delay the
application's **synchronous write call** instead.

## Boundary and method

[upstream-probe.ts](upstream-probe.ts) runs a fixed built
[SDK](../../../sdk/README.md) child through the same bundled ConPTY backend,
once with normal reading and once with a two-second pause. It uses the
[terminal endpoint](../../../terminal/README.md) to decode, validate each Update
in order, and return real control responses. There is no browser, WebSocket,
native renderer, or browser credit window in this isolated comparison.

The child opens one mutable Block, waits for the fixture's start signal, and
sends 128 full Updates, each containing a distinct label and 32,768 ASCII `x`
characters. It then Seals and closes normally. Both modes send the same bytes.
The measurement caps accepted PTY output at 8 MiB and each parent run at twenty
seconds; the fixed child workload sends about 5.65 MB. The child also has its own
twenty-five-second deadline.

A random per-run local Windows named pipe carries measurement records and one
start signal. It does not carry Block data or protocol replies. The child
reports before/after each Update and measures time spent inside `stdout.write`,
any asynchronous drain wait, and sampled `stdout.writableLength`. The parent can
observe these records independently while PTY reading is paused. Sending records
adds overhead to both modes; these timings are not application throughput targets.

For the paused mode, reading stops before the start signal. The parent samples
progress about one and two seconds later, then resumes. Exact timer scheduling
and the first stalled write can vary. The endpoint checks every Update's full
content and order, final content/lifecycle, explicit Context close before EOF,
and successful child exit. These are transport/Session checks, not rendering
evidence or a claim that a renderer-less endpoint implements full baseline support.

## Observations

Two direct paired runs gave the same qualitative result. The second recorded:

| Measurement | Normal read | Two-second pause |
| --- | --- | --- |
| Time to produce 128 Updates | 711 ms | 2,689 ms |
| Longest synchronous stdout write | 9 ms | 1,998 ms, Update 6 |
| Drain waits | 0 | 0 |
| Peak sampled Node writable length | 0 | 0 |
| Progress during the pause | Not paused | Both samples: before Update 6, five completed |
| Decoded Updates after completion | 128 | 128 |

In the paused run, PTY bytes delivered to the parent stayed at 490 through both
samples. After resume, all 128 Updates arrived in order, both modes received
5,647,290 PTY bytes in total, and both Contexts closed with sealed final content.
The longest write was the same Update whose before/after progress straddled the
pause. This supplies evidence of upstream waiting in this specific Windows
bundled-ConPTY arrangement: reading paused, a write remained in progress, then
returned after reading resumed.

**Zero drain events did not mean zero waiting.** Likewise, zero sampled Node
writable length does not measure or exclude buffers inside ConPTY, the console,
or the OS. This experiment does not identify their sizes or bound total memory.

## Run and regression

On Windows, from the repository root with Node 24+ and dependencies installed:

```sh
pnpm prototype:pty-upstream
pnpm test:pty-upstream
pnpm typecheck
pnpm test
```

The first command prints both reports. The explicit
[integration test](upstream.test.ts) runs the pair and verifies finite completion,
ordering/final-state assertions, matching sent byte totals, and pause samples.
It does not assert a portable slowdown ratio or fixed stalled-write index; those
are measured findings, not pass criteria. The real-PTY test is separate from the
default Node suite and is skipped outside Windows.

Local verification passed the paired real-PTY integration test, type checking,
and all 181 default Node tests. Browser checks were not rerun: this follow-up
adds an isolated producer/probe and does not change the existing browser or bridge.

The parent closes the local measurement server and kills an unfinished child on
failure. The standalone runner exits after flushing its report because node-pty
may retain background handles. No browser or listening TCP port is needed.

## Consequence and remaining limits

The earlier browser experiment established consumption-credit-to-PTY-reader
control; this follow-up establishes reader-to-producer waiting in isolation.
Together they motivate testing the complete path with the larger workload,
but they are **not one end-to-end bound or a guarantee for every TUI**.

Do not change SDK semantics or add Operation acknowledgements on this basis.
Before enabling the policy in normal examples, check the composed path under
sustained bounded input and define how a permanently stalled consumer is stopped.
Hard queue limits, buffer ownership/size, memory reclamation, fairness, and
other PTY platforms remain open. No production flow-control default is changed.
