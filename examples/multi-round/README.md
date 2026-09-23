# Multi-round application example

A small simulated Agent that accepts user commands and revises earlier content
after later output exists. It uses the built TUI SDK and the existing
[terminal host wiring](../terminal-host/README.md), not a real model or a new
protocol feature. The browser renderer still depends on experimental xterm
code under `prototypes/`.

## Run

Use Windows with Git and Node.js 24 or newer. In PowerShell, check `git --version`
and `node --version`. Install the repository's pnpm version if needed:

```sh
npm install --global pnpm@11.9.0
```

Download the project into a directory you choose:

```sh
git clone https://github.com/HelloWorldU/tui-protocol.git
cd tui-protocol
```

If you already have the repository, open a terminal at its root instead. Then:

```sh
pnpm install
pnpm example:multi-round
```

Open `http://127.0.0.1:4178/` and choose **Connect application**. Wait for
`[ready 1/3]`, then choose **Next round** or focus the terminal and press `n`.
There are at most three rounds. Commands received during generation are dropped,
not queued. Each round shows a prompt, growing thinking, simulated tool output,
and an answer. Thinking then shrinks while later content already exists;
the answer's draft suffix is replaced and extended before being sealed.

### What to try first

1. Run one round. After a few seconds, scroll up inside the terminal: the
   multi-line thinking has become `Thinking 1: complete`, followed by the tool
   result and `Answer 1: result`.
2. Search for `Answer 1: result`: **Find next** should find it. Search for
   `Gathering context`: it should say **No match**, because that text was replaced.
3. Wait for `[ready 2/3]`, then run another round. Search for `Answer 1: result`
   again: the earlier answer remains available alongside the new round.

The important change is in the retained history: earlier content is replaced,
while later output remains. Search and scrolling let you inspect that directly.

Scroll back, select/copy text, or use **Find next** while output changes. Press
`q` (or Ctrl+C while the terminal has focus) to stop, including during generation.
The application retains partial content and explicitly closes its Context.
After three rounds it closes automatically. Both normal paths should report
`Child exited: 0`; diagnostics distinguish explicit close from EOF cleanup.

**Disconnect** instead drops the transport and does not promise orderly
application completion. Reload for a fresh session. Closing the page kills its
child; stop the server with Ctrl+C. Only one PTY example may use port 4178 at
a time. The application has a two-minute deadline and the page a 125-second
deadline; neither automatically reconnects after failure.

### If startup fails

- If PowerShell refuses to run `npm.ps1` or `pnpm.ps1`, use `npm.cmd` or
  `pnpm.cmd` in the same commands; no execution-policy change is needed.
- If port 4178 is occupied, stop the other example server with Ctrl+C before
  starting this one. Open the address printed by the server only after it starts.
- If the two-minute session deadline expires while reading the instructions,
  reload the page and connect again.

For a model-driven read/edit/test task, stop this server and follow the
[Pi coding trial](../../prototypes/integration/pi-session/coding/README.md#use-a-real-model).

## Application and host separation

- [application.mjs](application.mjs) owns input, negotiation, fallback, and cleanup.
- [rounds.mjs](rounds.mjs) contains the fixed content and Operation sequence.
- [commands.mjs](commands.mjs) accepts `n` only while waiting and handles quit.
- [prepare.ts](prepare.ts) builds the SDK and copies those three JavaScript files
  into a self-contained local output directory.
- [main.ts](main.ts) reuses terminal-host wiring; [vite.config.ts](vite.config.ts)
  starts the fixed application through the existing bundled-ConPTY bridge.
- [checks.ts](checks.ts) drives the real page; [example.test.mjs](example.test.mjs)
  checks application logic and the prepared fallback outside the repository.

`pnpm prepare:multi-round-example` prints the prepared application path. Running
that file with Node outside a supporting terminal produces a finite,
non-interactive three-round plain-text fallback. Redirected input/output skips
negotiation entirely; a TTY without a positive capability response uses fallback
after negotiation. The application, not the protocol, chooses this behavior.

## Verification and limits

On 2026-09-23, a fresh clone with an empty pnpm store installed all 141 packages
and ran both browser scenarios below on Windows x64, Node 24.20.0, and pnpm
11.9.0. The checkout used the installation-policy fix: explicitly skip the
published `@google/genai` and `protobufjs` packages' unnecessary install hooks.
An earlier clean install exposed these unreviewed hooks as a fatal pnpm error.
No dependencies or build outputs were copied from the development checkout.

The shared host now selects the [trial resource budgets](../../docs/design/trial-resource-budgets.md)
for retained Session state and queued input. Exhaustion does not trigger an
automatic reconnect; these counters do not measure total process memory.

Run `pnpm typecheck`, `pnpm test`, and `pnpm build:multi-round-example`.
The build is not a standalone deployment: the page needs its local PTY host.
Open `http://127.0.0.1:4178/checks.html` and choose **Run browser checks** for
two additional real-process scenarios:

1. Command all three rounds; search tool output during generation and final
   answers afterward; check replaced text is no longer searchable, prompt/tool
   rows occur once, and the Context closes before child exit.
2. Quit during initial thinking; check partial content is sealed by closure,
   no answer or next round is generated, and the child exits successfully.

On 2026-09-15 these two browser scenarios passed locally through Windows bundled
ConPTY. Four application checks, the full 176-test Node suite, type checking,
and the browser build also passed. Both original terminal-host browser checks
also passed as regressions. Tests wait for observed states; missing intermediate
states fail rather than being treated as successful interruption coverage.

This is a finite interaction example, not evidence of long-running stability,
bounded process memory, capacity eviction, backpressure, or automatic recovery.
It uses fixed ASCII content, a 40-by-8 viewport, pinned xterm 6.0 private APIs,
and experimental OSC 9002. Selection/copy can be tried manually here; these two
browser checks do not add clipboard or reading-anchor assertions. Existing
[native capability experiments](../../docs/README.md) retain their own evidence
boundaries. Other terminals, Unix, SSH, and tmux are not validated by this example.
