# TUI Protocol

A terminal protocol for dynamic TUIs in the age of AI agents.

Agent interactions generate, revise, and finalize content throughout a session.
The proposed model lets applications update identifiable content while terminals
retain ownership of rendering, history, and native interaction.

The protocol is a draft, and implementations are experimental.

## Start here

- **[Understand the model](rfcs/0001-mutable-terminal-history-and-reading-anchors.md)**
  The problem, goals, and the Block and Operation model.
- **[Run an example](../examples/multi-round/README.md)**
  See earlier content change while later output remains in history.
- **[Explore the protocol drafts](README.md)**
  Find the current semantics, wire format, and complete documentation index.

## Implementation and evidence

The [protocol library](../protocol/README.md), [TUI SDK](../sdk/README.md), and
[terminal execution library](../terminal/README.md) implement the current draft.
The [validation plan](design/next-stage-validation.md) and linked experiments
record what has been tested so far.
