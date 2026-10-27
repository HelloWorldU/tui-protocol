# Tabby demo plugin prototype

## Question and scope

Can the experimental receiver run through Tabby's normal plugin seams: a
`TerminalDecorator` for the tab and xterm instance, and a `SessionMiddleware`
for bidirectional session bytes? This prototype uses the official
[`TerminalDecorator`](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/api/decorator.ts),
[`SessionMiddleware`](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/api/middleware.ts),
and [`XTermFrontend`](https://github.com/Eugeny/tabby/blob/467ce8ebfa467fb88cf6d154c9a5891e3d3647f0/tabby-terminal/src/frontends/xtermFrontend.ts)
interfaces at `tabby-terminal@1.0.231-nightly.0`.

The receiver composes the existing terminal Endpoint, mixed-stream ingress,
and experimental region-aware xterm history. Ordinary output uses Tabby's
`BaseTerminalTabComponent.write()` and stays ordered with protocol rendering;
a parser-completion barrier then lets the region tracker sample the realized
cursor. A persistent streaming UTF-8 decoder preserves characters split across
session chunks. Protocol responses return through `outputToSession`. The
middleware is inserted before Tabby's OSC processor. Input uses the existing
middleware path unchanged.

See the [stock and protocol side-by-side walkthrough](side-by-side.md); its
verification recording stays local, and a presentation recording is pending.

This is a development spike, not a stable plugin release. It still depends on
private xterm.js internals through `PrivateCoreBlockHistory`. The long-session
policy below reclaims closed Context snapshots and fully evicted render
projections. Abandoned open Contexts, slow consumers, steady-state behavior
beyond the measured session, and platforms other than Windows bundled ConPTY
remain open. Independent protocol applications can run sequentially in one tab:
each SDK client has a distinct request-ID namespace, so control replay cannot
return an earlier application's closed Context. Multiple rounds within one Pi
process are supported.

## Plugin-only xterm compatibility

The plugin deliberately retains ordinary output and protocol Blocks in one
xterm history; a second xterm instance would no longer demonstrate that shared
history. Using private internals is an acceptable limitation for this research
plugin, not a requirement for terminal vendors: a native integration controls
its own buffer implementation and does not need this adapter.

Before activating a terminal session, `compatibility.ts` reads Tabby's own
`tabby-terminal/package.json` declaration and checks the private surface used
by the history adapter: `_core._bufferService`, the active buffer's numeric
state, `lines.get`/`splice`, markers, blank-line copying, and `_onScroll.fire`.
Only the tested `^5` declaration is accepted. [Tabby 1.0.238's manifest](https://github.com/Eugeny/tabby/blob/v1.0.238/tabby-terminal/package.json#L21-L31)
uses that declaration, and its [official lockfile](https://github.com/Eugeny/tabby/blob/v1.0.238/tabby-terminal/yarn.lock#L48-L51)
resolves xterm.js 5.5.0. Tabby bundles xterm.js without exposing its package
through `require("@xterm/xterm/package.json")`, so the runtime check combines
Tabby's declared version range with the actual private structure; it is not an
independent read of the exact bundled xterm.js version.

A version mismatch, missing or malformed field, or receiver construction
failure prevents receiver construction and middleware insertion and leaves
passthrough unchanged. The capability query therefore receives no response,
allowing the application to take its normal stock-rendering path. One shared
decorator gate reports the compatibility failure once per loaded plugin
instance, rather than once per tab. New or forked hosts must be verified before
their version declaration is accepted.

## Build and check

From the repository root:

```sh
pnpm install
pnpm build:tabby-demo
node --test prototypes/integration/tabby-demo/*.test.ts
```

The build writes a self-contained UMD plugin to
`.tmp/tabby-demo-plugin/`, with `package.json`, `README.md`, and `LICENSE`.
Tabby, Angular, and RxJS remain external; protocol, terminal, and host code are
bundled. Workspace-only dependency declarations are removed from the prepared
package.

The tests cover split UTF-8 and SDK negotiation, response routing, ordinary
output, historical Block Update, lifecycle, compatibility rejection before
receiver construction, and one-time notification. Reclamation checks cover 20
sequential Contexts without retained Session snapshots, full-eviction
projection cleanup, and native reset after reclamation. Real SDK children run
through Windows bundled ConPTY, including two sequential children on one
receiver. The desktop evidence below complements those checks.

## Desktop evidence, 2026-10-26

- The official Tabby 1.0.238 portable package, verified against its published
  SHA-256, loads the built plugin through the normal `TABBY_PLUGINS` path.
- Ordinary CMD input/output works. The SDK child completes with `SDK_EXIT:0`,
  ordinary markers before and after the protocol, and a historical Block Update.
- Two independent SDK children run sequentially in one Tabby tab. Both exit 0,
  receive distinct `context-1` and `context-2`, and close cleanly. Both updated
  Block histories remain present; neither child receives the other's cached
  closed Context.
- The real Pi stock UI completes two consecutive rounds with the deterministic
  local provider. Both Contexts and all eight Blocks are closed/sealed; a
  700/1002-pixel viewport round trip preserves them. Repeating the two-round
  check with the compatibility guard produced two closed Contexts and eight
  sealed Blocks, including both distinct user prompts.
- An artifact-only fault injection changed the accepted declaration to `^999`
  while Tabby supplied `^5`. Two terminal tabs had no protocol middleware and
  retained passthrough. The first attachment logged one compatibility warning;
  the second produced no further warning. Real Pi printed its unsupported-
  protocol message, entered stock mode, and completed one round with one copy
  of the prompt and result. The injected change was confined to `.tmp`.
- The initial second-round failure isolated a timing requirement: Tabby's
  small-write flow-control path may resolve before xterm has parsed the data.
  Waiting for a subsequent xterm write callback before sampling the cursor
  removed that failure in this check. This is evidence for the tested path, not
  a claim that every terminal frontend or long session is covered.

## Long-session and reclamation evidence, 2026-10-27

The [retention policy](../../../docs/design/trial-resource-budgets.md#closed-context-reclamation)
releases closed Session snapshots after rendering drains, without reclaiming
open or invalidated Contexts or changing control replay and idempotent closure.
The renderer keeps visible Blocks for native reading and releases fully evicted
projection content. Its invalidation path uses renderer-owned ranges, so
reclaimed Session snapshots are not needed for later cleanup. Receiver metrics
are cumulative counters, not retained snapshots.

Before this policy, the same real-Tabby check completed 16 rounds and 34 Blocks,
then failed the seventeenth `context.open` with `Local session budget exhausted:
Context records`. With the policy enabled, one Pi process in one Tabby tab
completed all 20 rounds. All 20 Contexts and 42 Blocks closed/sealed; no Session
Context snapshots remained after completed rounds, 42 Blocks remained rendered,
all 20 user prompts occurred exactly once, and no protocol errors or invalidated
Contexts were observed. A 700x900/1002x753 viewport round trip then preserved
those counts and the first and last Block ranges.

Two sequential SDK children in another tab also exited 0 with reclamation
enabled. The counters showed distinct `context-1` and `context-2`, each with one
sealed Block and no retained Session snapshot; both updated Blocks remained
rendered and neither child received the other's cached closed Context.

The memory samples below used CDP `Runtime.getHeapUsage` after an explicit GC,
`process.memoryUsage()` for renderer RSS, and PowerShell `Get-Process` for the
browser and renderer working sets (WS). The driver checked both PID roles rather
than relying on process order. Values are from one run, not a steady-state bound.

| Round | Closed Contexts | Closed Blocks | Session Contexts | JS heap (MiB) | Browser WS (MiB) | Renderer WS (MiB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 49.24 | 188.18 | 224.06 |
| 5 | 5 | 12 | 0 | 50.31 | 188.61 | 225.27 |
| 10 | 10 | 22 | 0 | 50.50 | 190.21 | 225.56 |
| 15 | 15 | 32 | 0 | 50.59 | 191.68 | 225.96 |
| 20 | 20 | 42 | 0 | 50.68 | 190.76 | 225.69 |

JS heap increased by 1,513,508 bytes (1.44 MiB); renderer RSS increased from
222.85 to 225.76 MiB. Retained terminal history and Pi's own conversation can
still grow. Control replay remains capped at 1,024 results, and xterm capacity
policy still applies. This demonstrates bounded closed-snapshot reclamation and
measured behavior for the demo, not unlimited connection lifetime or flat
process memory. Behavior beyond 20 rounds, abandoned Contexts, and slow
consumers remains unverified.

With the built plugin loaded in a visible Tabby started with
`--remote-debugging-port=9222`, reproduce the 20-round check from the repository
root:

```sh
node prototypes/integration/tabby-demo/long-session-check.ts --rounds 20 --pace 5 --output .tmp/tabby-long-after-20.json
```

The driver opens a new CMD tab, uses the deterministic local provider, checks
all rounds and retained prompts, and writes the complete report. The validation
above used separate Tabby configuration and Chromium `userData` directories.
Its CDP/Angular inspection is experimental test tooling, not an additional
production integration API.

## Try in Tabby

1. Build the plugin, then copy `.tmp/tabby-demo-plugin` into the directory opened
   by Tabby's **Settings → Plugins → Open Plugins Directory**. Restart Tabby.
2. Open one ordinary shell tab and run `echo ordinary shell`; input and output
   should remain ordinary terminal behavior.
3. Change to this repository checkout in a Tabby tab and run:

   ```sh
   node prototypes/integration/pi-stock-ui/main.ts
   ```

   This starts the real Pi stock UI with its deterministic local provider, not a
   model subscription. With the plugin working, the transcript is protocol-owned
   while Pi keeps its editor and footer. Without a supporting terminal, the same
   child uses Pi's stock rendering fallback. Submit further prompts in that Pi
   process to exercise multiple rounds. After it exits, another independent
   protocol application can run in the same tab.

Do not claim that upstream Pi natively emits the protocol: the trial composition
enables it without editing Pi's source files.
