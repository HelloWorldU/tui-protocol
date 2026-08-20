# Concrete Message Schemas

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Logical wire message model](wire-format.md), [JSON serialization](serialization.md), [Error codes](error-codes.md), [Operations](operations.md), [Capabilities](capabilities.md), [Protocol Contexts](contexts.md), [Content representation](content-representation.md) |

This document maps each message kind in the logical wire model to a concrete
logical body schema. It defines fields and their conditions independently of
the selected JSON serialization, OSC carrier, and framing mechanism.

## 1. Notation and Shared Types

The notation below describes records and tagged alternatives. It resembles a
typed data language but does not require JSON or any other serialization.
Every listed field is required unless marked with `?`. `{}` is an empty
record, and a complete Message always carries a `body`, including when that
body is empty.

```text
ContentSnapshot {
  type: ContentType
  data: ContentData
}

NonEmptyText = one or more Unicode scalar values
Text = zero or more Unicode scalar values
ScalarCount = integer from 0 through 9007199254740991

Failure {
  code: ErrorCode
  message?: DiagnosticText
}
```

`ContentType` identifies one negotiated content representation. For the
baseline `text/plain` representation, `data` is a logical text value. Each
optional content type defines its own complete `ContentData` schema.

`ErrorCode` belongs to the stable protocol-defined
[Error Codes](error-codes.md) enumeration. `message` is an optional
human-readable diagnostic and is not a machine-readable contract.

Request IDs, Operation IDs, Context IDs, and Block IDs retain the ownership,
scope, uniqueness, and opacity rules of their semantic drafts. Their concrete
JSON mapping is defined by [JSON Serialization](serialization.md).

## 2. Envelope Field Matrix

`version`, `kind`, and `body` are required on every Message. The remaining
envelope fields are permitted only as follows:

| Message kind | `request_id` | `operation_id` | `context_id` |
|---|---:|---:|---:|
| `capability.query` | required | absent | absent |
| `capability.response` | required | absent | absent |
| `context.open` | required | absent | absent |
| `context.open.response` | required | absent | success only |
| `context.close` | required | absent | required |
| `context.close.response` | required | absent | required |
| `block.append` | absent | required | required |
| `block.update` | absent | required | required |
| `block.extend` | absent | required | required |
| `block.replace_suffix` | absent | required | required |
| `block.seal` | absent | required | required |
| `protocol.error` | absent | required | required |

An envelope field appearing where this table marks it absent makes the whole
Message invalid. For `context.open.response`, `context_id` is required for an
`opened` outcome and absent for an `error` outcome.

A correlated control response uses the same protocol version as its request.
A `protocol.error` uses the same protocol version as its rejected Operation.

## 3. Capability Messages

The queried protocol version is the envelope's `version`, so the query body
is empty:

```text
capability.query body {}
```

The response echoes the request ID and uses exactly one of these bodies:

```text
capability.response body =
  | {
      outcome: supported
      optional_content_types: ContentType[]
    }
  | {
      outcome: unsupported
    }
  | {
      outcome: error
      error: Failure
    }
```

`supported` confirms the complete baseline for the envelope's version. Its
list contains only optional content types and may be empty; baseline
`text/plain` support is implied and is not listed. `unsupported` is the normal
negative negotiation result. `error` reports a reliably correlated request
failure and does not establish protocol support.

## 4. Context Messages

Opening a Context requires no parameters beyond the common envelope:

```text
context.open body {}

context.open.response body =
  | {
      outcome: opened
    }
  | {
      outcome: error
      error: Failure
    }
```

An `opened` response carries the newly allocated `context_id` in its envelope.
An `error` response carries no Context ID and creates no Context.

Context closure addresses the Context through the envelope, so its request
body is also empty:

```text
context.close body {}

context.close.response body =
  | {
      outcome: closed
    }
  | {
      outcome: error
      error: Failure
    }
```

Both closure messages carry the addressed `context_id`. A `closed` outcome
means the ordered closure boundary has completed. An `error` outcome leaves
an open Context unchanged.

## 5. Block Operation Messages

Append carries everything needed to create one complete Block:

```text
block.append body {
  block_id: BlockId
  lifecycle: mutable | sealed
  content: ContentSnapshot
}
```

Update replaces the complete content value while retaining Block identity,
lifecycle, and append position:

```text
block.update body {
  block_id: BlockId
  content: ContentSnapshot
}
```

Extend adds a non-empty `text/plain` fragment to the current logical tail and
names the exact content state on which it depends:

```text
block.extend body {
  block_id: BlockId
  base_operation_id: OperationId
  fragment: NonEmptyText
}
```

The target Block must already use `text/plain`; Extend does not carry or change
its Content Type. An empty fragment violates this body schema. A valid base
field whose value does not equal the Block's current content-state Operation
ID is a semantic `content_state_mismatch`, not a structural failure.

ReplaceSuffix removes a non-empty suffix and replaces it with text that may be
empty:

```text
block.replace_suffix body {
  block_id: BlockId
  base_operation_id: OperationId
  retain: ScalarCount
  replacement: Text
}
```

`retain` counts Unicode scalar values from the beginning of the current
`text/plain` content. The target Block must already use `text/plain`;
ReplaceSuffix does not carry or change its Content Type. The body is
structurally valid when `retain` is a `ScalarCount`; semantic evaluation
additionally requires it to be less than the current scalar-value length.
Otherwise, the Operation reports `invalid_content_boundary`.

Seal changes only the lifecycle of its target:

```text
block.seal body {
  block_id: BlockId
}
```

The Context ID and Operation ID belong to the common envelope rather than
these bodies. Successful Operations have no response.

## 6. Protocol Error Message

A rejected, reliably identified Block Operation produces:

```text
protocol.error body {
  code: ErrorCode
  message?: DiagnosticText
}
```

The error echoes the rejected Operation's `context_id` and `operation_id` in
its envelope. Block identity is not repeated generically: when relevant, its
value can appear in the human diagnostic, while machine behavior is selected
by the stable error code and correlated Operation identity.

## 7. Validation

The receiver first validates the common envelope and then the body schema
selected by `version` and `kind`. Tagged response alternatives are exclusive:
fields belonging to another outcome are unknown fields and invalidate the
complete Message.

Schema validity does not imply semantic validity. For example, a structurally
valid `block.update` can still fail because its Block is unknown or sealed,
and a structurally valid `block.extend` or `block.replace_suffix` can name a
stale content state.
Structural and semantic failures both leave protocol state unchanged and use
the correlated failure behavior defined by the logical wire model.

## Open Design Choices

- Exact validity rules for baseline `text/plain` data.
