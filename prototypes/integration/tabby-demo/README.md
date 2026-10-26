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

This is a development spike, not the completed demo terminal. It still depends
on private xterm.js internals through `PrivateCoreBlockHistory`. The public-API
migration, long-session policy, and platforms other than Windows bundled
ConPTY remain open. Each independent protocol application currently needs a
fresh tab: control request IDs and their replay results live in the shell's
receiver, so a later application can otherwise inherit an earlier closed
Context. Multiple rounds within one Pi process are supported.

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
output, historical Block Update, lifecycle, and a real SDK child through
Windows bundled ConPTY. The desktop evidence below complements those checks.

## Desktop evidence, 2026-10-26

- The official Tabby 1.0.238 portable package, verified against its published
  SHA-256, loads the built plugin through the normal `TABBY_PLUGINS` path.
- Ordinary CMD input/output works. The SDK child completes with `SDK_EXIT:0`,
  ordinary markers before and after the protocol, and a historical Block Update.
- The real Pi stock UI completes two consecutive rounds with the deterministic
  local provider. Both Contexts and all eight Blocks are closed/sealed; a
  700/1002-pixel viewport round trip preserves them.
- The initial second-round failure isolated a timing requirement: Tabby's
  small-write flow-control path may resolve before xterm has parsed the data.
  Waiting for a subsequent xterm write callback before sampling the cursor
  removed that failure in this check. This is evidence for the tested path, not
  a claim that every terminal frontend or long session is covered.

## Try in Tabby

1. Build the plugin, then copy `.tmp/tabby-demo-plugin` into the directory opened
   by Tabby's **Settings → Plugins → Open Plugins Directory**. Restart Tabby.
2. Open one ordinary shell tab and run `echo ordinary shell`; input and output
   should remain ordinary terminal behavior.
3. In a fresh tab for each independent protocol application, change to this
   repository checkout and run:

   ```sh
   node prototypes/integration/pi-stock-ui/main.ts
   ```

   This starts the real Pi stock UI with its deterministic local provider, not a
   model subscription. With the plugin working, the transcript is protocol-owned
   while Pi keeps its editor and footer. Without a supporting terminal, the same
   child uses Pi's stock rendering fallback. Submit further prompts in that Pi
   process to exercise multiple rounds. After it exits, use another fresh tab
   for the next independent protocol application.

Do not claim that upstream Pi natively emits the protocol: the trial composition
enables it without editing Pi's source files.
