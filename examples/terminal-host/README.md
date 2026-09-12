# Terminal host example

How does a terminal receive application bytes, execute Block Operations,
render content, and send replies? This runnable example connects the
[streaming application](../streaming-text/README.md) to the existing browser
xterm adapter. Read [main.ts](main.ts) for the connection, not the test suite.

Unlike the standalone TUI client, this terminal example still imports
`prototypes/`. It teaches integration using experimental components; it is
not a published terminal SDK or an adapter for an arbitrary terminal.

## Run

On Windows with Node 24 or newer, from the repository root:

```sh
pnpm install
pnpm example:terminal
```

Open `http://127.0.0.1:4178/` and choose **Connect application**. The host
prepares the built SDK application and starts it through bundled ConPTY.
Thinking grows, becomes `Thinking complete`, and is followed by the answer.
Expect `Child exited: 0`, two sealed Blocks, and a closed Context. The
`Context states before EOF` observation distinguishes the application's
explicit close from the Session's cleanup when a stream ends.

Choose **Find next** to search for `Result:` in retained terminal content.
**Disconnect** ends a running connection without promising a successful child
exit. Reload to start fresh; the example does not reuse a finished Session.
Stop the server with Ctrl+C. This and the other PTY examples share port 4178;
run only one at a time.

## The connection

```text
Application stdout → PTY bridge → incoming bytes
                                  ↓
                         XtermMixedStreamIngress
                           ├─ ordinary bytes → xterm parser
                           └─ Messages → endpoint / Session → history adapter
                                          ↓
Application stdin  ← PTY bridge ← encoded response frames
```

The ingress keeps ordinary writes and protocol rendering in order. Feed each
incoming byte chunk into it exactly once; do not also call `terminal.write`
with the same bytes or use the protocol-only decoder for the mixed stream.
Responses go back to the application, not onto the displayed terminal.
Terminal input uses the same outbound transport. Diagnostics are local
observations, not substitute wire responses.

On normal disconnect, wait for queued input and call `ingress.finish()` before
releasing the renderer. This example keeps rendered history available for
search after EOF and disposes it when leaving the page. A rendering or transport
failure stops the example; it does not attempt rollback or reconnect recovery.

## What a terminal implementer owns

| Part | Existing implementation and responsibility |
| --- | --- |
| Message validation and encoding | [Shared protocol](../../protocol/README.md); transport-independent and included in the local SDK build. |
| Capability, Context, and Operation state | [Protocol endpoint](../../prototypes/integration/protocol-endpoint/README.md) and Session; experimental APIs, independent of xterm rendering. |
| Rendering and native history | [xterm adapter](../../prototypes/integration/xterm-protocol-endpoint/README.md) and [browser history](../../prototypes/integration/xterm-browser-search/README.md); replace these with your terminal's implementation. |
| Transport and process lifetime | [Development host](../../prototypes/integration/pty-demo/README.md); fixed child, loopback WebSocket, and bundled ConPTY, not protocol requirements. |

An adapter must connect accepted content changes to history, layout, reading
anchors, selection/copy, and other applicable
[native behavior](../../docs/protocol/terminal-native-behavior.md). It must also
keep rendered Block identity and Session state consistent when history is
discarded or destructive controls invalidate content. The current adapter's
prepare step can reject before Session commit; later asynchronous rendering
is not automatically rollback-safe.

`completeBaselineSupported: true` is an explicit assertion for this experimental
fixture, not capability detection or proof of complete conformance. A different
terminal must not claim support merely because it can parse the Messages.
The TUI SDK does not provide that missing renderer. Fallback remains the
application's decision; this page demonstrates only the supported path.

## Verification and limits

Run `pnpm typecheck`, `pnpm test`, and `pnpm build:terminal-example` from the root.
The build checks browser bundling, not a standalone deployment: running the page
still requires its development PTY host and injected connection token.

For repeatable browser checks, open `http://127.0.0.1:4178/checks.html` while the
development server is running and choose **Run browser checks**. Keep other
example connections closed. The [runner](checks.ts) operates the actual example
UI in a same-origin iframe, using two fresh SDK child processes:

- Completion: final sealed content, explicit Context close before EOF, exit
  zero, a retained answer search match, and no match for replaced thinking text.
- Early disconnect: stop after observing the initial mutable thinking Block;
  verify closed/sealed partial state, searchable partial content, no successful
  child-exit confirmation, and no answer inherited from the previous run.

Expect `2 browser scenarios passed.` The runner reports FAIL on a mismatched
result or a local fifteen-second wait deadline. It observes content instead of
sleeping a fixed interval before disconnecting. If a delayed delivery skips the
initial observable state, that check fails rather than claiming an interruption
was exercised. Reloading or rerunning uses fresh Sessions, not recovery.

These browser checks are separate from `pnpm test`; they do not establish full
protocol conformance or replace the native-capability regression suites.

On 2026-09-12, the local browser run showed the expected final content, explicit
Context close before EOF, exit zero, and a retained `Result:` search match.
An interrupted run retained its partial content and reported no child exit
confirmation. Both checks used the fixed SDK child through bundled ConPTY.
The repeatable runner subsequently passed these two scenarios locally.

The example uses pinned xterm 6.0 private history interfaces and experimental
OSC `9002`. It has a fixed 40-by-8 viewport and a local twelve-second connection
deadline. It adds no resize, Unicode, capacity, clipboard, other-terminal,
Unix/SSH/tmux, backpressure, or crash-recovery guarantees. The underlying
[PTY evidence and limitations](../../prototypes/integration/pty-demo/README.md)
remain applicable. No protocol semantics or stable public APIs are added here.
