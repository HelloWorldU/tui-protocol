# TypeScript TUI SDK

Application-facing access to the draft Block protocol: capability negotiation,
Context handles, and the five content Operations. This is the start of a
reusable client, not a stable API or a published package.

## Layout and scope

- `src/index.ts` is the public source entry point.
- `src/client.ts` implements the single-stream client and Context handles.
- `test/client.test.ts` checks client behavior and interoperability with the
  [terminal protocol endpoint](../prototypes/integration/protocol-endpoint/README.md).

The SDK imports the [shared protocol implementation](../protocol/README.md).
Its runtime source no longer depends on `prototypes/`; its tests and the PTY
demo still exercise prototype integrations. This remains a source-checkout
API, not yet a standalone npm distribution. The
[protocol drafts](../docs/README.md) remain authoritative; SDK conveniences do
not introduce new wire semantics.

## TUI-side use

Create one client for one end-to-end byte stream. Connect its input before
starting negotiation. The transport, raw-input mode, ordinary key handling,
and fallback renderer belong to the application.

```ts
import { TuiClient } from "./sdk/src/index.ts";

const client = new TuiClient({
  write(bytes) { process.stdout.write(bytes); },
  timeoutMs: 2000,
});
process.stdin.on("data", bytes => {
  for (const event of client.receive(bytes)) {
    // Application-owned handlers, not SDK functions:
    if (event.type === "ordinary") handleInput(event.data);
    if (event.type === "error") handleDiagnostic(event);
    if (event.type === "message" && event.message.kind === "protocol.error") {
      handleOperationError(event.message);
    }
  }
});

if (await client.negotiate()) {
  const context = await client.openContext();
  let sentState = context.append("thinking", "Analyzing", "mutable");
  sentState = context.extend("thinking", sentState, " input");
  sentState = context.replaceSuffix("thinking", sentState, 9, " complete");
  context.update("thinking", "Done");
  context.seal("thinking");
  await context.close();
} else {
  startApplicationFallback();
}
```

The example is schematic: handlers and fallback are application functions.
For a runnable raw-stdin process with error/exit handling, see the
[real PTY producer](../prototypes/integration/pty-demo/producer.ts).

## API behavior

| API | Observable result |
| --- | --- |
| `negotiate()` | Resolves `true` only for a matched positive response; `false` for an explicit negative or the local response deadline. Correlated control errors and transport failure reject. |
| `openContext()` | Requires positive confirmation; resolves a handle only after a matched opened response. |
| `append`, `update`, `extend`, `replaceSuffix`, `seal` | Validate, encode, and synchronously hand a byte batch to the transport; return its generated Operation ID. |
| `context.close()` | Stops further sends on that handle while pending; resolves after a matching close response for that Context. |
| `receive(bytes)` | Processes control responses and returns decoded events, including ordinary input, protocol errors, and diagnostics. |
| `finish()` / `dispose(reason?)` | Retire the local client and reject pending controls. `finish()` also returns final decoder diagnostics. Neither sends remote Context-close Messages. |

The Context ID is read-only. Request and Operation IDs are generated separately
as increasing decimal strings. The client does not mirror terminal Block state:
an Operation ID means **sent**, not accepted or rendered. The application names
the exact base for Extend/ReplaceSuffix and handles asynchronous rejections.
There is no automatic retry, rollback, successful-Operation acknowledgement,
or automatic full Update after an incremental error.

An explicit close-error response makes the handle available again, consistent
with the draft's unchanged remote Context. A close timeout leaves that handle
unusable because its remote state is uncertain. An open timeout may leave an
unknown remote Context; it does not prove nothing happened. This first client
does not implement same-ID control recovery: the application must end/recover
the old stream before relying on a fresh client and negotiation.

The two-second default is local waiting policy, not a protocol constant. A late
or unmatched response does not grant support or resolve another request. Do not
send Operations during a new negotiation: the client blocks even existing
handles until support is positively confirmed again. Do not
reuse the client or its handles across reconnections. Retiring the SDK alone
does not close the underlying transport or terminate remote resources.

## Terminal-side integration

Terminal implementers do not use this TUI client to render Blocks. Start with
the [terminal protocol endpoint](../prototypes/integration/protocol-endpoint/README.md)
for bytes-to-state/response handling and its Operation adapter contract.
The [xterm endpoint](../prototypes/integration/xterm-protocol-endpoint/README.md)
and [PTY demonstration](../prototypes/integration/pty-demo/README.md) show the
experimental rendering connection. A host must implement the required native
history/rendering behavior before claiming baseline support; parsing alone is
insufficient. A reusable production terminal adapter is not supplied here.

## Verification and remaining limits

Run `pnpm typecheck` and `pnpm test` from the root. The SDK tests cover the listed
positive/negative negotiation cases, response correlation, all five Operations
against the existing endpoint with byte-split responses, explicit base IDs,
local validation, close errors/timeouts, input diagnostics, and disposal/write
failure. These checks are bounded examples, not complete protocol conformance.
The real PTY consumer is verified separately through its guided browser check.

Only baseline `text/plain` is exposed. Optional content types, package publishing,
API compatibility guarantees, other languages, control-request recovery, and
general transport/backpressure handling are deferred. The write callback must
accept an entire batch synchronously into an ordered transport; it must not be
an async function. Report asynchronous transport failure via `dispose(error)`.
The application must serialize other writes on that same stream. The SDK does
not make an incompatible terminal support the experimental OSC `9002` carrier.
