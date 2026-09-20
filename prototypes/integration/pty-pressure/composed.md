# Browser hold and producer waiting

## Question

Does the browser consumption-credit path also delay application writes under
the larger workload used in the [isolated ConPTY probe](upstream.md)? This
follow-up composes that workload with the existing [browser fixture](README.md);
it introduces no protocol Messages, SDK behavior, or default bridge policy.

## Method

The `composed` entry in [workload.ts](workload.ts) selects 128 Updates, each with
an ASCII label and 32,768 padding characters. The [browser](main.ts) holds the
first Update before rendering until it sees a host pause, then waits another
two seconds before releasing it. The existing bridge uses the same 16 KiB/4 KiB
high/low credit watermarks. The fixture stops on a thirty-second deadline or
more than 8 MiB of received binary data; these are experiment guards, not a
production resource policy.

The [producer](producer.mjs) measures the duration of synchronous stdout calls
with a monotonic clock and reports its longest call after normal Context closure.
The report also contains same-host wall-clock start/end times. The browser
reports their overlap with its hold interval. Wall-clock correlation assumes
the system clock was not adjusted during the run; it is not a portable latency
assertion. Index zero identifies a non-Update write. This final report cannot
observe a producer that never finishes; the independent progress pipe remains
part of the isolated probe, not this browser fixture.

PASS checks ordered rendering of all Updates, matching final Session/native
text, sealed content, explicit Context closure before EOF cleanup, successful
child exit, pause/resume, and zero outstanding credited bytes. Timing is reported
separately: PASS alone does not assert a minimum producer delay or overlap.

## Observed result

On 2026-09-18, one local run using Windows bundled ConPTY and pinned xterm 6.0
passed and reported:

- 5,647,454 binary bytes forwarded and consumed; 88 pause/resume pairs;
- 65,536 peak outstanding host bytes and peak pending browser bytes;
- a 2,005 ms browser hold and a 2,036 ms longest synchronous write, at Update 9;
- 2,005 ms overlap between those intervals;
- zero producer drain waits and zero sampled WebSocket buffered bytes.

These observations support pressure propagation through this composed path:
browser consumption credits control PTY reading, and a producer write waits
while consumption is held. They do not establish a total memory bound, an OS
buffer size, or the same behavior for every TUI. Callback chunks still overshoot
the high watermark. Zero drain events does not mean no waiting, and zero sampled
WebSocket buffering does not mean every transport buffer is empty.

This is a finite ASCII workload with one mutable Block, experimental OSC 9002,
and private xterm APIs. It does not test permanent stalls, long-running resource
use, fairness, eviction, other terminals, Unix, SSH, or tmux. Existing examples
still leave byte-credit flow control disabled. The [stalled-consumer follow-up](stalled.md)
tests a local timeout policy; the separate [trial budgets](../../../docs/design/trial-resource-budgets.md)
define retained-state and pending-input accounting for normal examples.
Neither establishes a hard end-to-end memory bound for this pressure fixture.

## Run and verification

```sh
pnpm prototype:pty-composed
```

On Windows with Node 24+, open `http://127.0.0.1:4178/` and choose **Run pressure
check**. Reload for another child; close the page and stop the server afterward.
Run only one port-4178 fixture at a time. `pnpm prototype:pty-pressure` retains
the original smaller workload. Both now report synchronous write timing.

Type checking, 184 default Node tests, and both `build:pty-pressure` and
`build:pty-composed` passed. The Node suite includes [report parsing and interval
checks](report.test.ts), not real browser execution. The composed browser run
and the original 256-Update browser regression passed separately. Static builds
still require the development host/token; bundle success is not transport proof.
