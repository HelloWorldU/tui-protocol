# Terminal Protocol Endpoint Integration Prototype

This integration prototype asks whether the existing reference codec and
protocol session can form one deterministic terminal-side path from incoming
TUI protocol byte chunks to protocol state changes and encoded response
frames.

It composes:

- the [TypeScript reference codec](../../reference-codec/README.md), which
  implements the current Message, JSON, and OSC framing drafts; and
- the [protocol session](../../protocol-session/README.md), which implements
  the current Capability, Context, Block Operation, and error semantics.

## Proven

- A tested Capability query split across two incoming writes is decoded,
  executed, encoded as a response, and decoded back to the expected supported
  response Message.
- A tested host that does not claim complete version 1 support produces
  response bytes that decode to the expected unsupported outcome.
- Tested Context-open, Append, complete Update, and Seal Messages encoded as
  incoming bytes produce the expected Session state without success responses.
- Successful tested Block Operations are reported to an optional host hook in
  byte-stream order; rejected Operations are not reported as applied.
- A tested synchronous host preparation hook can reject an otherwise valid
  Update with `resource_exhausted` before Session state changes; the Update
  produces a correlated error and is not reported as applied.
- A tested exception from host preparation produces a local host diagnostic
  and correlated `internal_error`, leaves Block state unchanged, and does not
  prevent the next Operation from being processed.
- A tested Update of a sealed Block leaves its content unchanged and produces
  response bytes that decode to the correlated `block_sealed` protocol error.
- The tested malformed protocol frame produces a local diagnostic without
  creating protocol state, and a later valid query in the same incoming chunk
  still produces its response.
- A tested schema-invalid control request with a reliable request ID produces
  a correlated `invalid_message` response; retrying the same invalid request
  returns that result, while corrected reuse produces `request_id_conflict`.
- A tested schema-invalid Block Operation with reliable Context and Operation
  IDs produces `invalid_message` and consumes its Operation ID. An invalid
  request without reliable identity produces no wire response.
- Ending the tested byte stream rejects an incomplete Message, closes all open
  Contexts, seals their mutable Blocks, and prevents later input.

## Experimental Boundaries

- The exported TypeScript API is an integration harness, not a stable Terminal
  or SDK interface.
- The optional preparation and applied-Operation hooks are synchronous
  integration seams. Preparation can reject an Operation before Session
  commit, but these hooks do not make asynchronous external rendering one
  failure-atomic transaction.
- Outgoing response frame IDs use a local increasing counter that wraps after
  the framing maximum. The values are experimental transport fixtures with no
  application-level meaning.
- `completeBaselineSupported` remains a host assertion; this prototype does
  not determine whether a real Terminal satisfies the complete baseline.
- Endpoint diagnostics are local observations and are not wire-level protocol
  responses.
- Incoming bytes are fed directly to the protocol-only decoder. Ordinary
  terminal data is neither returned nor rendered by this harness.
- Session state is observed through in-memory snapshots and is not connected
  to a Terminal renderer or history implementation.

## Not Proven

- Integration with a real terminal parser, PTY, multiplexer, remote transport,
  renderer, scrollback, reflow, or reading-anchor implementation.
- Backpressure, partial response writes, concurrency, timeouts, authentication,
  reset behavior, or resource failures outside existing framing limits.
- A stable public API or compatibility with future protocol versions.

## Run

```sh
pnpm typecheck
pnpm test
```
