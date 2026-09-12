# Streaming text example

A small application that uses the built [TUI SDK](../../sdk/README.md), without
importing prototype code. It demonstrates negotiation, incremental thinking
output, a final answer, and application-owned fallback. It does not call an LLM.

For the other side of the connection, see the
[terminal host example](../terminal-host/README.md).

## What you should see

| Terminal response | Application behavior |
| --- | --- |
| Supports the baseline | Create a mutable thinking Block, extend it three times, replace it with `Thinking complete`, seal it, append a sealed answer, then close the Context. |
| Explicitly unsupported | Print readable, append-only progress and the answer; send no Context or Block Messages. |
| No negotiation response | After the local 1.5-second deadline, use the same ordinary-text fallback. |

Fallback is this application's choice, not a renderer supplied by the SDK.
Redirected input or output skips negotiation entirely, keeping output free of
protocol frames. The deadline is an example setting, not a protocol constant.

## Run with the experimental terminal

On Windows, with Node 24 or newer, run from the repository root:

```sh
pnpm install
pnpm example:streaming
```

Open `http://127.0.0.1:4178/streaming-example.html`. Choose **Run supported**,
**Run unsupported**, or **Run silent**. Each button starts a fresh child process
with the same application code; only the terminal host's response policy changes.
Wait for PASS or FAIL before starting another run. Stop the server with Ctrl+C
when finished. The original PTY demo uses the same port; do not run both servers
at once.

This command builds the SDK and prepares the application automatically. A real
Windows PTY connects it to the browser terminal. The negative and silent modes
are controlled host fixtures, not tests of unrelated terminal products.

## Use the prepared application separately

```sh
pnpm prepare:streaming-example
node --no-experimental-strip-types "<printed path to streaming-text.mjs>"
```

The preparation command prints an entry path in a fresh `.tmp/sdk-build-*`
directory. Keep or copy that entire directory: the application needs its sibling
compiled SDK and protocol files. The prepared copy runs as JavaScript; it does
not need the repository's TypeScript sources or a PTY library. Preparation still
requires the repository and its installed build dependencies.

An existing terminal must implement the protocol to take the supported path.
Installing this example does not add protocol support to an unmodified terminal.
The source `main.mjs` is a template for the prepared directory, not a directly
runnable entry in its source location.

## Files and responsibilities

- [main.mjs](main.mjs): application logic, stdin/stdout transport, fallback, and cleanup.
- [prepare.ts](prepare.ts): build the SDK and copy the application beside it.
- [example.test.ts](example.test.ts): run that output outside the checkout with redirected streams.
- [Browser host](../../prototypes/integration/pty-demo/streaming-example.ts): terminal-side integration checks; not an application dependency.

The application owns raw-input mode and restores its previous setting on exit.
It handles Ctrl+C while reading raw input, uses an eight-second overall deadline,
and stops on protocol diagnostics or Operation rejections. Other ordinary keys
have no behavior in this finite example. A failure after opening a Context does
not silently switch renderers: remote state may already have changed.

Incremental base IDs remain explicit. A returned Operation ID means sent, not
acknowledged or rendered. This example adds no automatic retry or successful
Operation response. Only a successful run explicitly closes its Context;
disposing the client after failure is local cleanup, not remote recovery.

## Verification scope

Run `pnpm typecheck` and `pnpm test` from the root for static and automated checks.
The isolated application test checks exact fallback output with no escape bytes,
outside the checkout and with Node's TypeScript execution disabled.

The three browser modes separately check child exit, received Message counts,
final Block state and searchable answer on success, or ordinary fallback output
with no Context/Block Messages. They use the existing pinned xterm renderer and
bundled Windows ConPTY described in the [host notes](../../prototypes/integration/pty-demo/README.md).
On 2026-09-12, all three modes passed locally, alongside type checking and
157 Node tests. The browser checks are run separately, not by `pnpm test`.
These checks do not establish compatibility with other terminals, Unix PTYs,
SSH/tmux, arbitrary workloads, or production recovery/backpressure behavior.
