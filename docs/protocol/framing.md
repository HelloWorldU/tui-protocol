# OSC Carrier and Framing

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Wire requirements](wire-requirements.md), [JSON serialization](serialization.md), [Logical wire message model](wire-format.md), [Capabilities](capabilities.md) |
| Base encoding | [RFC 4648 Base64](https://www.rfc-editor.org/rfc/rfc4648) |

This document defines the initial bidirectional terminal carrier and framing
for serialized protocol Messages. Both directions use OSC control strings;
the payload is bounded, independently Base64-encoded fragments of one UTF-8
JSON Message.

## 1. Bidirectional OSC Carrier

The TUI sends Capability, Context, and Block Operation Messages to the
terminal as OSC sequences on the terminal output stream. The terminal sends
correlated responses and `protocol.error` Messages to the TUI as OSC
sequences on the terminal input stream.

Both directions use the same frame syntax, validation, limits, and assembly
rules. Capability support remains scoped to the complete end-to-end terminal
connection, including any multiplexer, remote transport, or nested terminal
between the endpoints.

The initial experimental implementation uses OSC number `9002`. This number
is provisional and does not claim a public allocation. It must be coordinated
before a stable protocol release; changing it before that release does not
change logical Message semantics.

The carrier and safe-payload pattern follow existing terminal protocol
practice demonstrated by [SpaceTerm TBP](https://github.com/taquangtrung/spaceterm/blob/main/docs/terminal-block-protocol-spec.md)
and the [kitty file-transfer protocol](https://sw.kovidgoyal.net/kitty/file-transfer-protocol/).

## 2. Frame Syntax

One carrier frame has this ASCII structure:

```text
ESC ] 9002 ; 1 ; frame_id ; fragment_index ; more ; payload ESC \
```

Whitespace above is illustrative and is not transmitted. The fields are:

| Field | Encoding | Meaning |
|---|---|---|
| `9002` | fixed decimal ASCII | provisional OSC number |
| `1` | fixed decimal ASCII | framing version |
| `frame_id` | decimal integer `1..2147483647` | identifies one Message assembly |
| `fragment_index` | decimal integer starting at `0` | position within that Message |
| `more` | `0` or `1` | `1` if another fragment follows; otherwise `0` |
| `payload` | canonical RFC 4648 Base64 | one fragment of serialized JSON bytes |

The encoder uses the 7-bit OSC introducer `ESC ]` and the 7-bit String
Terminator `ESC \`. It does not emit the 8-bit C1 forms or BEL termination.
Header fields contain no signs, leading zeroes, whitespace, empty values, or
additional separators.

## 3. Base64 Payload

The encoder first serializes the complete logical Message to UTF-8 JSON bytes.
It splits those bytes into raw fragments and independently encodes each
fragment using the standard RFC 4648 Base64 alphabet with required padding.

Base64 text contains no whitespace or line wrapping. The decoder rejects
characters outside the standard alphabet, misplaced or excessive padding,
and non-canonical encodings. It does not ignore invalid characters.

This encoding keeps UTF-8 bytes and terminal control bytes out of the OSC
payload. Base64 is transport protection only: it is not compression,
encryption, authentication, or a content representation.

## 4. Single-Frame and Fragmented Messages

A serialized Message of at most `3072` bytes uses one frame:

```text
fragment_index = 0
more = 0
```

Larger Messages use consecutive frames with the same `frame_id`. Indices
begin at `0` and increase by exactly one. Every non-final frame has `more = 1`;
the final frame has `more = 0`.

Every non-final raw fragment contains exactly `3072` bytes, producing `4096`
Base64 characters without padding. The final raw fragment contains between
`1` and `3072` bytes. Empty fragments are invalid.

Fragments for one Message are consecutive. The sender does not interleave
ordinary output, another terminal control sequence, or a frame for another
Message between them in the same direction.

The sender chooses a nonzero frame ID that differs from the currently active
fragmented Message in that direction. An increasing counter is sufficient;
the value has no ordering or application-level correlation semantics and may
be reused after its Message has completed or been abandoned.

## 5. Resource Bounds

The initial version permits at most `1048576` serialized JSON bytes in one
complete Message. A conforming receiver accepts Messages up to that size and
may reject larger Messages before JSON decoding.

At the fixed fragment size, one maximum-size Message requires at most `342`
frames with indices `0` through `341`. A receiver retains at most one
incomplete Message assembly per direction and never allocates beyond the
complete-Message limit.

The OSC content between its introducer and terminator contains at most `4120`
ASCII bytes: the longest valid header plus `4096` Base64 characters. After
that bound, a parser enters discard mode without retaining more bytes and
resynchronizes at the carrier terminator.

The initial framing layer uses no inactivity timeout. Ordered delivery,
strictly increasing fragment indices, a single active assembly, and the byte
limit bound retained state without making correctness depend on connection
latency. Connection termination or terminal reset discards an incomplete
assembly.

## 6. Assembly and Ordered Application

The receiver starts an assembly only from fragment index `0`. It validates and
decodes each Base64 fragment before appending its bytes. A frame with
`more = 0` completes the assembly.

Only after the final fragment arrives does the receiver pass the complete byte
sequence to the strict UTF-8 JSON decoder. No fragment causes partial Message
validation, protocol state mutation, rendering, or response.

The completed Message occupies the byte-stream position of its final frame.
No later protocol Message in that direction is applied before it. Senders do
not place another protocol frame between fragments of one Message.

## 7. Failure and Resynchronization

An invalid OSC `9002` header, framing version, field, Base64 payload, fragment
index, or resource bound invalidates that carrier frame. If an assembly is
active, any invalid or unexpected OSC `9002` frame discards the entire
incomplete Message without changing protocol state.

A frame beginning at index `0` starts a fresh assembly after any abandoned
one. A nonzero index without the exact preceding assembly is discarded. Later
ordinary terminal traffic and valid OSC frames continue to be processed.

Framing failure provides no trustworthy logical request or Operation identity,
so it produces no correlated protocol response. A Capability query lost to a
framing failure therefore behaves as an absent response and does not enable
the protocol.

## 8. Unsupported Terminals and Intermediaries

An endpoint that does not recognize OSC `9002` is expected to ignore the
control string. A TUI sends no Block Operation until it receives a valid,
correlated positive Capability response through the same end-to-end path.

Using fragments no larger than `4096` Base64 characters follows the deployed
precedent of the [kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)
and reduces exposure to intermediary string-size limits. It does not imply
that every multiplexer forwards unknown OSC; failure to receive positive
confirmation keeps fallback behavior TUI-owned.

## 9. Security Boundary

Base64 and framing prevent payload bytes from terminating their own OSC or
executing nested terminal controls. They do not prove which process emitted a
valid frame. Authentication, provenance, and authority in a shared byte stream
remain separate design questions.

## Open Design Choices

- A coordinated stable OSC number.
- Context and incomplete-assembly behavior across specific terminal reset
  mechanisms.
- Authentication and provenance in shared or nested terminal streams.
- Whether a future negotiated framing version adds compression or a local
  side channel for substantially larger content.
