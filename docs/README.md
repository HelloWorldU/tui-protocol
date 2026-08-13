# Documentation

This directory is the authoritative index for project documentation. The
repository README is a short introduction; design reasoning and research live
here.

## Current documents

| Document | Kind | Status |
|---|---|---|
| [RFC 0001: Mutable Terminal History and Reading Anchors](rfcs/0001-mutable-terminal-history-and-reading-anchors.md) | Requirements RFC | Draft |
| [Operation semantics](protocol/operations.md) | Protocol draft | Draft |
| [Capability negotiation](protocol/capabilities.md) | Protocol draft | Draft |
| [Wire format requirements](protocol/wire-requirements.md) | Protocol draft | Draft |
| [Logical wire message model](protocol/wire-format.md) | Protocol draft | Draft |
| [Concrete message schemas](protocol/message-schemas.md) | Protocol draft | Draft |
| [Error codes](protocol/error-codes.md) | Protocol draft | Draft |
| [JSON serialization](protocol/serialization.md) | Protocol draft | Draft |
| [OSC carrier and framing](protocol/framing.md) | Protocol draft | Draft |
| [Content representation](protocol/content-representation.md) | Protocol draft | Draft |
| [Protocol Context semantics](protocol/contexts.md) | Protocol draft | Draft |
| [Terminal-native behavior](protocol/terminal-native-behavior.md) | Protocol draft | Draft |
| [First prototype design notes](design/first-prototype.md) | Design note | Working note |
| [Block model prototype](../prototypes/block-model/README.md) | Executable prototype | Experimental |
| [Terminal protocol endpoint](../prototypes/integration/protocol-endpoint/README.md) | Integration prototype | Experimental |
| [xterm protocol endpoint](../prototypes/integration/xterm-protocol-endpoint/README.md) | Integration prototype | Experimental |
| [Protocol session prototype](../prototypes/protocol-session/README.md) | Executable prototype | Experimental |
| [TypeScript reference codec](../prototypes/reference-codec/README.md) | Executable prototype | Experimental |
| [xterm-headless OSC spike](../prototypes/xterm-headless/README.md) | Feasibility spike | Experimental |
| [Prior art and project evidence](prior-art.md) | Research note | Living document |
| [RFC process](rfcs/README.md) | Project policy | Active |

RFC 0001 is the current foundation of the project. It defines the problem,
project goals, initial responsibility boundaries, and the minimal Block and
Operation model. Detailed agreed semantics are consolidated under
`docs/protocol/` while they remain drafts.

## Repository layout

Only directories with real content are created. The intended layout is:

```text
docs/
  README.md       Documentation index
  prior-art.md    Verified related work and project evidence
  protocol/       Draft consolidated protocol semantics
  rfcs/           Numbered design proposals and decisions

spec/             Future normative protocol specification
prototypes/       Executable semantic and implementation experiments
tests/            Future black-box scenarios and conformance fixtures
```

`prototypes/` now contains the first executable Block-model experiment. The
`spec/` and `tests/` directories should be added only when the project has a
normative specification or reusable conformance fixtures to place in them.

## Document authority

Documents have different roles:

1. An accepted specification under `spec/` will define normative protocol
   behavior.
2. Drafts under `docs/protocol/` consolidate currently agreed semantics but
   remain non-normative.
3. RFCs record why a design was proposed, accepted, rejected, or replaced.
4. Research notes summarize evidence and may evolve as new sources appear.
5. The root README is informative and must point to the deeper documents
   rather than duplicate them.

Until a specification exists, RFC 0001 is the primary statement of the
project's motivation and goals. Its Draft status means that its contents can
still change.
