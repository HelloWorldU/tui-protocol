# Wire Format Requirements

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Logical wire message model](wire-format.md), [Message schemas](message-schemas.md), [JSON serialization](serialization.md), [OSC framing](framing.md), [Error codes](error-codes.md), [Operations](operations.md), [Capabilities](capabilities.md), [Protocol Contexts](contexts.md), [Content representation](content-representation.md) |

This document defines the requirements that the wire format must satisfy. The
logical Message uses the selected UTF-8 JSON serialization and the initial
bidirectional OSC carrier and framing defined separately.

## 1. Explicit Carrier and Message Boundaries

Each OSC carrier frame represents exactly one bounded Message fragment. A
single-frame Message and a completed multi-frame assembly each restore exactly
one complete serialized Message. The receiving endpoint processes that
Message only after receiving and validating all of its fragments.

Carrier framing is independent of application write calls and terminal read
chunks. A carrier frame may arrive across multiple reads, and multiple frames
may arrive in one read. An incomplete carrier frame or Message assembly waits
without changing protocol state; a complete valid Message is applied at most
once.

## 2. Safe In-Band Coexistence

Protocol carrier frames share the terminal byte stream with ordinary text and
existing terminal control sequences. Bytes outside a protocol frame retain
their normal terminal meaning. A recognized protocol frame is parsed rather
than rendered as text.

Payload data cannot escape its frame or execute unintended terminal controls.
The capability query must fail safely on an unsupported terminal without
leaving visible garbage or persistent terminal state. Without positive
confirmation, the TUI sends no Block Operation Messages and chooses its own
fallback behavior.

## 3. Ordered Application

Completed Messages are applied in the byte-stream order of their final carrier
frames. A later protocol Message cannot overtake an earlier Message because
parsing or execution completes sooner.

A malformed carrier frame or abandoned assembly may fail, but it does not
reorder other completed Messages. The initial wire model defines ordering
within one terminal byte stream and does not yet define concurrency across
independent streams.

## 4. Unambiguous Fields and Payload Integrity

The wire format distinguishes the message type, request or Operation
correlation ID, Context ID, Block ID, lifecycle, content, version, and other
envelope fields without ambiguity. Encoding and then decoding a valid message
restores the same logical data.

Valid payload data cannot be mistaken for a field separator or frame
terminator. The decoder does not silently truncate, normalize, or partially
interpret invalid data. The selected framing uses an OSC terminator and strict
Base64 so serialized Message bytes cannot introduce either boundary syntax.

The Block content representation is defined separately. The wire format must
carry the selected representation without changing its meaning.

Each recognized protocol version uses closed logical schemas. An unknown
field invalidates its complete Message; the receiver does not remove that
field and partially interpret the remainder. Defined optional fields and
negotiated optional content representations remain valid only where their
selected schema permits them.

## 5. Failure Containment and Resynchronization

A malformed, unrecognized, or over-limit carrier frame is rejected as a unit.
When required, its active Message assembly is also discarded. The parser can
recover a valid carrier boundary and continue processing later ordinary output
and protocol frames.

The format requires bounded frame and payload sizes so an incomplete message
cannot consume resources indefinitely. Concrete limits and discard behavior
are defined by [OSC Carrier and Framing](framing.md). Logical error and recovery
behavior is defined by the [Logical Wire Message Model](wire-format.md).

## 6. Bidirectional Protocol Control

The wire design carries Capability Queries, Context control requests, and
Block Operations from the TUI to the terminal. It carries Capability and
Context control responses from the terminal to the TUI. Responses are
distinguishable from ordinary user input and can be correlated with their
requests.

Both directions use the same OSC carrier and a mutually understood protocol
version. Successful Block Operations do not require an acknowledgment;
rejected, reliably identified Operations produce a correlated protocol error.

The common envelope, finite message kinds, request correlation, explicit
Context scope, and closed-schema compatibility rules are consolidated in the
[Logical Wire Message Model](wire-format.md).

## Open Design Choices

- A coordinated stable OSC number.
- Reset behavior for incomplete frame assemblies.
- Authentication, provenance, and authority to mutate existing Blocks.
