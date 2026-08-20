# JSON Serialization

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Message schemas](message-schemas.md), [Error codes](error-codes.md), [Logical wire message model](wire-format.md), [Wire requirements](wire-requirements.md), [OSC framing](framing.md), [Content representation](content-representation.md) |
| Base standard | [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) |

This document defines the initial serialization of one logical protocol
Message as UTF-8 JSON. The separate
[OSC Carrier and Framing](framing.md) document defines how those bytes travel
through the terminal stream.

## 1. One Message, One JSON Object

Each logical Message serializes to exactly one JSON object. The object follows
the closed envelope and body schemas selected by its `version` and `kind`.
Every Message includes a `body` object, including messages whose body is empty.

The serialization does not use a top-level array, JSON Lines, a trailing
newline, or concatenated JSON values to establish message boundaries. Framing
supplies exactly one complete JSON payload to the decoder.

## 2. UTF-8 and JSON Profile

The payload is valid JSON as defined by RFC 8259 and is encoded as UTF-8. A
sender does not add a byte-order mark. A receiver rejects invalid UTF-8, a
byte-order mark, non-JSON extensions, and any non-whitespace bytes before or
after the single JSON object.

Object member names are unique at every nesting level. Duplicate names make
the payload invalid rather than selecting the first or last value. Object
member order is insignificant. JSON whitespace is permitted wherever RFC
8259 permits it.

Every decoded string contains only Unicode scalar values. A receiver rejects
an unpaired UTF-16 surrogate escape rather than exposing implementation-
dependent string behavior.

## 3. Scalar Mapping

Initial protocol values use these JSON representations:

| Logical value | JSON representation |
|---|---|
| Protocol version | integer from `1` through `2147483647`; the initial version is `1` |
| Message kind | exact string from the finite kind set |
| Request, Operation, Context, and Block IDs | non-empty string |
| Lifecycle | `"mutable"` or `"sealed"` |
| Response outcome | exact string defined by that response schema |
| Error code | exact string from the version's `ErrorCode` set |
| Content type | exact string identifier; baseline is `"text/plain"` |
| Extend fragment | non-empty string containing `text/plain` data |
| Human diagnostic | string |

The bounded version range is exactly representable by common integer and JSON
implementations and leaves version comparison independent of floating-point
or arbitrary-precision behavior.

IDs are compared as exact decoded strings. Implementations do not perform
Unicode normalization, case folding, numeric parsing, or interpretation of
an ID's internal form. A decimal counter or UUID may be used by its owner, but
that structure has no protocol meaning.

The initial envelope and baseline message bodies use no JSON booleans, `null`,
or numeric values other than `version`. An optional field is omitted when
absent; it is not represented by `null`.

## 4. Structures and Content

Logical records become JSON objects and logical arrays become JSON arrays.
The `optional_content_types` value is an array of unique Content Type strings.
Its order has no semantic meaning.

A `ContentSnapshot` serializes as:

```json
{
  "type": "text/plain",
  "data": "complete block text"
}
```

For `text/plain`, `data` is a JSON string containing the complete logical text
snapshot. JSON escaping represents characters in transit but does not change
the decoded content. In particular, escape-looking content is data and cannot
become a terminal control sequence.

An optional content type defines the JSON type and closed schema of its own
`data` value. If it permits JSON numbers, it must also define an interoperable
range and precision. A receiver does not accept arbitrary JSON merely because
the outer `ContentSnapshot` is structurally valid.

A complete serialized Update may therefore be written as:

```json
{
  "version": 1,
  "kind": "block.update",
  "operation_id": "42",
  "context_id": "ctx-1",
  "body": {
    "block_id": "thinking-1",
    "content": {
      "type": "text/plain",
      "data": "complete replacement text"
    }
  }
}
```

A serialized Extend names the exact prior content Operation and carries only
the non-empty text fragment:

```json
{
  "version": 1,
  "kind": "block.extend",
  "operation_id": "43",
  "context_id": "ctx-1",
  "body": {
    "block_id": "thinking-1",
    "base_operation_id": "42",
    "fragment": " additional text"
  }
}
```

`base_operation_id` follows the same non-empty string mapping as every other
Operation ID. An empty `fragment` violates the closed `block.extend` body
schema and produces `invalid_message` when correlation identity is reliable.

## 5. Field Names and Closed Schemas

JSON member names exactly match the snake-case field names in the concrete
message schemas. Names and string enums are case-sensitive. Aliases,
abbreviations, alternate casing, and implementation-specific members are not
accepted.

Missing required members, unexpected members, forbidden envelope members,
wrong JSON types, and invalid tagged alternatives make the complete Message
invalid. A parseable Message with trustworthy correlation identity reports
`invalid_message`; the receiver does not remove an invalid member and execute
the remainder.

## 6. Parsing Failure and Correlation

The receiver validates a complete framed payload in this order:

1. Decode strict UTF-8 and parse the single JSON object, rejecting duplicate
   member names and invalid Unicode scalar values.
2. Validate the common envelope for a recognized version and message kind.
3. Validate the selected closed body schema.
4. Evaluate the Message's semantic preconditions.

Invalid UTF-8, invalid JSON, duplicate member names, or a non-object top-level
value provides no trustworthy logical identity. The receiver discards that
framed payload and emits no correlated protocol response. Framing recovery
then continues at the next valid frame boundary.

Once the request or Operation identity required by a recognized schema has
been validated, later structural and semantic failures use the correlated
response and ErrorCode rules.

## 7. Logical Equality and Retransmission

No canonical JSON byte representation is required. Senders may choose member
order, insignificant whitespace, and valid character escape forms.

When retry rules require the receiver to determine whether a request ID
refers to the same logical request, it compares the decoded logical Message,
not its original JSON bytes. Differences in member order, whitespace, or
equivalent JSON string escaping do not create a different request.

## 8. Separation from Framing and Carrier

JSON escaping protects JSON syntax only. It does not protect a payload from a
terminal carrier's delimiters or control bytes. The OSC framing layer carries
the complete UTF-8 payload without truncation, delimiter injection, or
accidental terminal execution.

Serialization adds no compression. Any future compression belongs to an
explicitly defined and negotiated framing layer and must preserve the same
decoded logical Message.

## Open Design Choices

- Maximum JSON nesting depth, string length, and identifier length within the
  framing layer's complete-Message limit.
- Detailed newline, control-character, and Unicode validity for baseline
  `text/plain` content.
- JSON `data` schemas for future optional content types.
