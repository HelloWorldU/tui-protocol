# Protocol Session Prototype

This prototype asks whether the draft Capability, Context, Block Operation,
and error semantics can form one deterministic in-memory terminal-side
session after Messages have already been decoded.

It exercises the current drafts for:

- [Capability negotiation](../../docs/protocol/capabilities.md);
- [Protocol Context semantics](../../docs/protocol/contexts.md);
- [Operation semantics](../../docs/protocol/operations.md);
- [Logical wire message model](../../docs/protocol/wire-format.md); and
- [Error codes](../../docs/protocol/error-codes.md).

## Proven

- The tested host-declared supported and unsupported Capability outcomes are
  correlated, and retrying the same control request returns its original
  outcome.
- The tested request-ID conflict is rejected without creating a Context.
- Context closure seals mutable Blocks, retains their content and order, and
  remains successful when repeated for a known closed Context.
- Explicit connection termination closes every remaining open Context and
  seals its mutable Blocks in the tested session.
- The tested Append, complete Update, and Seal sequence preserves Block
  identity, order, content, and one-way lifecycle rules.
- The tested semantic failures leave Block state unchanged, and a used
  Operation ID cannot be reused even when its first Operation failed.
- Interleaved Contexts maintain independent Block and Operation namespaces.

## Experimental Boundaries

- `context-N` identifiers are deterministic test fixtures. Context IDs remain
  opaque on the wire, and this allocation format is not proposed behavior.
- `completeBaselineSupported` is a host-supplied assertion used to exercise
  both Capability outcomes. This prototype does not determine whether a real
  terminal satisfies the complete baseline.
- `endConnection()` is an experimental host hook; it does not detect the end
  of a real byte stream by itself.
- The exported TypeScript API and its in-memory snapshots are experimental,
  not a stable terminal or SDK interface.
- The session accepts already validated logical Messages and implements only
  the baseline `text/plain` representation.
- `handleInvalidMessage()` is a separate experimental integration hook for
  reliable correlation metadata produced when the codec rejects a complete
  Message. It does not parse or accept malformed bytes itself.
- `ProtocolSessionError` reports misuse of the local API, such as sending a
  terminal-originated Message into the terminal-side session. It is not a
  wire-level `protocol.error`.

## Not Proven

- Integration with the reference codec, a byte stream, terminal parser,
  multiplexer, or bidirectional PTY.
- Terminal rendering, scrollback integrity, reflow, or reading-anchor
  preservation.
- Optional content types, resource exhaustion, internal failures, request
  cache limits, timeouts, abandoned Contexts, resets, or authentication.
- A stable public API or compatibility with future protocol versions.

## Run

```sh
pnpm typecheck
pnpm test
```
