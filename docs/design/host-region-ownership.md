# Terminal-host region ownership (design draft)

Status: working design note, draft 2026-09-28

First step: implemented 2026-09-29 as an opt-in region-aware history mode in
the experimental xterm host (`prototypes/xterm-headless`,
`prototypes/integration/xterm-protocol-endpoint`), with eight Node checks
including the 2026-09-28 failure replay. Browser verification remains.

## Question

Can the experimental terminal host confine an application's ANSI drawing to
an app-owned screen region, so that Block-owned history and application
chrome coexist on one screen without the two writers corrupting each other?

This is the missing host feature found by the
[Pi stock-UI trial](../../prototypes/integration/pi-stock-ui/README.md)
skeleton, which records the 2026-09-28 browser failure this note answers.

## Terms

Region terms extend the [trial vocabulary](pi-stock-ui-trial.md#terms)
(writer, ownership, boundary):

- **Block region**: scrollback plus the upper viewport rows; owned by the
  terminal-side adapter, which places and mutates Blocks there.
- **App region**: the bottom rows of the viewport; owned by the application's
  ANSI drawing (Pi's chrome: editor, footer, status).
- **Boundary**: the first row of the app region. Blocks append and grow
  immediately above it; growth pushes the app region down and the viewport
  follows.
- **Watchdog**: the mixed-ingress hooks (`CSI K` / `CSI J` / `ESC c`) that
  invalidate any Context whose Block rows intersect a native erase.

## The observed failure

In the 2026-09-28 browser run, the user Block sealed and the assistant Block
opened; Pi's chrome redraw then issued a cursor-up + `CSI K` whose target row
was computed from Pi's own frame model, which does not include the rows the
adapter inserted for the Blocks. The erase landed inside Block rows, the
watchdog invalidated the Context, the next Operation was rejected, and the
trial fail-stopped. The watchdog behaved correctly; what was missing is any
notion that some screen rows legitimately belong to the application.

## Design

- **Two regions, one coordinate space.** The adapter maintains the boundary
  between the Block region and the app region on the normal buffer. New
  Blocks materialize at the boundary; Block growth above it relocates the
  app region as a whole.
- **Cursor compensation.** After every Block materialization, the adapter
  restores the cursor to the application's logical position, compensating
  for the rows it inserted. The application's cursor math then lands where
  it intends, because its frame model stays valid within its own region.
  With the trial's render gate, the application's document *is* the chrome,
  so its cursor math never legitimately reaches into the Block region.
- **Watchdog refinement.** An erase confined to the app region is legitimate
  and never invalidates. An erase intersecting Block rows still invalidates
  the Context; `ESC c` and `CSI 3J` keep their current semantics. The
  watchdog remains the true-conflict detector, not a false-alarm source.
- **Resize.** Both regions reflow: the adapter re-wraps Blocks with the
  existing reading-anchor behavior, the application re-renders chrome at the
  new width, and the adapter recomputes the boundary.

This is an experimental-host rendering detail: no protocol Message, schema,
or `terminal/` module change. Execution is terminal-owned; how a host
keeps its regions coherent is its own business. An explicit protocol-level
region declaration is a possible future extension, deliberately deferred
until the inferred version is measured.

## Boundary tracking (the hard part)

The host learns the app region's extent without application cooperation:

- The region top is the first row the application's current frame touches;
  the bottom tracks the cursor after ordinary writes. Pi's main-screen
  renderer draws its full frame on start and width change and diffs in
  between, which gives the adapter observable frame boundaries.
- Inference is only feasible because the trial's render gate makes the
  application's document exactly the chrome. Any ungated transcript output
  would land in the app region as ordinary bytes and defeat it — another
  reason protocol mode requires the gate.
- **Fail safe.** When the extent cannot be determined confidently, the
  adapter treats an ambiguous erase as a potential conflict (invalidate)
  rather than risk silent transcript corruption. The pi-stock-ui browser
  checks are the oracle for whether tracking is good enough.

## Acceptance scenarios

- The four existing pi-stock-ui browser checks pass unchanged: one turn with
  editor input during streaming, cancel plus a further turn, the 60/36/60
  resize round trip, and the stock fallback.
- New adapter-level Node checks: Block growth above the region preserves
  chrome bytes and the application's cursor math; an in-region erase does
  not invalidate; an erase inside Block rows still invalidates; a shrinking
  Block relocates the region upward; resize keeps both regions intact.

## Open questions

- The region height is dynamic (editor growth, transient status lines). Is
  passive tracking sufficient, or does the trial host need an explicit hint
  at startup? Measure with the trial before considering any declaration
  mechanism.
- Block materialization while the user is scrolled up: verified for append
  and extend in the 2026-09-29 Node checks; other operations unverified.
- Should the watchdog distinguish `CSI 0K`/`1K`/`2K` for region containment?
  First attempt treats them uniformly; verify against the checks.
- **Pi's resize emits `CSI 2J` + `CSI 3J`**, which still invalidates every
  Context under the unchanged watchdog semantics, so the browser resize
  scenario will fail-stop even in region mode. Options: filter the clear in
  the trial layer, re-materialize Blocks after the clear, or refine the
  `CSI 2J` handling. This needs a maintainer decision before the browser
  round.

Related: [Pi stock-UI trial design](pi-stock-ui-trial.md),
[terminal-native behavior](../protocol/terminal-native-behavior.md),
[Pi rendering architecture](pi-rendering-architecture.md).
