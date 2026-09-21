# TUI Protocol

A terminal protocol for dynamic TUIs in the age of AI agents.

Agent interactions generate, revise, and finalize content throughout a session.
Traditional terminal control expresses characters and screen operations, but
does not fully convey the content model these applications need.

We want applications to update identifiable content while terminals retain
ownership of rendering, history, and native interaction.

The protocol remains a draft, and implementations are experimental.

## Get Started

- [Project overview](../README.md)
- [RFC 0001: motivation, goals, and core model](rfcs/0001-mutable-terminal-history-and-reading-anchors.md)
- [Run an example](../examples/multi-round/README.md)

## Protocol

- [Contexts](protocol/contexts.md)
- [Operations](protocol/operations.md)
- [Capabilities](protocol/capabilities.md)
- [Wire protocol](protocol/wire-format.md)
- [Content representation](protocol/content-representation.md)
- [Terminal-native behavior](protocol/terminal-native-behavior.md)

## Design

- [RFCs](rfcs/README.md)
- [Prior art](prior-art.md)
- [Validation plan and design notes](design/next-stage-validation.md)

## Implementation & Evidence

- [Protocol library](../protocol/README.md)
- [TUI SDK](../sdk/README.md)
- [Terminal execution](../terminal/README.md)
- [Experiment records and complete documentation index](README.md)
