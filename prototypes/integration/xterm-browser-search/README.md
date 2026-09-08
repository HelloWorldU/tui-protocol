# xterm Browser Search Integration Prototype

This browser-host experiment asks whether xterm.js search sees only the current
text of mutable history and keeps an unaffected current match attached to its
Block when Operations, reflow, or capacity eviction move its physical rows.

It composes the private history mechanism from the [xterm-headless
prototype](../../xterm-headless/README.md), logical selection mapping from the
[browser selection prototype](../xterm-browser-selection/README.md),
browser-hosted `@xterm/xterm` 6.0.0, and `@xterm/addon-search` 0.16.0.
Recreating the addon and restoring a surviving current match after each
fixture Operation is an experimental integration mechanism, not a proposed
Terminal API.

## Proven

In one browser scenario, searching for text in a mutable Block selects that
text as the current match. After a complete `Update` replaces the Block:

- the current match is cleared when its text is replaced;
- searching again cannot find text from the old snapshot; and
- text in the replacement snapshot is searchable.

This provides narrow experimental evidence for the current-projection rule in
[Terminal-Native
Behavior](../../../docs/protocol/terminal-native-behavior.md#8-search).

In a second browser scenario, growing an earlier Block moves a later current
match to new physical rows while keeping it attached to the same unchanged
Block content.

Four further Operation scenarios demonstrate that:

- Extend preserves a current match in existing content and makes its appended
  text searchable.
- ReplaceSuffix preserves a current match in its retained prefix, removes old
  suffix matches, clears a current match in the removed suffix, and makes the
  replacement searchable.
- Append preserves an existing current match and makes the new Block
  searchable.
- Seal preserves a current match in the sealed Block.

Two resize scenarios keep the current match attached to the same logical text
when either its own Block reflows or an earlier Block reflows and moves it.

Two capacity scenarios cover the tested complete-Block boundary: evicting an
earlier Block preserves a retained current match, while evicting the Block
containing the current match clears it. Text in retained Blocks remains
searchable.

The [browser endpoint's plain-text fixtures](../xterm-browser-protocol-endpoint/scenarios/plain-text.ts)
separately demonstrate that a visible ESC label is searchable and copies as
that label, while its raw control sequence is not found. The search addon sees
the terminal's display projection, not Session's raw text. Those fixtures are
not part of this standalone ten-scenario run; literal-Tab queries and general
Unicode search mapping remain untested beyond the composed cases below.

Four [Chinese search scenarios](../xterm-browser-protocol-endpoint/scenarios/chinese-search.ts)
run through the composed OSC endpoint, not this standalone page. They check:

- a Chinese word crossing a wide-character soft wrap remains the current match
  through `20`-to-`5`-to-`9`-to-`20` reflow, without searching or copying padding;
- the second identical occurrence stays in its own Block when resize and an
  earlier Block's growth or shrinkage move it;
- Extend makes new Chinese text searchable; ReplaceSuffix preserves a retained
  match and removes old suffix matches; full Update removes the old snapshot;
  and
- find-next reaches an immediately adjacent identical word and wraps back after
  a `20`-to-`9`-to-`20` resize round trip.

These cases use the [basic-CJK width fixture](../xterm-browser-protocol-endpoint/README.md).
They do not establish general Unicode search behavior or a protocol navigation
policy. The standalone page still reports ten scenarios.

Two additional [composed Chinese capacity cases](../xterm-browser-protocol-endpoint/scenarios/chinese-capacity.ts)
check an Update evicting one complete two-row Chinese/Tab Block at `8` columns,
`3` viewport rows, and `6` scrollback rows. The retained match keeps its character,
copy payload, and mapped endpoints; the evicted match clears and leaves search.
These are not standalone search scenarios and do not test partial-Block trimming.

## Private Search-Offset Workaround

Before the workaround, the composed second-occurrence fixture selected the
first Block's matching word after resize instead of preserving the second.
Our diagnosis is a mismatch between the search addon's
[logical-line cache](https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-search/src/SearchLineCache.ts),
which omits the unused cell before a wrapped wide glyph, and its
[search-start conversion](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-search/src/SearchEngine.ts),
which counted that cell as a space in the installed `0.16.0` source.

The local [cell-offset fixture](search-cell-offset.ts) replaces only the private
`_engine._bufferColsToStringOffset` method on each addon instance. It excludes
the same padding cell while preserving actual spaces, including expanded Tabs.
An absent hook fails explicitly; dependency upgrades require revalidation.
[Node tests](../xterm-protocol-endpoint/search-projection.test.ts) check the
conversion against headless Buffer cells, and the four browser cases check its
composed outcomes. This is a version-bound prototype workaround, not an upstream
fix or a public search API. Addon reconstruction still handles cache invalidation.

## Not Proven

- Partial-Block capacity eviction is not tested. The standalone page has no
  Append-driven eviction case; the [composed Chinese Append cases](../xterm-browser-protocol-endpoint/scenarios/chinese-append-capacity.ts)
  check retained/evicted current matches, that evicted text leaves search, and
  that new tail text becomes searchable at one exact complete-Block boundary.
- Reflow mapping beyond the listed basic-CJK cases, combining characters,
  emoji, multiline queries, and literal-Tab queries are not tested.
- Search-result counts, decorations, general navigation behavior, keyboard shortcuts,
  accessibility, and cross-browser behavior are not tested.
- The private history mutation bypasses xterm.js write events, and the search
  addon exposes no public line-cache invalidation API. Recreating it is only a
  feasibility workaround.
- The experiment applies Block Operations directly to the history fixture. It
  does not compose the OSC codec or protocol Session.

## Run

Build the browser fixture from the repository root:

```sh
pnpm build:xterm-browser-search
```

For interactive inspection:

```sh
pnpm prototype:xterm-browser-search
```

Then open the local URL printed by Vite. The page reports the number of passed
search scenarios or identifies the first failed assertion.
