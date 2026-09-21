# xterm Browser Selection Integration Prototype

This browser-host experiment asks whether mutable xterm.js history can keep a
selection attached to unaffected Block content and clear it when a complete
`Update` replaces the selected Block. It also tests selection across
`ReplaceSuffix`'s retained-prefix boundary while a new suffix is inserted and
tests selection across resize, reflow, capacity eviction, Extend, Append, and
Seal.

It composes the private history mechanism from the [xterm-headless
prototype](../../xterm-headless/README.md) with the public selection and copy
surface of browser-hosted `@xterm/xterm` 6.0.0. Its experimental wrapper accesses
private xterm.js Buffer internals.

## Observed Behavior

- In one browser scenario, selecting text in a later Block and growing an
  earlier Block moves the selection to the later Block's new physical rows.
- The selected text and the text supplied to xterm.js's `copy` event remain
  unchanged after that earlier-Block `Update`.
- In one browser scenario, a complete `Update` of the selected Block clears
  both its visible selection and subsequent copy source.

These scenarios check the complete
`Update` rules in [Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md#7-selection-and-copying).

The same browser run also demonstrates that:

- A selection entirely inside the retained prefix remains selected and copies
  the same text.
- A selection inside the old suffix replaced by new content is cleared together
  with its copy source.
- A selection crossing the retained-prefix boundary is cleared together with
  its copy source.

These `ReplaceSuffix` scenarios deliberately use one unwrapped ASCII line and
insert a non-empty replacement suffix.

The browser run further demonstrates that:

- A selection inside a Block remains attached to the same logical text when a
  narrower terminal reflows that Block across new physical rows.
- A selection in a later Block moves to that Block's new physical rows when an
  earlier Block reflows.
- Both scenarios require the subsequent xterm.js copy event to supply the same
  selected text.

The browser fixture converts each tested selection to a Block ID and ASCII
display-projection offsets before resize, then reconstructs physical selection
coordinates after xterm.js reflow.

The browser run also demonstrates both sides of the tested capacity boundary:

- When complete-Block capacity eviction removes an older Block before the
  selected Block, the selection moves with its retained Block and copies the
  same text.
- When the same capacity boundary removes the complete selected Block, the
  selection and subsequent copy source are cleared rather than attaching to
  unrelated retained content.

These scenarios reuse the private history prototype's narrow capacity boundary:
an Update requires exactly the number of rows occupied by one complete oldest
Block. The fixture restores a retained selection by Block identity and clears
it when that Block no longer has a rendered range.

The final Operation regressions demonstrate that:

- Extending the selected Block leaves its existing selection and copy source
  unchanged; the appended fragment does not enter the old selection.
- Appending a later Block does not clear or change an existing selection.
- Sealing the selected Block does not clear or change that selection.

These cases exercise one single-line ASCII selection and do not require a
special logical remapping because none of the Operations replaces the selected
content.

## Composed Endpoint Checks

The [browser protocol endpoint](../xterm-browser-protocol-endpoint/README.md)
reuses this wrapper with OSC bytes and Session execution. Its record owns the
additional adjacent-Block, mixed-output, and Append-driven eviction results.
Further projection checks live in:

- [Plain text](../xterm-browser-protocol-endpoint/scenarios/plain-text.ts):
  normalized newlines, complete and partial Tabs, visible controls, and reflow.
- [Projected-text capacity](../xterm-browser-protocol-endpoint/scenarios/capacity.ts):
  retained Tab copy and evicted selection clearing.
- [Chinese/Tab selection](../xterm-browser-protocol-endpoint/scenarios/plain-text-chinese.ts):
  two-cell ideographs, whole-character endpoints, resize, and content changes.
- [Chinese Update eviction](../xterm-browser-protocol-endpoint/scenarios/chinese-capacity.ts),
  [Chinese Append eviction](../xterm-browser-protocol-endpoint/scenarios/chinese-append-capacity.ts),
  and [Chinese/ordinary mixed output](../xterm-browser-protocol-endpoint/scenarios/chinese-mixed-selection.ts).

The wrapper uses the shared [plain-text projection](../../xterm-headless/plain-text.ts)
for logical selection mapping and a [copy handler](plain-text-copy.ts) for the
copy payload. `getSelection()` exposes displayed text; copying reconstructs
fully selected Tabs, while partial Tabs contribute only selected spaces.

## Scope and Limits

This standalone page runs eleven ASCII scenarios by applying Operations directly
to the history fixture. Selection and synthetic copy events exercise xterm's
browser surface; physical mouse dragging, the OS clipboard, accessibility, and
cross-browser behavior remain untested.

The wrapper maps ASCII and the composed endpoint's basic-CJK fixtures. Other
wide characters, combining sequences, and broader Unicode mapping are not
implemented. Capacity evidence covers exact complete-leading-Block eviction;
partial-Block and unmanaged-row trimming remain outside these checks. The
endpoint record specifies the tested mixed-output dimensions and line boundaries.

## Run

Build the browser fixture from the repository root:

```sh
pnpm build:xterm-browser-selection
```

For interactive inspection:

```sh
pnpm prototype:xterm-browser-selection
```

Then open the local URL printed by Vite. The page reports the number of passed
scenarios or identifies the first failed assertion.
