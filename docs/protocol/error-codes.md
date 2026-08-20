# Error Codes

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Message schemas](message-schemas.md), [JSON serialization](serialization.md), [Logical wire message model](wire-format.md), [Operations](operations.md), [Protocol Contexts](contexts.md), [Content representation](content-representation.md) |

This document defines the initial stable, machine-readable `ErrorCode` set.
It classifies failures that a TUI may need to distinguish without exposing
terminal implementation details. JSON serialization encodes each symbolic
value as its exact string spelling.

The set is closed for the selected protocol version. An unknown code makes
its containing response or `protocol.error` invalid; adding a standard code
requires a protocol version whose schema defines it.

## 1. Error Code Set

| Error code | Control response | `protocol.error` | Meaning |
|---|---:|---:|---|
| `invalid_message` | yes | yes | A recognized Message violates its closed envelope or body schema. |
| `request_id_conflict` | yes | no | A request ID was reused for a different logical request on the same connection. |
| `context_not_open` | yes | yes | The addressed Context is not an open Context on this connection. |
| `operation_id_reused` | no | yes | An Operation ID was already used in the addressed Context. |
| `block_id_reused` | no | yes | Append used a Block ID that was already used in the addressed Context. |
| `block_not_found` | no | yes | Update, Extend, or Seal addressed no Block in the open Context. |
| `block_sealed` | no | yes | Update, Extend, or Seal addressed a Block whose lifecycle is already sealed. |
| `unsupported_content_type` | no | yes | A snapshot declares an unavailable type, or the target type does not support the requested content Operation. |
| `invalid_content` | no | yes | Snapshot data violates the schema or validity rules of its supported content type. |
| `content_state_mismatch` | no | yes | An incremental Operation's base ID does not equal the Block's current content-state Operation ID. |
| `resource_exhausted` | yes | yes | The receiver cannot complete the request or Operation within an enforced resource limit. |
| `internal_error` | yes | yes | The receiver failed to complete an otherwise valid action for an implementation-internal reason. |

A table value of `yes` means the code is permitted in that reporting path
when the associated failure occurs. It does not mean every malformed input
receives a response:
the receiver reports an error only when the Message and its required
correlation identity are reliable enough to construct a valid correlated
response.

Structural validation precedes semantic evaluation. If a structurally valid
Message has multiple semantic failures, the receiver reports one applicable
specific code; the TUI must not infer that unreported fields or conditions
were valid. `internal_error` must not replace a more specific failure the
receiver has already identified. This leaves implementation validation order
flexible without changing the atomic rejection result.

## 2. Structural Failure

`invalid_message` covers missing required fields, forbidden or unknown fields,
wrong field types, invalid tagged-response combinations, and invalid scalar
forms under a recognized protocol version and message kind.

The receiver does not use `invalid_message` for arbitrary malformed frame
bytes, an unrecognized message kind, or a message whose version cannot be
interpreted. Those cases follow framing and resynchronization rules because
their logical identity is not trustworthy.

## 3. Correlation Identity

`request_id_conflict` applies when one request ID identifies different
logical request content on the same connection. Retransmission of the same
logical request with unchanged content retains its original ID and is not a
conflict.

`operation_id_reused` applies to every repeated Operation ID within one
Context, regardless of whether the later Operation otherwise matches the
earlier one. Block Operations are not retransmittable or idempotent in the
initial protocol.

## 4. Context and Block State

`context_not_open` deliberately combines an unknown Context, a closed Context,
a Context from another connection, and any other Context ID that grants no
current mutation authority. These cases produce the same TUI-visible result
and need not reveal how the terminal classified the handle internally.

For Context closure, repeating closure of a known closed Context remains a
successful idempotent result. `context_not_open` applies when the requested
Context never belonged to a valid closure lifecycle on the current
connection.

`block_id_reused` is specific to Append. `block_not_found` applies to Update,
Extend, and Seal when no target exists. `block_sealed` applies when the target
exists but its lifecycle forbids the requested transition. Keeping these
conditions separate lets a TUI distinguish identity bugs from lifecycle bugs.

## 5. Content State and Representation Failure

`unsupported_content_type` means the declared type is not available under the
positive Capability result for the selected protocol version and connection.
It includes unknown and known-but-unnegotiated optional types. It also applies
when an incremental content Operation targets a representation for which that
Operation is not defined; the initial Extend semantics therefore reject a
non-`text/plain` target with this code.

`invalid_content` means the type is supported but its data is invalid under
that type's defined schema or validity rules. Neither code permits the
terminal to infer another type, repair the snapshot, or partially apply it.

`content_state_mismatch` means the incremental Operation was structurally
valid but named an Operation ID other than the target Block's current
content-state identifier. The TUI does not retry that incremental chain. It
uses a complete Update to establish known content before sending another
incremental Operation.

## 6. Resource and Internal Failure

`resource_exhausted` reports a defined implementation limit or unavailable
capacity that prevents atomic completion. It can apply, for example, to
Context allocation or to an otherwise valid Block Operation. Carrier and
complete-Message size violations are handled before logical error reporting by
the framing layer.

`internal_error` is the final category for an unexpected implementation
failure after the Message is structurally and semantically valid. It must not
replace a more specific code or expose implementation exceptions as new
protocol codes.

Both failures preserve the protocol's atomicity and failure-isolation rules:
the rejected request or Operation changes no protocol state. Neither code
promises that retrying will succeed.

## 7. Processing and Recovery

Error codes describe the rejected Message; they do not alter ordering,
rollback earlier Messages, close a Context, or acknowledge later Messages. A
TUI may log the optional diagnostic, but its machine behavior depends only on
the stable code and the correlated request or Operation it originally sent.

A failed Block Operation is not retransmitted with its existing Operation ID.
If application policy chooses to issue a corrected or otherwise new
Operation, that Operation uses a new Operation ID and is evaluated against the
state left by earlier successful Operations.

## Open Design Choices

- Whether future protocol versions introduce more specific recovery guidance.
- Exact code for an invalid retained-prefix boundary.
