# xterm Browser Search Integration Prototype

This browser-host experiment asks whether xterm.js search sees only the current
text of a mutable Block after a complete `Update` replaces its content.

It composes the private history mechanism from the [xterm-headless
prototype](../../xterm-headless/README.md) with browser-hosted `@xterm/xterm`
6.0.0 and `@xterm/addon-search` 0.16.0. Clearing the addon's current search
state and xterm.js selection, then recreating the addon after the private
history replacement, is an experimental integration fixture, not a proposed
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

## Not Proven

- Matches in unaffected Blocks moving across an earlier Block update are not
  tested.
- `Extend`, `ReplaceSuffix`, resize/reflow, and capacity eviction are not
  tested.
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
