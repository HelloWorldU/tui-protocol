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

The initial logical model has a finite set of message kinds in three groups:

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
```

The groups organize the message kinds; they are not additional envelope
fields. Capability and Context messages perform protocol control exchanges.
Block Operation messages carry the semantic changes already defined by the
[Operation Semantics](operations.md) draft.

Terminal-native layout, reflow, selection, copying, scrollback management, and
reading-anchor preservation are not additional message kinds. They remain
terminal-owned effects of applying the defined Operations.

## 3. Request Correlation

A control request that requires a response carries a `request_id`. Its
response echoes the same value, allowing multiple outstanding requests on one
connection to be matched without relying on response order.

Request IDs identify one request-response exchange. They do not identify a
Context or Block, grant mutation authority, or by themselves make a retried
request idempotent. Block Operations are one-way messages in the initial model
and do not require a `request_id` or per-Operation response.

## 4. Explicit Context Scope

Every message that acts within an existing Protocol Context explicitly carries
its `context_id` in the envelope. There is no implicit current Context.

Capability messages and a `context.open` request do not carry a Context ID.
The successful `context.open.response` returns the newly assigned Context ID.
All Block Operations and both sides of a Context closure exchange carry the
exact Context ID to which they apply.

This allows messages for multiple Contexts to be interleaved on one connection
without changing the addressing semantics defined by the
[Protocol Context Semantics](contexts.md) draft.

## 5. Semantic Mapping

The message body for each kind will carry the information required by its
existing semantic definition. Defining those schemas is a mechanical mapping
step and does not create new Block lifecycle, ordering, content, or rendering
behavior.

For example, the eventual `block.append` schema must carry its Block ID,
initial lifecycle, and complete typed content snapshot. The exact field
encoding and nesting remain serialization decisions.

## Open Design Choices

- Concrete body schemas and field encodings for each message kind.
- Error reporting and whether errors use a shared or kind-specific response.
- Retry, duplicate detection, and the lost-response behavior of Context open.
- Handling of unknown fields and compatible protocol extensions.
- Serialization, escaping, carrier, framing, and chunking.
- Concrete size limits and resource-exhaustion behavior.
