# tui-protocol

Exploring a terminal protocol for dynamic TUIs in the age of AI agents.

As AI agents develop, terminal interfaces need to support more than a stream
of output: content is generated, revised, and finalized throughout an ongoing
interaction. Traditional terminal control remains useful, but does not fully
express the content model these dynamic applications need.

Our vision is for applications to work with terminal content as identifiable,
updatable components—somewhat like updating nodes in a document—while terminals
retain responsibility for rendering, history, and native interaction. This
project explores the protocol contract that could make that possible.

This project is an early research prototype, not a standard or a stable
protocol.

## Milestones

- **2026-08-01 - Protocol primitives:** Defined the initial Block and Operation
  primitives for mutable, identifiable terminal content.
- **2026-08-12 - Executable protocol path:** Established the first complete
  terminal-side path from framed Messages through codec and Session execution
  to deterministic state changes and correlated responses.
- **2026-08-14 - End-to-end validation:** Validated protocol-driven mutation of
  xterm.js-owned history while preserving the tested reading-anchor and
  tail-following behavior across resize and reflow.

## Documentation

- [Documentation home](docs/index.md)
- [RFC 0001: Mutable Terminal History and Reading Anchors](docs/rfcs/0001-mutable-terminal-history-and-reading-anchors.md)
- [Prior art and project evidence](docs/prior-art.md)

## Run an example

Try a simulated Agent that revises earlier content in an experimental
xterm-based terminal host. No model account is required.

On Windows with Node.js 24+ and pnpm installed, run from the repository root:

```sh
pnpm install
pnpm example:multi-round
```

Open <http://127.0.0.1:4178/>, choose **Connect application**, wait for
`[ready]`, then choose **Next round**. Scroll back, select/copy text, or search
while content changes. Stop the server with Ctrl+C.

See the [example guide](examples/multi-round/README.md) for details and limits.

## License

[MIT License](LICENSE)
