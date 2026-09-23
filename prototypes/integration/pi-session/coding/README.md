# Pi Coding Trial

Can Pi read a small program, reproduce a bug, edit it, and run its tests while
the terminal retains both the failed and successful results for later reading?

This extends the [multi-round frontend](../multi-round/README.md) with a generated
JavaScript project. It reuses the [Pi event adapter](../README.md#trial-mapping),
[TUI SDK](../../../../sdk/README.md), and [experimental terminal host](../../../../examples/terminal-host/README.md).
One Pi conversation and one temporary project span two prompts, with a separate
display Context per turn.

## Run

Use the [example setup](../../../../examples/multi-round/README.md#run) to clone
the repository and install dependencies on Windows with Node 24+ and pnpm 11.9.0.
Stop any example server already using port 4178. From the repository root:

```sh
pnpm prototype:pi-coding
```

Open `http://127.0.0.1:4178/`, connect, wait for `[ready 1/2]`, and send the
prefilled repair prompt. After `[ready 2/2]`, choose **Prepare follow-up prompt**
and send it. **Check retained failure, passing tests, search and copy** inspects
the terminal history without making a model call. The second turn exits the
child; history remains available. Reload creates a fresh project. Run only one
port-4178 fixture at a time and stop the server when finished.

The default provider scripts the tool choices. Pi executes actual tools, file
edits, and child-process tests.

### Use a real model

This path uses an OpenAI Codex subscription through Pi. If Pi is already signed
in to that provider on this machine, skip the login step. Otherwise, start the
repository's pinned Pi CLI from the repository root (no global Pi install needed):

```sh
pnpm --dir prototypes/integration/pi-session exec pi
```

In Pi, enter `/login`, select **OpenAI Codex**, and complete the browser sign-in.
Return to Pi to finish any prompt from the login flow, then exit Pi without
sending a task. Pi stores the authorization in your user directory; do not copy
tokens into this repository. See [Pi's provider guide](https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/coding-agent/docs/providers.md)
for its login flow.

Start the model-driven example:

```sh
pnpm prototype:pi-coding-live
```

Live mode uses the existing [Pi OAuth/model setup](../README.md#opt-in-subscription-trial)
and SSE. Each submitted prompt sends the generated code, test output, and retained
conversation to OpenAI and consumes subscription allowance. Enter only sample
task instructions. Model requests start only when a prompt is submitted.

1. Open `http://127.0.0.1:4178/` and confirm the page is labeled **LIVE**.
2. Choose **Connect application**, wait for `[ready 1/2]`, and send the prefilled
   repair prompt. Expect failing tests first, a source edit, then passing tests.
3. At `[ready 2/2]`, choose **Prepare follow-up prompt**, then **Send prompt**.
   Expect another passing test run using the same project.
4. After `Child exited: 0`, choose **Check retained failure, passing tests,
   search and copy**. It should report **PASS**; the earlier failure should still
   be findable beside the later success. This button makes no model request.

If the page reports a sign-in error, finish the Pi login step above and reload.
Model access, account limits, and network errors may also stop a live run; read
the page's **Local state and native rows** before retrying. A live model may
choose a different sequence, so the check reports missing evidence rather than
assuming success. End a running session with **End session**, then stop the
server with Ctrl+C.

## Project and Tools

`total.mjs` initially sums prices without multiplying quantities.
`total.test.mjs` contains six fixed assertions. Each connection copies both into
an allocated temporary directory; the repository fixtures stay unchanged.

| Tool | Access |
| --- | --- |
| `read_coding_file` | Read either sample file by its exact name. |
| `replace_coding_text` | Replace one exact occurrence in `total.mjs`; tests stay read-only. |
| `run_coding_tests` | Execute the fixed Node command and return its exit code and captured output. |

Reads, edits, and test runs are serialized. A failed assertion returns a nonzero
exit code for Pi to act on. Cancellation stops the running test child and leaves
completed edits in place for the next turn. Session disposal waits for tool work
and removes the temporary project.

Local limits are two prompts, 24 tool calls, eight test runs, 8,192 UTF-16 units
of source, 16 KiB of test output, and five seconds per test process. Each turn
has a two-minute cooperative deadline, with 2,048 adapter events and 64 Blocks.
The existing ten-minute session and transport budgets apply.

The test child receives an explicit minimal environment and Node `--permission`
with read access to the generated directory. Regression checks exercise denied
outside reads, writes, and child spawning. Windows supplies additional standard
environment keys. These guards reduce accidental access; Node's
[permission model](https://github.com/nodejs/node/blob/v24.20.0/doc/api/permissions.md)
is not a hostile-code sandbox and this Node version does not restrict networking.
Use this runner for the controlled sample; arbitrary repository execution needs
a separate isolation and permissions design.

## Observed Results — 2026-09-22

Both a local-provider browser run and a two-prompt live run used Windows bundled
ConPTY and the pinned experimental xterm host. The live run used Pi 0.86.1,
OpenAI Codex subscription, `gpt-5.5`, low thinking, and SSE.

| Step | Expected | Observed in both runs |
| --- | --- | --- |
| Read and test the original program | Reproduce quantity failures | Exit 1: three passed, three failed. |
| Edit and rerun | Correct quantity handling | One multiplication added; exit 0: all six passed. |
| Follow-up without edits | Reuse the same project | All six passed again; explanation included zero quantity. |
| Revisit earlier output | Keep the original failure alongside success | Failure and passing result searchable; old failure copied unchanged. |
| Finish | Close both Contexts and clean up | Both closed before EOF; child exited 0; temporary project removed. |

The live file was also inspected between turns: only `* item.quantity` was added.
Copy checks use a browser copy event with an in-memory sink. This run keeps the
40-by-8 viewport. Earlier [multi-round](../multi-round/README.md#verification)
and [paired UX](../ux/README.md) records cover additional reading and resize
scenarios. The live calls used subscription allowance; token usage was not measured.

## Verification and Files

On 2026-09-23, the [fresh-install check](../../../../examples/multi-round/README.md#verification-and-limits)
also completed both coding prompts with the local provider: three baseline
failures, six passing tests after the edit, six passing tests in the follow-up,
child exit 0, and a passing history/search/copy check. The live entry reached
`[ready 1/2]` using existing Pi authorization; no new model request was sent in
this check. The model-driven results above are from 2026-09-22.

```sh
pnpm test:pi-session
pnpm typecheck
pnpm test
pnpm build:pi-coding
```

[coding.test.ts](../coding.test.ts) checks real test execution, exact edits,
path and size restrictions, cancellation, timeout/output limits, cleanup, and
two-turn Pi-to-Endpoint state. Browser checks run separately through ConPTY.

At the recorded checkpoint, all seven coding tests and all 283 repository Node
tests passed, along with type checking and the coding browser build. The build
retains the existing xterm bundle-size warning. The original three multi-round
browser scenarios were also rerun and passed after the shared application changes.

`workspace.ts` owns files and the test process; `source.ts` defines Pi tools and
session setup; `provider.ts` supplies the deterministic model fixture. The main
entries and browser page reuse the multi-round application and terminal host.
