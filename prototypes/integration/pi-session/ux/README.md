# Pi Reading UX Comparison

## Question

Does the protocol frontend preserve a reader's position and selected text when
an actual Pi session streams more output, replaces earlier tool progress, or
the terminal width changes? Does Pi's regular frontend behave differently under
the same fixed presentation inputs?

This compares the pinned Pi 0.86.1 `InteractiveMode` in regular mode with our
[plain-text Pi frontend](../README.md). It composes the Pi session, event
adapter, [SDK](../../../../sdk/README.md), and experimental
[xterm endpoint](../../xterm-protocol-endpoint/README.md) with
[selection/copy](../../xterm-browser-selection/README.md) and
[search](../../xterm-browser-search/README.md). It tests the existing
[terminal-native behavior](../../../../docs/protocol/terminal-native-behavior.md),
not new protocol requirements.

## Controlled setup

- Both runs use actual Pi sessions, the same deterministic in-memory provider,
  and two fixed, read-only sample tools. No live model, credentials, repository
  files, shell tools, extensions, or persistent session storage are used.
- Pi's own `InteractiveMode` and regular renderer produce the baseline drawing
  commands. The trial supplies its public Terminal interface; it does not
  reimplement the renderer. Tool views are expanded before the turn so neither
  side truncates the tool text. This is an explicit UI setting, not the default
  collapsed-tool comparison.
- Both outputs reach xterm.js 6.0.0, initially 60 columns by 12 rows with 2,000
  scrollback rows. The protocol side uses our experimental history adapter.
  Private loopback WebSocket controls and isolated workers capture output
  **before PTY**. This comparison does not retest ConPTY, CLI keyboard parsing,
  startup terminal negotiation, or transport chunk boundaries.
- Fixture gates pause generation/tool completion until the browser has placed
  its reading position and selection. They make the observation repeatable;
  they are not producer backpressure or a realistic timing distribution. The
  streaming continuation is a finite burst of 18 line fragments, not a sustained
  high-frequency workload.
- The full ordered presentation-event traces must match. `semantic-trace.ts`
  retains message content, tool identities/results, lifecycle, and errors. It
  omits timestamps and duplicated aggregate history at `agent_end`, whose system
  metadata contains a different allocated working directory in each run.

The shrinking-tool scenario uses Pi's actual
[parallel tool execution](https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/agent/src/agent-loop.ts).
The earlier tool reports 20 progress lines and waits; the later tool completes
with 20 readable lines. Only then does the earlier tool return a one-line result.
A Node test checks that ordering. No sealed Block is reopened or edited.
This is an intentionally scheduled custom-tool workload, not a reproduced
report about a particular built-in Pi tool or a measurement of how often it occurs.

## Expected and observed, 2026-09-21

| Scenario | Expected | Pi regular frontend | Protocol frontend |
| --- | --- | --- | --- |
| Read older user text while 18 more assistant lines arrive | Keep the reader and copy source unchanged; retain new output once | Preserved | Preserved; no demonstrated advantage here |
| Earlier tool's long progress becomes a short result while reading the later tool | Move the later content with its selection; remove obsolete progress | Later text remained once, but the reading point left the viewport and the selection was cleared | Reading point stayed on the same screen row; selected/copied text stayed unchanged |
| Narrow from 60 to 36 columns, then widen to 60 while reading history | Keep the logical reading point visible, preserve selection, and retain content | Checked content remained, but reading point left the viewport and selection was cleared at both widths | Reading point stayed visible and selected/copied text survived both resizes |

For the recorded shrinking-tool run, the selected `LATER-08` marker started at
zero-based screen row 2. On the regular path it ended outside the viewport,
with an empty selection. On the protocol path it stayed at row 2 as the
viewport moved by 39 physical rows to account for the removed content. This
observation occurs **before** releasing the final assistant answer.

For resize, `HISTORY-08` stayed visible at rows 2 → 3 → 2 on the protocol path;
the requirement is logical readability, not an invariant physical row across
different widths. Long sample lines actually change their wrapping.

Both frontends removed the checked obsolete progress, made the summary and
later result searchable, and retained the checked history/assistant/tool text
once at both widths. The text oracle checks each numbered marker once and each
sample line's characters after removing layout whitespace. It does not verify
every whitespace boundary, style, glyph, or arbitrary content type.

Selection uses xterm's public selection API. Copy assertions dispatch the
terminal's copy event with an in-memory clipboard sink, not the operating
system clipboard. Viewport checks read the real browser xterm buffer after
queued output settles; they do not measure transient flicker between frames.

**Interpretation:** this paired experiment supplies bounded evidence of a
reading/selection benefit in two conditions. It did not reproduce duplicate
scrollback in Pi and does not justify claiming that all historical-output bugs
are solved. The regular renderer's
[redraw paths](https://github.com/earendil-works/pi/blob/3390bd93630965a12a0a1a5c36ce890ec22f7e1d/packages/tui/src/tui-main-screen.ts)
are consistent with the observed selection/viewport loss; this is not a
separate causal isolation of every renderer decision.

Our frontend still omits the native editor/footer, styled Markdown, folding,
and extension UI. Thus the comparison is not feature-equivalent, a performance
benchmark, a fullscreen-mode comparison, or evidence of production reliability.
It does not show that a protocol change is the only possible way to improve Pi.
The [earlier live ConPTY trial](../README.md#live-checkpoint-2026-09-20) remains
separate evidence; this experiment must not be described as three live-model
or full CLI end-to-end tests.

## Run and verification

From the repository root:

```sh
pnpm prototype:pi-ux
# Open http://127.0.0.1:4179/ and select Run three paired scenarios.
pnpm test:pi-session
pnpm typecheck
pnpm test
pnpm build:pi-ux
```

The page displays all six observations. Protocol expectations and equal event
traces are assertions; baseline differences are recorded outcomes, not assumed
failures. Worker exit and temporary-directory cleanup must be confirmed before
starting the next frontend. Local deadlines and queue budgets contain this
finite fixture; they are not general resource guarantees.

Recorded validation on 2026-09-21: type checking, 36 focused Pi Node tests,
all 260 Node tests, and the Pi UX/search/composed-endpoint browser builds passed.
Browser runs verified the three paired scenarios, 12 standalone search cases,
and the existing 73 composed endpoint cases. Builds retain the existing large
xterm bundle warning. Test counts describe executed cases, not complete coverage.

`fixture.ts` owns the fixed provider/tools, `capture-terminal.ts` the baseline
I/O interface, `worker.ts` frontend composition, and `server.ts` isolated local
workers. `browser-host.ts` connects the browser terminal and records native
state; `browser.ts` defines the three paired checks. No upstream Pi source,
core protocol, or reusable terminal module is modified by this trial.

The combined search-then-manual-selection check initially failed on our side:
resize restored the previous search result instead of preserving the user's
new selection. The experimental `BrowserSearchHistory` now checks whether the
current selection is still the search-owned match before restoring it. The
[two focused browser regressions](../../xterm-browser-search/manual-selection.ts)
cover resize and an earlier Block Update. The results above describe the fixed
version, not the original implementation.
