# TypeScript Reference Codec Prototype

This prototype asks whether the draft logical Message schemas, strict UTF-8
JSON serialization, and OSC framing can form one deterministic TypeScript
round trip independently of where terminal byte-stream writes are split.

It implements the current drafts for:

- [concrete Message schemas](../../docs/protocol/message-schemas.md);
- [JSON serialization](../../docs/protocol/serialization.md); and
- [OSC carrier and framing](../../docs/protocol/framing.md).

## Proven

- A fixed Capability query matches independently recorded JSON and OSC wire
  bytes.
- Every baseline Message kind, including `block.extend` and
  `block.replace_suffix`, can round-trip through JSON and OSC framing.
- A Message larger than one frame is split, independently Base64 encoded,
  reassembled, and decoded when every byte arrives in a separate write.
- A complete Message is accepted at the `1048576`-byte framing limit and
  rejected when its serialized form exceeds that limit by one byte.
- The tested invalid-UTF-8, BOM, closed-schema, duplicate-member,
  invalid-Unicode, malformed-Base64, invalid-framing, and
  fragment-interruption cases are rejected deterministically.
- For tested schema-invalid requests and Operations, the decoder exposes a
  correlation identity only when the recognized version, kind, and required
  request or Operation IDs are valid.
- A tested `block.extend` with an empty fragment is rejected while retaining
  its valid correlation identity.
- Tested negative, fractional, and unsafe `retain` values in
  `block.replace_suffix` are rejected while retaining valid correlation
  identity; an empty replacement remains valid.
- A framing failure discards only its incomplete Message and parsing resumes
  at a later valid protocol frame.
- In the tested mixed-decoding cases, ordinary text and another OSC sequence
  retain their tested byte content around a recognized protocol Message, and
  their emitted events retain stream order across every split point of that
  fixture.
- One tested BEL-ended unrelated OSC and its adjacent non-UTF-8 bytes are
  emitted with exactly the same bytes; one malformed protocol OSC is consumed
  as an error instead of being emitted as ordinary data.
- The same codec processes the tested OSC Messages in the [browser protocol
  endpoint](../integration/xterm-browser-protocol-endpoint/README.md) without a
  Node-only Base64 dependency.
- A narrow [xterm parser bridge](../integration/xterm-protocol-endpoint/README.md)
  forwards tested completed OSC `9002` payloads through the same decoder; that
  bridge's mixed-stream limitations are recorded in its README.

## Experimental Boundaries

- OSC number `9002` remains provisional and is not a public allocation.
- The exported TypeScript API is an experimental fixture, not a stable SDK.
- Base64 uses the standard `btoa` and `atob` globals available in the declared
  Node.js runtime and tested browser; broader runtime portability is untested.
- Only the baseline `text/plain` content schema is implemented because no
  optional content type schema has been selected.
- Decoder error events are local diagnostics; they are not wire-level
  `protocol.error` Messages.
- A reported invalid-Message identity is only a correlation hint for a higher
  protocol layer; the codec does not construct responses or consume IDs.
- Ordinary-data events are opt-in so existing protocol-only consumers do not
  receive them. They preserve bytes for a later terminal parser but do not
  interpret the native effect of those bytes.

## Not Proven

- Context or Block semantic state transitions and correlated error responses.
- Capability timeouts, retry storage, or unsupported-terminal fallback.
- Complete mixed-stream terminal-parser coverage, multiplexer integration, or
  a bidirectional PTY path. The composed xterm integration tests only the
  concrete mixed-stream cases recorded in its README.
- Authentication, provenance, reset behavior, or resource exhaustion outside
  the framing limits.
- A stable public API or compatibility with future protocol versions.

## Run

```sh
pnpm typecheck
pnpm test
```
