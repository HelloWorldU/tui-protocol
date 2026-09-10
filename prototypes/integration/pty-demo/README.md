# Real PTY Protocol Demonstration

Can a real, fixed TUI process negotiate the protocol, change historical Blocks,
and receive a rejection through a PTY while the browser preserves the tested
reading, selection/copy, and search states?

This experimental demonstration uses the [TUI SDK](../../../sdk/README.md)
in its child process and composes the [reference codec](../../../protocol/README.md),
[protocol Session](../../protocol-session/README.md),
[mixed xterm endpoint](../xterm-protocol-endpoint/README.md), and
[browser search/selection history](../xterm-browser-search/README.md).
It exercises the [Operation](../../../docs/protocol/operations.md),
[framing](../../../docs/protocol/framing.md), and
[terminal-native](../../../docs/protocol/terminal-native-behavior.md) drafts
across a process boundary; it does not define new protocol semantics.

## Path

```text
Fixed Node TUI: SDK → codec → stdout
  ↕ bundled Windows ConPTY
Local host: PTY data ↔ WebSocket
  ↕
Browser: codec / Session ↔ xterm history, selection, search
```

The host forwards data; it does not synthesize capability or Context responses.
The browser sends encoded responses back through ConPTY to the child’s stdin.
The binary WebSocket traffic and its JSON resize/exit controls are local host
plumbing, not additions to the protocol's wire Message schema.

## Run

On Windows, from the repository root with Node 24 or newer:

```sh
pnpm install
pnpm prototype:pty-demo
```

Open `http://127.0.0.1:4178/` and choose **Run guided checks** on a fresh page.
It runs one complete story, prints PASS or FAIL, and closes the child on failure.
Reload for another run. Only one connected demonstration client is allowed.
Alternatively, use **Next stage** (or type `n` in the terminal), resize, search,
and close with `q`. Do not start guided checks halfway through manual stages.
Stop the development server when finished.

`pnpm build:pty-demo` checks browser bundling only. Its output under `.tmp/`
is not a standalone application: the development host supplies the PTY bridge.

## Observed Result

On 2026-09-10 the same guided sequence was rerun after moving the child to the
SDK. The child no longer constructs protocol envelopes, frame IDs, or control
request IDs; incremental base IDs remain explicit application state.

On 2026-09-09, Windows `10.0.19044`, Node `v24.20.0`, `node-pty` `1.1.0`,
bundled ConPTY `1.23.251008001`, and pinned xterm.js `6.0.0`, the guided browser
run passed this fixed sequence:

1. The child received capability and Context-open responses before appending
   mutable thinking, a sealed Chinese result, and enough tail rows for scrollback.
2. Three separately timed Extend Messages grew thinking; ReplaceSuffix then
   shortened it, and Update supplied its final text. The later result remained
   at the viewport top with the same selected Chinese text and copy source.
3. A `40 → 10 → 40` column round trip resized both browser xterm and the real PTY.
   The narrow result occupied multiple rows. Its selection and reading anchor
   survived the checks, with the Context still open.
4. Search found retained result text. Seal froze thinking; a later Update was
   rejected without rendering its payload. The child actually received
   `block_sealed`, then sent a diagnostic capability query as a return-path
   witness. This witness is not an Operation acknowledgement or retry mechanism.
5. The child received the Context-close response and exited with code zero.

The first run exposed a selection-fixture omission: an endpoint in a different
Chinese Block was treated as an ordinary ASCII line when the earlier Block
extended. The renderer now resolves other managed Blocks before trying an
ordinary-line anchor. An independent
[browser regression](../xterm-browser-protocol-endpoint/scenarios/chinese-mixed-selection.ts)
checks two earlier extensions with a later Chinese/Tab selection.

## Host Scope and Limits

- The [transport probe](../pty-transport/README.md) recorded a return-path failure
  on this machine's older system ConPTY. This host explicitly uses the approved
  bundled DLL through `useConptyDll: true`; it does not upgrade Windows or claim
  compatibility with other ConPTY builds, Unix PTYs, SSH, or multiplexers.
- The host listens only on loopback, requires its expected Origin/Host and a
  per-server random token, starts only the fixed Node producer, validates resize
  dimensions, and limits a connection to ten minutes. No shell-command or
  arbitrary executable API is exposed. Local smoke checks rejected missing
  tokens, wrong Origin/Host, a second client, and invalid resize; reconnect and
  disconnect completed. This is not an authentication or sandboxing product.
- Frames use experimental OSC `9002` and the existing pinned private xterm
  history interfaces. The dependency and build permission for `node-pty` are
  repository-local; no system policy is changed.
- Only this small finite story is exercised. There is no AI SDK, interactive
  line editor, arbitrary output workload, backpressure guarantee, crash recovery,
  capacity-eviction test over PTY, or general Unicode/IME claim.
- Copy checks dispatch synthetic clipboard events, not OS clipboard writes.
  Native ConPTY controls enter the existing ordinary-output path; the host does
  not remove them. Resize checks observe the state after 300 ms at each size
  and later Operations; they are not a general asynchronous-settlement proof.
- Browser observations wait for rendered inbound Operations; no new successful
  Operation response is invented. The standalone transport probe remains a
  separate negative/positive diagnostic, not part of `pnpm test`.
