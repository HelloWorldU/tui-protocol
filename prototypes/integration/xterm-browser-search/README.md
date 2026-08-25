# xterm Browser Search Integration Prototype

This browser-host experiment asks whether xterm.js search sees only the current
text of mutable history and keeps an unaffected current match attached to its
Block when an earlier complete `Update` moves its physical rows.

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

## Not Proven

- Resize/reflow and capacity eviction are not tested.
- Search-result counts, decorations, navigation policy, keyboard shortcuts,
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

Then open the local URL printed by Vite. The page reports whether the search
scenario passed or identifies the first failed assertion.
