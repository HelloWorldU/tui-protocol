# Repository guidance for agents

## Repository overview

This repository explores a terminal protocol for mutable, identifiable
content that preserves terminal-owned history and native terminal behavior.
It is an early research project: protocol documents are drafts, prototypes
are experimental, and no stable specification exists yet.

## Instruction hierarchy

Before working in a subdirectory, read and follow the nearest `AGENTS.md`
within that directory first.

## Directory structure

```text
docs/                         Project documentation and its main index.
  design/                     Working design notes for experiments.
  protocol/                   Consolidated, non-normative protocol drafts.
  rfcs/                       Numbered proposals and design rationale.
prototypes/                   Executable experiments that test assumptions.
  block-model/                Minimal Block and Operation semantics model.
  xterm-headless/             xterm integration and OSC feasibility spikes.
```

## Pull request workflow

1. Read the instructions that apply to the files being changed.
2. Make one focused change and update any affected documentation.
3. Run the relevant tests and inspect the complete diff.
4. Commit the change, push its branch, and open a pull request against `main`.

## Human accountability

Do not submit pull requests produced entirely by a code agent without human
involvement. The human submitter must understand the change end to end,
review every changed line, run the relevant tests, and be able to explain and
defend the implementation.

For AI-assisted work, the pull request description must include:

- the test commands that were run and their results;
- relevant evaluation evidence when protocol behavior, terminal rendering,
  performance, or compatibility changes; and
- an explicit statement that AI assistance was used.
