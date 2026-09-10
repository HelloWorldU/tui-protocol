# Terminal Protocol Endpoint Integration Prototype

This integration prototype asks whether the existing reference codec and
protocol session can form one deterministic terminal-side path from incoming
TUI protocol byte chunks to protocol state changes and encoded response
frames.

It composes:

- the [TypeScript reference codec](../../../protocol/README.md), which
  implements the current Message, JSON, and OSC framing drafts; and
- the [protocol session](../../protocol-session/README.md), which implements
  the current Capability, Context, Block Operation, and error semantics.

## Proven

- A tested Capability query split across two incoming writes is decoded,
  executed, encoded as a response, and decoded back to the expected supported
  response Message.
- A tested host that does not claim complete version 1 support produces
  response bytes that decode to the expected unsupported outcome.
- A tested Context-open Message establishes a Context and returns its correlated
  response. Tested Append, complete Update, Extend, ReplaceSuffix, and Seal
  Messages encoded as incoming bytes then produce the expected Session state
  without success responses.
- A tested Extend chain accepts the exact current base, returns correlated
  `content_state_mismatch` for a stale base, and continues from a complete
  Update without sending rejected fragments to the adapter.
- A tested ReplaceSuffix byte sequence counts an emoji as one Unicode scalar,
  reports an out-of-range retained prefix as `invalid_content_boundary`, and
  does not send the rejected Operation to the adapter.
- Successful tested Block Operations are accepted by an optional terminal
  Operation adapter in byte-stream order; rejected Operations are not
  accepted.
- A tested synchronous adapter preparation step can reject an otherwise valid
  Update with `resource_exhausted` before Block content changes; the Update
  produces a correlated error and is not accepted by the adapter. Operation-ID
  reuse remains governed by the separately tested
  [Session](../../protocol-session/README.md) rules.
- A tested exception from adapter preparation produces a local host diagnostic
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
- The endpoint exposes a host-side decoded-event and Context-invalidation seam
  used by the xterm mixed-stream experiment; neither seam creates a new wire
  Message.

## Experimental Boundaries

- The exported TypeScript API is an integration harness, not a stable Terminal
  or SDK interface.
- The optional terminal Operation adapter is a synchronous experimental
  execution boundary. Its preparation step can reject an Operation before
  Session commit, and its accept step runs only after a successful commit. It
  does not make subsequent asynchronous rendering one failure-atomic
  transaction.
- Outgoing response frame IDs use a local increasing counter that wraps after
  the framing maximum. The values are experimental transport fixtures with no
  application-level meaning.
- `completeBaselineSupported` remains a host assertion; this prototype does
  not determine whether a real Terminal satisfies the complete baseline.
- Endpoint diagnostics are local observations and are not wire-level protocol
  responses.
- Incoming bytes are fed directly to the protocol-only decoder. Ordinary
  terminal data is neither returned nor rendered by this harness.
- Context invalidation depends on a terminal adapter identifying affected
  rendered content; this protocol-only endpoint cannot make that judgment.
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
