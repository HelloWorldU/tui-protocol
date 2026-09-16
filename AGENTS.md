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
protocol/                     Shared message types, validation, serialization, and framing.
  src/                        Transport-independent protocol implementation.
  test/                       Codec and wire-format behavior checks.
examples/                     Runnable application and terminal integration examples.
  streaming-text/             Built-SDK streaming output and application fallback.
  terminal-host/              Terminal-side wiring using the experimental xterm adapter.
  multi-round/                Finite user-triggered rounds through the built SDK and PTY host.
sdk/                          Application-facing protocol APIs, initially experimental TypeScript.
  src/                        TUI client implementation and public exports.
  test/                       SDK behavior and protocol interoperability checks.
terminal/                     Reusable terminal protocol execution, without a renderer.
  src/                        Session, Endpoint, and host Operation adapter interface.
  test/                       Execution, byte handling, and standalone build checks.
scripts/                      Shared repository build tooling.
prototypes/                   Executable experiments that test assumptions.
  block-model/                Minimal Block and Operation semantics model.
  integration/                Current protocol-layer integration experiments.
    ingress-pressure/         Controlled SDK-to-renderer backlog measurement.
    protocol-endpoint/        Retained bytes-to-state experiment record; code is in terminal/.
    pty-demo/                 Fixed TUI process through ConPTY to browser history.
    pty-transport/            Real child-process OSC transport diagnostics.
    xterm-browser-input-state/ Browser active-input behavior experiment.
    xterm-browser-metadata/   Browser content-metadata behavior experiment.
    xterm-browser-protocol-endpoint/ Browser bytes-to-native-state experiment.
    xterm-browser-search/     Browser search behavior experiment.
    xterm-browser-selection/  Browser selection and copy behavior experiment.
    xterm-protocol-endpoint/  Protocol bytes to mutable xterm history path.
  protocol-session/           Retained Session experiment record; code is in terminal/.
  xterm-headless/             Early xterm feasibility spikes using fixtures.
```

## Module imports

Use `@tui-protocol/protocol`, `@tui-protocol/sdk`, and `@tui-protocol/terminal`
for cross-module runtime imports. Keep relative imports inside each module;
do not reach into another module's `src/`. These workspace names are private,
not a package-publication or API-stability promise.

`pnpm test` checks compiler-resolved dependencies in the three modules' `src/`
directories: protocol stays internal; SDK and terminal may also use the public
protocol package. This is a development check, not a runtime security boundary.

## Pull request workflow

1. Read the instructions that apply to the files being changed.
2. Make one focused change and update any affected documentation.
3. Run the relevant tests and inspect the complete diff.
4. Commit the change, push its branch, and open a pull request against `main`.

Treat the root README's `Milestones` as a sparse chronological record of major
project phase transitions, not a changelog. Agents may propose milestone changes,
but must not add, remove, or rewrite milestones without explicit maintainer
approval.

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
