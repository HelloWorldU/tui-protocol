# Entered-prompt Pi multi-round trial

## Question and scope

Can a user enter successive prompts into one real Pi conversation, cancel a
streamed answer, and continue while earlier terminal history remains available?

This extends the [finite Pi session trial](../README.md), reusing its event
mapping, the [SDK](../../../../sdk/README.md), and the
[experimental terminal host](../../../../examples/terminal-host/README.md).
It exercises [Context lifecycle](../../../../docs/protocol/contexts.md) across
turns. It is a separate plain-text frontend, not Pi's stock interactive UI,
a general coding environment, or a production terminal.

## Stage-three completion boundary

This stage delivers a finite, entered-prompt Pi frontend paired with our
experimental terminal. Its acceptance checks are retained multi-round model
context; continuation after assistant/tool cancellation; old reading,
selection/copy and search during subsequent output; fail-stop and cleanup;
and a separately recorded, deliberately initiated subscription trial.
These bounded checks are complete at the 2026-09-21 checkpoint below.
It does not include the stock Pi editor, arbitrary tools, durable sessions,
an unmodified external terminal, packaging a desktop app, or production readiness.

## Run

From the repository root, with the existing Node 24+/pnpm dependencies:

```sh
pnpm prototype:pi-multi
```

Open `http://127.0.0.1:4178/`, connect, wait for `[ready 1/5]`, enter a prompt,
and choose **Send prompt**. This default uses a deterministic local model
provider through the actual pinned Pi 0.86.1 SDK: it reads the fixed sample,
echoes the entered prompt, and includes the preceding prompt if one exists.
It does not reason about arbitrary questions, contact a model, or read credentials.

**Cancel current turn** retains whatever partial response Pi has produced and,
when Pi settles without reporting an error, permits another prompt after the
next ready marker. **End session** cancels any active turn and exits after
cleanup; **Disconnect immediately** closes the
transport and is not a successful-completion claim. Search, native scrolling,
selection, and copy use the existing experimental host. Reload for a fresh
conversation; the form draft stays after sending because transport delivery
does not mean the application accepted it.

Only the form supplies prompts. Terminal keystrokes are not forwarded in this
page; this avoids competing with protocol replies or pretending to implement
Pi's editor. Busy prompts are rejected with a notice, not queued or used as
steering messages. Application controls are newline-delimited JSON on ordinary
stdin after protocol-response decoding; they are not new protocol Messages.

### Optional live source

```sh
pnpm prototype:pi-multi-live
```

This selects the existing Pi OpenAI Codex OAuth source and explicit SSE model
transport. The [login and model-selection rules](../README.md#opt-in-subscription-trial)
still apply. Each accepted prompt sends its text, retained conversation, tool
definition, and any sample result to OpenAI and consumes subscription allowance.
Do not enter secrets. No project files or shell tools are exposed. The only
tool reads the repository's fixed `fixtures/sample.txt`; it cannot choose paths.
Automatic fixture checks are disabled in live mode. An optional, explicitly
armed one-shot helper clicks Cancel after visible assistant text; it never
starts a prompt. A [four-prompt live checkpoint](live-checkpoint.md) records
tool use, retained context, assistant cancellation, a subsequent successful
prompt, search, and exit. This finite result is not provider-reliability evidence.

Both commands share port 4178 with the other PTY examples; run one at a time.
Stop the server with Ctrl+C. Builds require the development host and its injected
connection token to run; they are not standalone deployments.

## Lifecycle and limits

- One in-memory Pi session retains model conversation across turns. Each turn
  gets a fresh protocol Context and event adapter; normal completion/cancellation
  closes that Context explicitly while leaving its display history available.
  Reusing local Block names in a new Context does not reuse their identity.
- At most five submitted turns, including cancellations, per connection;
  2,000 UTF-16 units per prompt; ten sample reads per Pi session. A cancellation
  before Pi starts the prompt can leave an empty closed Context and no model
  conversation entry. These are local trial policies, not negotiated limits.
- A turn has a 60-second cooperative deadline, and the application a ten-minute
  deadline including idle time. The browser closes after ten minutes plus ten
  seconds. Cancellation/deadlines request Pi abort; this does not prove a bound
  for an unresponsive provider or tool.
- Existing per-turn adapter/event/content and output budgets apply, together
  with host Session/pending-input limits. Five turns is not a bound on total
  process memory, live tokens, or cost. Automatic retries and compaction remain
  disabled; model context-window exhaustion is not recovered automatically.
- A model, protocol, transport, parsing, or resource failure stops this
  connection. It does not start a fallback UI, reopen failed Contexts, retry,
  or report a completed turn. EOF may close an incomplete display Context;
  closure alone is not evidence of successful completion.

### Cancellation at a tool boundary

The initial implementation stopped after cancelling the sample tool: Pi tried
to prepare another model request with an already-aborted signal, and its
[`lazyStream` setup handling][pi-lazy] classified that exception as an ordinary
assistant error. This was observed in the pinned local-provider setup, not a
claim about all providers or Pi versions.

The trial source now installs Pi's public
[`shouldStopAfterTurn` hook][pi-agent] to stop when the active run signal is
aborted. The [agent loop][pi-loop] calls it after settling tool results, before
the next model turn. The cancelled tool's error result stays visible, the round
is marked aborted, its Context closes, and the next user prompt can run.
No upstream files or returned errors are rewritten. Genuine model errors still
fail the connection; we do not recognize cancellation by matching error text.
This does not guarantee cancellation of an unresponsive tool/provider or turn
every error racing with cancellation into a resumable outcome.

## Files

| File | Responsibility |
| --- | --- |
| `application.ts` | Own negotiated transport, ready/busy/turn loop, deadlines, and cleanup. |
| `commands.ts` | Bound and parse form commands independently of protocol replies. |
| `provider.ts` | Local deterministic responses using actual Pi conversation/tool inputs. |
| `main.ts`, `main-live.ts` | Compose the fixture or explicitly selected subscription source. |
| `browser.ts`, `index.html` | Enter prompts and send cancel/end controls through the reused host. |
| `vite.config.ts`, `page-mode.ts` | Select one fixed child, inject source labels, and fail closed if live fixture-control removal cannot be applied. |
| `checks.ts`, `checks.html` | Repeat the multi-round local-provider browser scenarios. |
| `native-checks.ts` | Inspect reading position, selection/copy, both cancellation boundaries, and finite exit in the supporting browser host. |
| [../multi-round.test.ts](../multi-round.test.ts) | Real Pi plus in-process protocol/Session lifecycle and input checks. |
| [../multi-round-page.test.ts](../multi-round-page.test.ts) | Verify live labels and removal of both fixture-test entry points. |
| [live-checkpoint.md](live-checkpoint.md) | Expected-versus-observed record of deliberate subscription calls. |

## Verification

```sh
pnpm typecheck
pnpm test:pi-session
pnpm test
pnpm build:pi-multi
```

While serving the default fixture, open `/checks.html` and choose **Run checks**.
Recorded on 2026-09-21 using Windows bundled ConPTY and experimental browser
xterm, the three grouped checks passed:

1. Two entered prompts share Pi conversation state; each display Context closes.
2. Cancelling the third streamed answer retains partial content; the fourth
   prompt completes in the same Pi session, with the cancelled user turn retained.
3. Earlier input remains searchable; ending while idle confirms child exit zero
   and all four Contexts explicitly closed before EOF.

On a fresh main page in fixture mode, **Run native and cancellation checks**
also passed four grouped checks through real ConPTY and xterm:

1. Reading an old marker above the bottom: its screen row, selection, and copied
   text remain unchanged during the second turn's stream and after completion.
2. Cancelling the sample tool in the third turn settles its result and returns
   to a ready state with that Context closed.
3. Cancelling assistant streaming in the fourth turn still permits the fifth
   prompt to complete; the five-turn limit then exits 0 with five closed Contexts.
4. Old content remains searchable and copyable after exit.

At this checkpoint, type checking, 52 focused Pi Node tests, all 276 Node tests,
and the multi-round, single-round Pi, and terminal-host browser builds passed.
The original two single-round Pi browser scenarios were rerun and passed.
The live page's warning and disabled automatic-check page were separately
checked before the [finite subscription run](live-checkpoint.md). Builds retain
the existing xterm bundle-size warning. Counts are recorded checks, not exhaustive coverage.

The Node checks additionally exercise UTF-8 split input, malformed/oversized
commands, busy-prompt rejection, immediate cancellation, active/idle quit,
second-turn model failure, terminal rejection, EOF, deadlines, unsupported
negotiation, output-budget rejection, and input-mode/listener cleanup.
They also exercise tool cancellation followed by another turn.
The browser checks are separate from `pnpm test`. They inspect terminal/Session
state and search through the real PTY path. The native runner uses public xterm
selection/scroll methods and the real copy handler with an in-memory clipboard
sink; it does not test a physical mouse drag, the OS clipboard, or long-duration
usability. Wider native-capability evidence remains in the host's separate suites.

The viewport stays 40 by 8. No new resize, capacity-reclamation, arbitrary
Unicode interaction, backpressure, multi-client, reconnect, persistence, Unix,
SSH/tmux, stock Pi editor/extensions, rich Markdown, or other-terminal support
is claimed. Pinned xterm private interfaces and OSC 9002 remain experimental.

[pi-lazy]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/ai/src/api/lazy.ts
[pi-agent]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/agent.ts
[pi-loop]: https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/agent-loop.ts
