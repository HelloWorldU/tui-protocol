# Capability Negotiation

| Field | Value |
|---|---|
| Status | Draft |
| Related RFC | [RFC 0001](../rfcs/0001-mutable-terminal-history-and-reading-anchors.md) |

This document defines the observable semantics for discovering support for the
Block Operations protocol. It does not define the query or response wire
encoding. An SDK may expose the final decision as a boolean even if the
underlying response is structured.

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

- Append, Update, and Seal;
- the defined Block lifecycle rules;
- the baseline `text/plain` content representation;
- logical state atomicity;
- history integrity and reading-anchor guarantees in their defined scope;
- failure isolation for invalid Operations.

Recognizing or parsing an Operation without implementing all baseline
semantics is not sufficient for a positive response.

## 3. Version Binding

A capability query and its result are bound to a specific protocol version.
The terminal confirms a version only when it completely supports that version.
Support for another version does not imply compatibility.

If both sides support multiple versions, the TUI may select a mutually
supported version. The representation and selection of versions remain
wire-level questions.

## 4. Connection Scope

A negotiation result applies only to the current end-to-end terminal byte
stream. It is not a machine-wide or global capability.

An SDK may cache the result for that connection. A new terminal, reconnection,
or change to the transport path requires new confirmation because
intermediaries such as multiplexers or remote connections may alter protocol
support.

## 5. Correlation and Side-Effect Freedom

A positive response is accepted only when it can be matched to the current
query. A stale, malformed, unrelated, or unmatched response does not establish
support. Lack of a valid response within the caller's negotiation window is
treated as unsupported.

Negotiation creates no Block, changes no protocol lifecycle state, and does
not affect terminal history or the viewport. The query identifier,
correlation mechanism, and timeout policy remain wire-level questions.

## Open Wire Questions

These questions are constrained by the shared
[Wire Format Requirements](wire-requirements.md):

- The carrier and framing for queries and responses.
- The capability identifier and version representation.
- The correlation token and response-matching rules.
- Timing, timeout, and repeated-query behavior.
- Forwarding behavior across multiplexers and remote terminal paths.
