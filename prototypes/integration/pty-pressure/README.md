# PTY pressure experiment

## Question and composition

Can browser consumption drive pause/resume at the local PTY bridge while all
sent Updates still render correctly? This follows the
[local ingress experiment](../ingress-pressure/README.md) and the
[validation plan](../../../docs/design/next-stage-validation.md).
It composes a built [SDK](../../../sdk/README.md) application,
the [bundled-ConPTY bridge](../pty-demo/README.md), and the existing
[xterm mixed ingress](../xterm-protocol-endpoint/README.md).

This prototype uses opt-in **local bridge controls** for consumption credits.
They operate independently of protocol Messages and Operation outcomes.
Normal application examples leave them disabled.

## Workload and accounting

[producer.mjs](producer.mjs) opens one mutable Block, sends 256 full Updates with
distinct ASCII labels and 2048 repeated characters, Seals, and explicitly closes
the Context. Its synchronous SDK writer calls Node stdout; if a write returns
false, the application waits for `drain` before sending the next Operation.
It reports how often that path was used and, since the 2026-09-18 follow-up,
the longest synchronous write duration.
The [composed follow-up](composed.md) selects a larger fixed workload and a
two-second browser hold using the same implementation.
The [stalled-consumer check](stalled.md) holds it indefinitely and verifies
host-side termination instead of successful completion. Since 2026-09-19, these
pressure fixtures enable a five-second consumption-progress watchdog; normal
examples still leave the optional flow-control path disabled.

The [browser](main.ts) holds the first Update before native rendering until it
also observes a host pause. It queues incoming binary data in arrival order and
returns a cumulative consumed-byte offset only after `ingress.push()` completes.
That offset measures local byte processing, not success of every Operation.

The opt-in [host](../pty-demo/vite.config.ts) uses
[FlowWindow](../pty-demo/flow-window.ts) to count sent-but-not-yet-consumed bytes.
It pauses PTY reading at 16,384 bytes and resumes at or below 4096 bytes. Duplicate
offsets grant no extra credit; backward, fractional, or beyond-sent offsets close
the connection. Child-exit reporting waits for outstanding bytes to drain. The
existing loopback binding, Origin/token check, single-child policy, and cleanup
remain in place. These numbers are fixture settings, not selected product limits.

The last data callback may cross the high watermark by a whole chunk; a paused
reader also does not remove bytes already buffered elsewhere. Thus the high
watermark is **not a hard memory or queue limit**. Host `peak` counts binary bytes
until browser credit; browser `peakPendingBytes` counts received binary bytes
until processing finishes. `peakSocketBytes` samples `ws.bufferedAmount` after
binary sends. Metrics/control JSON, OS/ConPTY buffers, renderer allocations,
Session snapshots, and child stdout buffers are not included in those totals.

## Observed result

On 2026-09-16, a local browser run using Windows bundled ConPTY and pinned
xterm 6.0 passed: 256 Updates rendered, final native and Session content matched,
the Block was sealed, Context closed, child exited zero, and outstanding bytes
reached zero. The first recorded run reported:

- 761,325 binary bytes forwarded and consumed;
- 13 pause/resume pairs;
- 71,476 peak outstanding host bytes and peak pending browser bytes;
- zero sampled WebSocket buffered bytes;
- **zero producer stdout drain waits**.

Chunking and counts can vary between runs; the check does not require these exact
numbers. The run demonstrates the browser-to-PTY-reader control path and finite
completion. Producer waiting remained unresolved: there were no drain waits,
and synchronous write duration had not yet been measured. Zero sampled
WebSocket bytes also leaves buffering elsewhere unmeasured.

The [upstream follow-up](upstream.md) compares normal and paused ConPTY reading
with independent producer progress and write-duration measurements. The
[composed measurement](composed.md) then observes producer waiting overlapping
a browser hold in the larger workload. Total pipeline memory remains unmeasured.

## Run and verification

On Windows with Node 24+, from the repository root:

```sh
pnpm install
pnpm prototype:pty-pressure
```

Open `http://127.0.0.1:4178/` and choose **Run pressure check**. Expect PASS and
the accounting report; reload for a new child. The check verifies the controlled
stall, pause/resume, exact Update count, final native and logical content, normal
closure, and fully credited bytes. A mismatch or thirty-second page deadline
reports FAIL. Close the page to stop its child; Ctrl+C stops the server. Run only
one port-4178 PTY fixture at a time.

`pnpm typecheck`, `pnpm test`, and `pnpm build:pty-pressure` check types, Node
regressions (including byte-window transitions/invalid offsets), and browser
bundling. The browser run is separate from the Node tests; built static files
still require the development host and its injected token. The original
[terminal-host checks](../../../examples/terminal-host/README.md#verification-and-limits)
exercise the unchanged default, without flow credits.

The original 2026-09-16 verification passed type checking, 181 Node tests, the pressure and both
example builds, this browser pressure check, and all four existing terminal-host
and multi-round browser scenarios. Those four regressions do not use flow credits.

This is one finite ASCII workload in a fixed 40-by-8 browser terminal using
experimental OSC 9002 and private xterm APIs. It does not validate general
Unicode, eviction, clipboard/search, a stalled renderer's recovery, malformed
peer behavior over a real socket, long-running memory use, other terminals,
Unix, SSH, or tmux.
