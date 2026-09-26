# Pi stock-UI protocol trial (design draft)

Status: working design note, draft 2026-09-25

## Question

Can Pi's stock interactive UI keep its editor, footer, and status while the
transcript region — user prompts, assistant text, and one tool-result type —
is owned by protocol Blocks, with Pi's existing rendering path unchanged when
the terminal does not support the protocol?

Upstream evidence lives in
[prior art](../prior-art.md#application-architecture-evidence); the renderer
and coupling trace lives in
[Pi rendering architecture](pi-rendering-architecture.md). This note defines
the smallest trial that can answer the question. Its purpose is not upstream
acceptance; it is to learn whether terminal-owned mutable history can coexist
with a real application's stock UI, and to turn "a suitable integration seam"
from an open question into a measured patch.

## Terms

- **Transcript**: the growing conversation record (prompts, assistant text,
  tool results) that scrolls into history.
- **Chrome**: the application's interactive controls around the transcript
  (editor, footer, status); never protocol-owned in this trial.
- **Writer**: whichever side's bytes can change a given screen row — the
  terminal's Block adapter applying protocol frames, or Pi's renderer
  emitting ANSI drawing bytes.
- **Ownership**: the rule that every screen row has exactly one writer at a
  time. Two writers holding separate models of the same rows produce the
  documented failure classes (duplicated spans, blank space, cursor
  misbookkeeping).
- **Boundary**: the moving line between terminal-owned history (Blocks) and
  the app-owned active screen (chrome), maintained by the terminal-side
  adapter.
- **Seam**: the smallest upstream change that lets an outside implementation
  connect without forking internals; this trial measures it as a patch.

## Scope

- Pinned upstream: Pi 0.87.1 at `b348765`. The session-event trials stay
  pinned at 0.86.1; this trial follows interactive-UI development instead.
- Transcript mapping follows the existing trial: user prompts become
  immediately sealed Blocks, assistant text becomes one mutable Block per
  message, and one tool type (the existing read-only sample tool) becomes
  one mutable Block per call.
- Chrome stays stock: editor, footer, status, widgets, header, dialogs.
- Explicit non-goals: styled Markdown or ANSI-styled Blocks (baseline
  `text/plain` only), fullscreen mode, extension-UI compatibility, session
  persistence/resume/fork, additional tool types, non-Windows platforms,
  performance measurement.

## The central unknown: one writer per region

Two one-writer configurations already exist and neither conflicts:
unmodified Pi, where its renderer draws everything; and our existing trials,
where the application emits only protocol frames and the terminal's adapter
draws everything. This trial is the first configuration with two writers on
one screen — the patch makes Pi emit protocol frames for the transcript
while its renderer keeps drawing chrome.

InteractiveMode composes transcript components with chrome in one component
tree, and `TuiMainScreen` renders the whole tree. If transcript components
remain in the tree while the terminal mutates the same rows via Blocks, two
writers own one region (the conflicting-writers risk recorded in the
architecture trace). The trial exists to pick and validate an ownership
strategy:

- **S1 (first attempt): suppress transcript components, chrome-only tree.**
  When protocol mode is active, InteractiveMode does not add assistant/tool
  components to the TUI tree. The tree contains only chrome, so the stock
  renderer owns the active screen while the terminal owns the history above
  it. Protocol frames share the single output stream with chrome drawing
  bytes; the codec already accepts such mixed streams.
- **S2 (fallback): a filtering TUI wrapper.** Implement the `TUI` interface
  by delegation to `TuiMainScreen`, removing transcript components at the
  container boundary. Larger surface, but no InteractiveMode surgery.
- **S3 (rejected): reconstruct Blocks from rendered ANSI at the terminal.**
  No explicit content identity; mutation authority is unverifiable.

## Output path and the seam candidates

`createInteractiveTui` accepts an injected `Terminal`. A trial-owned
`Terminal` implementation can:

- pass chrome bytes through to stdout;
- carry protocol frames from the trial's SDK client on the same stream; and
- intercept OSC 9002 replies on input before Pi's input parser, passing all
  other input (editor keystrokes, keyboard-protocol replies) through
  verbatim.

What does not exist today: a public way to make the CLI use such a `Terminal`
and suppress transcript components. The trial measures that gap as a patch
against the pin. The patch is maintained in this repository, and its final
shape — files touched and lines changed — is the concrete seam proposal for
any later upstream discussion.

## Input routing risks

`ProcessTerminal` owns stdin and consumes keyboard-protocol negotiation
replies; `TuiBase` consumes OSC/DSR replies. The wrapper must not reorder or
drop either. Kitty negotiation ordering and the fragment buffer are
known-sensitive areas. Input checks cover editor typing, submission, and
cursor keys during active streaming.

## Lifecycle mapping

Reuse the multi-round mapping: one protocol Context per turn, explicit close
on completion or cancellation, abort label on cancel. Session replacement
(`/new`, resume, fork) is out of scope for the first trial. Thinking
visibility follows the existing trial policy (visible with a label);
`message_end` seals, since this trial's simplified frontend does not reopen
thinking afterwards.

## Acceptance scenarios

Fixed local provider (reusing the pi-session fixtures), Windows bundled
ConPTY, and the experimental xterm host:

1. One turn completes; user prompt, assistant text, and the tool result each
   appear once, are searchable, and seal; the editor accepts input
   throughout streaming.
2. Cancel mid-stream: partial text kept with an abort label; the editor
   stays responsive; a further prompt completes.
3. Read earlier text during streaming, then resize 60→36→60 columns:
   reading position, selection, and copy are preserved; editor and footer
   reflow correctly.
4. Negotiation negative (or trial flag off): the stock Pi experience is
   unchanged and no protocol frames are emitted.
5. Patch report: files touched and diff size recorded against the pin; that
   record is the seam definition.

## Verification and evidence

`pnpm typecheck`, focused Node tests for the adapter and the `Terminal`
wrapper, and browser checks through the existing host. Evidence is recorded
with dates in the eventual prototype README
(`prototypes/integration/pi-stock-ui/`), with claims bounded to the
scenarios actually run. The failure classes documented by the Kimi revert —
duplicated transcript spans, vanished rows, growing blank space, cursor
misbookkeeping — must be checked for absence explicitly, not assumed absent.

## Open questions for implementation

- Does suppressing transcript components break InteractiveMode bookkeeping
  (component lookup by tool-call ID, thinking toggles, OSC 133 markers)?
- Does the working/status indicator read session events (fine) or transcript
  components (needs a shim)?
- Do editor history navigation and completion depend on transcript
  components?
- What is the minimal patch surface: an event-handler gate or a
  container-level filter? Measured, not guessed.
