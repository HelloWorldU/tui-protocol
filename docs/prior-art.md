# Prior Art and Project Evidence

Status: living research note

Last reviewed: 2026-08-09

This document records primary sources that constrain the project. It is not a
claim that every terminal or proposal has been surveyed.

## Protocol and terminal mechanisms

| Work | Content model | Historical mutation | Reading-anchor semantics | Relevance |
|---|---|---|---|---|
| [ECMA-48](https://ecma-international.org/publications-and-standards/standards/ecma-48/) and [xterm control sequences](https://www.invisible-island.net/xterm/ctlseqs/ctlseqs.html) | Stateful character-imaging controls | No stable application-level block mutation | None for logical content | Establishes the byte-stream and active-screen baseline |
| [OSC 133 shell integration](https://learn.microsoft.com/en-us/windows/terminal/tutorials/shell-integration) | Prompt, command, and output boundaries | No general replacement operation | Navigation between marks, not mutation anchoring | Demonstrates deployed semantic marking |
| [DomTerm OSC 72/721](https://domterm.org/Wire-byte-protocol.html) | Sanitized HTML inserted into a DOM-backed terminal | Replaces the latest keyed replaceable element | No general terminal-native history policy is specified | Demonstrates keyed historical replacement |
| [SpaceTerm TBP v1](https://github.com/taquangtrung/spaceterm/blob/main/docs/terminal-block-protocol-spec.md) | Identified MIME content blocks | `open`, RFC 6902 `patch`, and `close` | No terminal-native reading-anchor behavior is specified | Closest block lifecycle, fallback, capability, and trust design |
| [iTerm2 blocks](https://iterm2.com/documentation-escape-codes.html) | Identified start/end regions | Existing blocks can be folded or unfolded | No arbitrary content replacement anchor | Demonstrates deployed block identity and limited updates |

SpaceTerm is the most important design dependency. Its protocol already
answers several questions this project must not casually reinvent:

- block identity and live-block lifecycle;
- capability negotiation;
- plain-text fallback;
- rich representation selection;
- trust tiers;
- in-band and optional side-channel transport.

SpaceTerm describes itself as a web-native terminal, and its core models
scrollback as a block list. The unresolved comparison is not whether TBP can
identify and patch a block; it can. The question is whether TBP can be
extended or profiled to define mutation and anchor behavior for
terminal-owned history with terminal-native interaction.

## Application architecture evidence

| Project | Approach | Observed trade-off |
|---|---|---|
| [Kimi Code PR #2205](https://github.com/MoonshotAI/kimi-code/pull/2205) | Skips repaint only for same-line-count, image-free changes above the viewport | Avoids destructive redraw in a provable subset but explicitly accepts stale scrollback; layout changes retain the destructive baseline |
| [pi issue #6050](https://github.com/earendil-works/pi/issues/6050) | Documents scrollback clearing during full redraw | Removing the clear alone does not provide historical identity or safe replay semantics |
| [pi alternate-screen renderer](https://github.com/earendil-works/pi/commit/c13ffe18) | Application-owned document, scrolling, selection, and follow mode | Controls reflow and updates but moves live history out of terminal-native scrollback |
| [OpenAI Codex PR #9640](https://github.com/openai/codex/pull/9640) | Retired a transcript-owned viewport experiment | Strong rewrap and copy behavior came with a long cross-terminal compatibility tail |
| [Claude Code fullscreen renderer](https://code.claude.com/docs/en/fullscreen) | Opt-in alternate-screen, application-owned transcript | Reimplements scrolling, selection, search, and export; classic mode retains native scrollback |

Kimi Code also records the failed general redraw chain:

- [PR #1315](https://github.com/MoonshotAI/kimi-code/pull/1315)
- [PR #1353](https://github.com/MoonshotAI/kimi-code/pull/1353)
- [PR #1367](https://github.com/MoonshotAI/kimi-code/pull/1367)

The failure classes reported by that chain are requirements for this
project's test oracle: blank screens, duplicated scrollback spans, vanished
rows, growing blank space, and incorrect cursor bookkeeping.

## Current conclusion

The surveyed mechanisms cover pieces of the problem:

- semantic boundaries without general mutation;
- keyed mutation in DOM or block-list terminals;
- application-owned history with controllable reflow;
- terminal-native history with frozen or destructively replayed offscreen
  content.

No surveyed source currently specifies all three target properties together:
terminal-owned native history, correct mutation after content leaves the
active screen, and preservation of a logical reading anchor. This is a
bounded conclusion from the sources above, not proof that no such work
exists.

The project uses an independent logical protocol because its baseline concerns
terminal-owned mutable history and reading-anchor preservation rather than a
bundle of rich representations. It reuses the demonstrated deployment pattern
of OSC carrying Base64-encoded structured data without adopting TBP's content
model or patch semantics.
