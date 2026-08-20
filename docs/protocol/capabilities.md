# Capability Negotiation

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |
| Related drafts | [Protocol Contexts](contexts.md), [Content representation](content-representation.md), [Wire requirements](wire-requirements.md), [Logical wire message model](wire-format.md), [JSON serialization](serialization.md), [OSC framing](framing.md), [Error codes](error-codes.md) |

This document defines the observable semantics for discovering support for the
Block Operations protocol. Message schemas and JSON serialization are defined
separately; the initial wire uses bidirectional OSC framing. An SDK may expose
the final decision as a boolean even if the underlying response is structured.

## 1. Positive Confirmation and External Fallback

A TUI enables Block Operations only after receiving explicit positive
confirmation from the terminal. A negative, absent, invalid, or unmatched
response is treated as unsupported.

When support is not confirmed, the TUI does not emit Block Operations. Its
fallback renderer and behavior remain entirely application-owned; this
protocol does not mandate plain text, alternate-screen rendering, or any other
fallback strategy.

## 2. Baseline Completeness

The terminal confirms support only if it implements the complete baseline for
the queried version. For the initial version, that baseline includes:

- Append, Update, Extend, and Seal;
- the defined Block lifecycle rules;
- Protocol Context establishment, addressing, and closure;
- the baseline `text/plain` content representation;
- logical state atomicity;
- history integrity and reading-anchor guarantees in their defined scope;
- failure isolation for invalid Operations.

Recognizing or parsing an Operation without implementing all baseline
semantics is not sufficient for a positive response.

Support for the initial version implies support for `text/plain` even when the
baseline type is not separately advertised. A response may confirm the
protocol version without advertising any optional content type.

## 3. Optional Content Type Advertisement

Alongside protocol-version confirmation, the terminal advertises the set of
optional content types it supports on the current connection. The terminal
declares this set, and the TUI selects one confirmed type for each Block
snapshot.

An optional type is supported only when it is explicitly listed. The TUI does
not infer support from the terminal's identity, protocol version, related
types, or payload inspection. The initial model does not define wildcard type
declarations.

## 4. Complete Type Support

The terminal advertises an optional content type only when it completely
implements that type's defined semantics. This includes validating its data,
laying it out and reflowing it, providing its selection, copy, and search
projection, and preserving Block Operation semantics when it is used.

Recognizing a type identifier or partially rendering its data is not
sufficient to advertise support.

Complete support means all semantics defined for that Content Type, not that
every baseline content Operation applies to it. The initial Extend Operation
is defined only for `text/plain`; optional types use complete snapshots unless
their own definitions explicitly add incremental editing semantics.

## 5. Version Binding

A capability query and its result, including any advertised content types,
are bound to a specific protocol version. The terminal confirms a version only
when it completely supports that version. Support for another version does
not imply compatibility.

If both sides support multiple versions, the TUI may select a mutually
supported version. The initial version is represented by JSON integer `1`;
future version-selection behavior remains a wire-level question.

## 6. Connection Scope

A negotiation result and its advertised content types apply only to the
current end-to-end terminal byte stream. They are not machine-wide or global
capabilities.

An SDK may cache the result for that connection. A new terminal, reconnection,
or change to the transport path requires new confirmation because
intermediaries such as multiplexers or remote connections may alter protocol
support.

## 7. Correlation and Side-Effect Freedom

A positive response and its advertised content types are accepted only when
the response can be matched to the current query. A stale, malformed,
unrelated, or unmatched response does not establish support. Lack of a valid
response within the caller's negotiation window is treated as unsupported.

Negotiation creates no Block, changes no protocol lifecycle state, and does
not affect terminal history or the viewport. The query identifier,
request-response matching, and retry identity follow the
[Logical Wire Message Model](wire-format.md); their concrete encoding and the
timeout policy remain wire-level questions.
After positive confirmation, the TUI establishes a Protocol Context through a
separate correlated exchange before sending Block Operations.

## Open Wire Questions

These questions are constrained by the shared
[Wire Format Requirements](wire-requirements.md):

- Timing, timeout, and repeated-query behavior.
- Forwarding behavior across multiplexers and remote terminal paths.
