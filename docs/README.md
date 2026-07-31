# Documentation

This directory is the authoritative index for project documentation. The
repository README is a short introduction; design reasoning and research live
here.

## Current documents

| Document | Kind | Status |
|---|---|---|
| [RFC 0001: Mutable Terminal History and Reading Anchors](rfcs/0001-mutable-terminal-history-and-reading-anchors.md) | Requirements RFC | Draft |
| [Prior art and project evidence](prior-art.md) | Research note | Living document |
| [RFC process](rfcs/README.md) | Project policy | Active |

RFC 0001 is the current center of the project. It currently defines only the
problem background and the three project goals. Further sections will be
added as their concepts are understood and agreed.

## Repository layout

Only directories with real content are created. The intended layout is:

```text
docs/
  README.md       Documentation index
  prior-art.md    Verified related work and project evidence
  rfcs/           Numbered design proposals and decisions

spec/             Future normative protocol specification
prototypes/       Future terminal-side and producer-side experiments
tests/            Future black-box scenarios and conformance fixtures
```

The last three directories do not exist yet. They should be added only when
the project has a specification, executable prototype, or reusable test
assets to place in them.

## Document authority

Documents have different roles:

1. An accepted specification under `spec/` will define normative protocol
   behavior.
2. RFCs record why a design was proposed, accepted, rejected, or replaced.
3. Research notes summarize evidence and may evolve as new sources appear.
4. The root README is informative and must point to the deeper documents
   rather than duplicate them.

Until a specification exists, RFC 0001 is the primary statement of the
project's motivation and goals. Its Draft status means that its contents can
still change.
