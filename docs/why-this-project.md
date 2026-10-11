# Why this project exists

Status: project narrative, 2026-10-11. A five-minute read; every claim links
to its evidence.

## The problem, in one user's words

In July 2026, a user of the Pi coding agent documented the constraint
precisely ([pi issue #7304](https://github.com/earendil-works/pi/issues/7304)):
the terminal protocol lets an application clear the entire scrollback or
append to it — but it cannot selectively update a line that has already
scrolled into history. When streamed content reflows above the viewport, the
only correct option is to clear and replay, destroying the reader's position.

Anyone who scrolls up to read an agent's output while it keeps streaming has
met this: the next reflow wipes the place you were reading.

## What three teams tried

- **Patch in place.** Kimi Code's fork pinned an anchor to buffer row indices
  while content shifted underneath; interacting edge cases accumulated faster
  than they could be stabilized, and the fork reverted to the upstream
  behavior, re-accepting the destructive-redraw symptom
  ([PR #1367](prior-art.md#application-architecture-evidence)).
- **Application-owned viewport.** OpenAI's Codex built a transcript-owned
  viewport with excellent rewrap and copy fidelity, then retired it — 82,802
  deleted lines — because making it feel native across the environment matrix
  (terminal emulators, OS, input modalities, multiplexers, fonts, alt-screen)
  was a combinatorial tail ([PR #9640](prior-art.md#application-architecture-evidence)).
- **Application-owned fullscreen.** Pi chose this direction and intends it to
  become the default; its cost profile is still active work — large
  transcripts re-render every frame
  ([issue #9549](prior-art.md#application-architecture-evidence)).

All three converge on one observation: the problem is real and expensive.
The configuration none of them provides is terminal-owned history that stays
correct when offscreen content changes, with the reading anchor preserved.

## The third path

Give content identity. The application decides what the content is and when
it changes; the terminal decides how it looks, where it sits, and keeps the
user's reading position; a small protocol carries semantic changes between
them — append, update, extend, replace a suffix, seal. The terminal never
has to clear and replay; the application never has to reimplement scrolling,
selection, search, or copy. The formal model is
[RFC 0001](rfcs/0001-mutable-terminal-history-and-reading-anchors.md).

## What exists today

Three [milestones](../README.md#milestones) through 2026-10-03. The strongest
evidence: Pi 0.87.1's stock interactive UI — its unmodified editor, footer,
and status — running while the transcript above is owned by protocol Blocks,
verified by four automated browser scenarios through a real terminal path:
a full turn with editor input during streaming, cancellation and a further
turn, a resize round trip, and unsupported-terminal fallback
([Pi stock-UI trial](../prototypes/integration/pi-stock-ui/README.md)).

![A completed trial turn: the transcript retained and searchable in terminal-owned history (search match underlined), with the trial's patch report below it](_static/pi-stock-ui-turn.png)

The repository holds 300+ Node tests, dated checkpoints, and bounded claims
throughout — including recorded failures, such as the two-writer conflict
that motivated the terminal host's
[region ownership](design/host-region-ownership.md).

## Honest status

This is a research prototype, not a standard. Content is plain text only;
the supporting terminal is one experimental host; the evidence is
Windows-only so far; live-model runs exist for the SDK frontend but not yet
for the stock-UI path. Two constraints shape what happens next: the
cold-start loop and one maintainer's bandwidth
([current constraints](../README.md#current-constraints)).

## Who might care, and what would help most

- **People who use agent TUIs every day.** This project exists for their
  reading experience: keeping your place, your selection, and your history
  while output streams. If that is you, this evidence is yours to cite when
  asking your terminal or agent of choice for a fix — user demand is what
  moves vendors.
- **Terminal emulator developers and TUI framework authors** who have hit
  the same wall. The single most useful contribution is a second
  terminal-side implementation, independent of this project's host code
  ([adoption path](design/adoption-path.md)).
- **Agent-application teams** choosing a rendering strategy. The three
  documented attempts above are the map of what has already been tried.

All evidence and design documents are public, and the
[protocol drafts](README.md) describe the semantics in full.
