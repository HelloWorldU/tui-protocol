# Wire Format Requirements

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Operations](operations.md), [Capabilities](capabilities.md), [Content representation](content-representation.md) |

This document defines the requirements that a future wire format must satisfy.
It does not yet select a carrier, byte encoding, or serialization for the
defined Block content representation.

## 1. Explicit Message Boundaries

Each frame represents exactly one complete protocol message. The receiving
endpoint processes a Query, Response, or Operation only after receiving and
validating the complete frame.

Framing is independent of application write calls and terminal read chunks. A
frame may arrive across multiple reads, and multiple frames may arrive in one
read. An incomplete frame waits without changing protocol state; a complete
valid frame is applied at most once.

## 2. Safe In-Band Coexistence

Protocol frames share the terminal byte stream with ordinary text and existing
terminal control sequences. Bytes outside a protocol frame retain their normal
terminal meaning. A recognized protocol frame is parsed rather than rendered
as text.

Payload data cannot escape its frame or execute unintended terminal controls.
The capability query must fail safely on an unsupported terminal without
leaving visible garbage or persistent terminal state. Without positive
confirmation, the TUI sends no Block Operation frames and chooses its own
fallback behavior.

## 3. Ordered Application

Valid frames are applied in their byte-stream order. A later Operation cannot
overtake an earlier Operation because parsing or execution completes sooner.

A malformed frame may fail, but it does not reorder other frames. The initial
wire model defines ordering within one terminal byte stream and does not yet
define concurrency across independent streams.

## 4. Unambiguous Fields and Payload Integrity

The wire format distinguishes the message type, Block ID, lifecycle, content,
version, and other envelope fields without ambiguity. Encoding and then
decoding a valid message restores the same logical data.

Valid payload data cannot be mistaken for a field separator or frame
terminator. The decoder does not silently truncate, normalize, or partially
interpret invalid data. Escaping, length prefixes, binary-to-text encoding,
and allowed character sets remain encoding choices.

The Block content representation is defined separately. The wire format must
carry the selected representation without changing its meaning.

## 5. Failure Containment and Resynchronization

A malformed, unknown, or over-limit frame is rejected as a unit. The parser
can recover a valid message boundary and continue processing later ordinary
output and protocol frames.

The format requires bounded frame and payload sizes so an incomplete message
cannot consume resources indefinitely. Concrete limits, discard behavior, and
error reporting remain to be defined with the encoding.

## 6. Bidirectional Negotiation

The wire design carries Capability Queries and Block Operations from the TUI
to the terminal, and Capability Responses from the terminal to the TUI.
Responses are distinguishable from ordinary user input and can be correlated
with their Queries.

The two directions may use different carriers, but they use a mutually
understood protocol version. The initial wire requirements do not require an
acknowledgment or response for every Block Operation.

## Open Design Choices

- The carrier, including whether to use OSC, DCS, APC, or another mechanism.
- Frame delimiters, length representation, and chunking.
- Envelope fields for message kind, version, and correlation.
- Payload serialization, escaping, and optional compression.
- The serialization of content representations and optional content types.
- Concrete size limits, timeout behavior, and error responses.
- Authentication, provenance, and authority to mutate existing Blocks.
