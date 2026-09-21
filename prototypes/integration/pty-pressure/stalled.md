# Stalled browser consumption

## Question and policy

Can the local bridge stop a child when browser consumption never resumes,
without presenting the failure as normal protocol completion? This follows the
[finite browser-hold experiment](composed.md) and uses the same built SDK,
bundled ConPTY bridge, and experimental xterm renderer.

The pressure fixtures opt into a five-second **no-consumption-progress** timeout.
The [watchdog](../pty-demo/consumption-watchdog.ts) starts when outstanding bytes
first become nonzero, even below the pause watermark. A strictly advancing,
validated consumed offset restarts it; duplicate credits, more output, resize,
and input do not. Full consumption cancels it. An idle connection with no
outstanding bytes does not time out. This is not a throughput floor: a consumer
making tiny periodic progress can remain connected.

On timeout, the [host](../pty-demo/vite.config.ts) stops forwarding output and
accepting input, requests child termination, and resumes its internal pipe to
discard remaining data needed for bundled-ConPTY cleanup. It does not deliver
that data to the browser. The initial kill-only attempt failed to observe exit
while the pipe was paused; the follow-up cleanup path addresses that case.

The host reports local JSON `host_error` / `consumer_stalled`, then closes the
WebSocket with 1011. It waits up to two seconds for the PTY exit notification;
`childExitObserved` distinguishes an observed exit from an unconfirmed cleanup.
An unconfirmed child keeps the single-child slot occupied until exit is observed,
rather than allowing repeated reconnections to conceal a cleanup failure. A
one-second close-handshake timer then terminates a socket that has not closed.
These timers run on the host event loop, not an independent hard-deadline monitor.

This JSON is bridge control, **not** a `protocol.error` Message. Delivery to a dead
browser is not guaranteed. The browser fixture aborts its endpoint and discards
pending input; it does not retry or recover the old session. Session acceptance
can already precede rendering, so retained snapshots are diagnostic only: this
step does not promise rollback, automatic repair, or normal Context closure.

## Scenario and verification

```sh
pnpm prototype:pty-stalled
```

On Windows with Node 24+, open `http://127.0.0.1:4178/` and choose **Run pressure
check**. The first of 128 larger Updates is held indefinitely before rendering.
The page expects a host timeout before its independent thirty-second deadline.
PASS requires an observed child exit, abnormal close code 1011, no normal child
exit report, an unchanged native display for the held Update, and rejection of
further input by the aborted endpoint. Reloading starts a fresh child; close the
page and stop the server when finished. Run one port-4178 fixture at a time.

The [watchdog tests](../pty-demo/consumption-watchdog.test.ts) use simulated timers
to check duplicate offsets, advancing consumption, full drain, new output,
idle connections, and disposal. The [cleanup tests](../pty-demo/stop-pty.test.ts)
check kill-before-resume ordering and visibility of thrown cleanup errors.
The browser fixture supplies the real-PTY termination check.
`pnpm build:pty-stalled` checks bundling only.

On 2026-09-19, the local browser check passed with `childExitObserved: true`,
close code 1011, and zero rendered Updates. Reloading on the same host and running
again also passed, showing that confirmed cleanup released the connection slot.
The two-second composed hold still completed all 128 Updates normally. Both
ordinary terminal-host browser scenarios (completion and user disconnect) passed
with the optional watchdog disabled. Type checking, 189 Node tests, stalled and
composed browser builds, and the terminal-host example build also passed.

## Limits

This remains an opt-in local policy. Normal examples still omit flow control
and the new watchdog. The five-second setting is an experiment choice, not a
protocol requirement or a recommended production timeout. Broader use needs
application-specific tolerance for slow consumers.

Process memory remains unmeasured; cross-platform child-tree cleanup is untested.
The browser stall is controlled, not an actual browser crash. The shared host
[connection wiring](../pty-demo/connection.ts) has
[fault-injection tests](../pty-demo/connection.test.ts): failed kill/missing then
late exit, ignored close handshake, exit during cleanup, abrupt disconnect,
unconsumed output after child exit, normal final-credit closure, and a thrown
exit notification. They use fake PTY/socket events and simulated timers, not
OS fault injection. Ordinary disconnect also retains the single-child slot
until exit is observed.
Partial renders remain governed by existing fatal-stop semantics.
