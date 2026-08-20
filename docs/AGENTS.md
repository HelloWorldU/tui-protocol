# Documentation guidance

## Overview

The `docs/` tree records the project's design, evidence, and current protocol
decisions. Treat its contents as the source of truth for documented project
facts, subject to each document's declared role and status. Its `README.md`
also provides a convenient human-readable index.

## Document roles

- `README.md` is the documentation index and explains document authority.
- `protocol/` consolidates currently agreed protocol semantics. These files
  are drafts and are not a stable or normative specification.
- `rfcs/` records proposals, motivation, alternatives, and design decisions.
- `design/` contains working notes tied to experiments and prototypes.
- `prior-art.md` records verified related work and project evidence.

## Editing rules

- Define each fact or decision in one authoritative document and link to it
  elsewhere instead of maintaining parallel definitions.
- Preserve the boundaries between requirements, protocol semantics, wire
  representation, and implementation findings. Do not present an
  implementation finding as a protocol requirement unless the relevant
  protocol document adopts it.
- Use the terms `Block`, `Operation`, `Append`, `Update`, `Extend`,
  `ReplaceSuffix`, `Seal`, `Context`, and `Message` consistently with the
  protocol drafts.
- Update `docs/README.md` and any relevant local index when documents or their
  status change. Preserve accepted and superseded RFCs; propose substantial
  changes to accepted decisions in a new RFC.
- When describing an external project, support factual claims with primary
  sources such as official documentation, specifications, source code,
  issues, or pull requests. Identify conclusions drawn from those facts as
  this project's inferences.

## Verification

For documentation-only changes, verify that:

- relative Markdown links resolve;
- terminology and status labels agree across affected documents;
- indexes point to the correct files; and
- `git diff --check` passes.
