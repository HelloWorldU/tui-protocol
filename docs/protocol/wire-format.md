# Logical Wire Message Model

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Wire requirements](wire-requirements.md), [Operations](operations.md), [Capabilities](capabilities.md), [Protocol Contexts](contexts.md) |

This document defines the initial logical shape and classification of protocol
messages. It maps existing protocol semantics onto messages without yet
selecting a carrier, framing mechanism, byte encoding, or serialization.

## 1. Common Envelope

Every protocol message has one common logical envelope:

```text
Message {
  version
  kind
  request_id?
  operation_id?
  context_id?
  body
}
```

`version` selects the protocol version used to interpret the message. `kind`
selects its defined message schema, and `body` carries fields specific to that
kind. An unknown version or message kind is not interpreted as another
Operation or as an arbitrary terminal command.

The optional envelope fields are present only where their semantics require
them. Their absence does not imply an ambient request or current Context.

## 2. Message Kinds

The initial logical model has a finite set of message kinds in four groups:

```text
Capability control
  capability.query
  capability.response

Context control
  context.open
  context.open.response
  context.close
  context.close.response

Block Operations
  block.append
  block.update
  block.seal

Error reporting
  protocol.error
```

The groups organize the message kinds; they are not additional envelope
fields. Capability and Context messages perform protocol control exchanges.
Block Operation messages carry the semantic changes already defined by the
[Operation Semantics](operations.md) draft.

Terminal-native layout, reflow, selection, copying, scrollback management, and
reading-anchor preservation are not additional message kinds. They remain
terminal-owned effects of applying the defined Operations.

## 3. Request Correlation and Retry

A control request that requires a response carries a `request_id`. Its
response echoes the same value, allowing multiple outstanding requests on one
connection to be matched without relying on response order.

Request IDs identify logical request-response exchanges rather than their
ordering. A new logical request uses a new ID. Retransmitting the same logical
request uses its original ID; the same ID must not identify different request
content on one connection.

A repeated `context.open` carrying the same request ID and request content
returns the original outcome without allocating another Context. Reusing that
ID with different request content is invalid. This idempotency closes the
uncertain-outcome window when the terminal may have established a Context but
the TUI has not processed its response.

Request IDs do not identify a Context or Block or grant mutation authority.
Block Operations are one-way messages in the initial model and do not carry a
`request_id`.

## 4. Operation Correlation

Every Block Operation carries a TUI-generated `operation_id`. It is unique and
is not reused within one Context. The terminal treats it as an opaque
correlation value; a simple increasing counter is a suitable TUI
implementation, but byte-stream order remains the protocol ordering rule.

A successful Block Operation has no response. If the Operation is rejected,
the terminal echoes its Operation ID in `protocol.error`. The initial model
does not support retransmitting Block Operations: repeating an Operation ID is
invalid, and the ID does not make Append, Update, or Seal idempotent.

## 5. Explicit Context Scope

Every message that acts within an existing Protocol Context explicitly carries
its `context_id` in the envelope. There is no implicit current Context.

Capability messages and a `context.open` request do not carry a Context ID.
The successful `context.open.response` returns the newly assigned Context ID.
All Block Operations and both sides of a Context closure exchange carry the
exact Context ID to which they apply.

This allows messages for multiple Contexts to be interleaved on one connection
without changing the addressing semantics defined by the
[Protocol Context Semantics](contexts.md) draft.

## 6. Error Reporting and Recovery

Control requests return success or failure through their correlated response.
A negative Capability result is a normal negotiation outcome rather than a
protocol error.

A semantically invalid Block Operation is rejected atomically and produces a
`protocol.error` containing its Context ID, Operation ID, a stable
machine-readable error code, and an optional human-readable diagnostic. The
diagnostic is not part of the machine-readable contract. The error codes form
a protocol-defined set; their concrete initial members remain to be
enumerated from the invalid conditions in the semantic drafts.

A complete frame whose logical Message fails schema validation is also
rejected atomically. It produces a correlated failure only when enough of its
request or Operation identity has been validated to associate that failure
reliably.

Rejecting an Operation does not close its Context or change any other protocol
state. Later messages continue to be processed in byte-stream order against
the state left by earlier successful Operations. An error notification is not
an execution barrier and does not roll back later Operations already sent or
applied. Recovery and fallback remain TUI-owned decisions.

If frame bytes are incomplete or malformed, the receiver does not guess their
intended message, fields, or correlation IDs. It changes no protocol state,
discards through a recoverable boundary, and resumes parsing. No error response
is required unless a complete frame provides enough valid identity to
associate the error reliably.

`protocol.error` travels only from the terminal to the TUI and does not itself
receive a protocol response.

## 7. Closed Schemas and Extensions

Each protocol version defines a closed schema for the common envelope and for
every recognized message kind. A field that is not defined by that schema
invalidates the entire Message. The receiver must not discard the unknown
field and execute the remainder of the Message.

When valid request or Operation identity makes correlation reliable, the
receiver reports the rejection through the corresponding failure response or
`protocol.error`. Otherwise, it discards the Message without guessing its
meaning, following the recovery rules above.

A field explicitly defined as optional by the selected schema is not an
unknown field. Its permitted presence or absence is part of that schema.

The initial protocol version has no generic extension dictionary, vendor
field namespace, or other escape hatch for arbitrary fields. Changes to
baseline message semantics require a new protocol version. Optional content
representations use Capability negotiation. Experiments must use an explicitly
non-standard experimental protocol identifier or version rather than adding
fields under the standard version.

## 8. Semantic Mapping

The message body for each kind will carry the information required by its
existing semantic definition. Defining those schemas is a mechanical mapping
step and does not create new Block lifecycle, ordering, content, or rendering
behavior.

For example, the eventual `block.append` schema must carry its Block ID,
initial lifecycle, and complete typed content snapshot. The exact field
encoding and nesting remain serialization decisions.

## Open Design Choices

- Concrete body schemas and field encodings for each message kind.
- The initial stable error-code enumeration and its concrete encoding.
- Resource bounds for retaining completed Context-open outcomes.
- Serialization, escaping, carrier, framing, and chunking.
- Concrete size limits and resource-exhaustion behavior.
