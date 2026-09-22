# TypeScript TUI SDK

An experimental TypeScript client for the draft Block protocol: capability
negotiation, Context handles, and the five content Operations. It is available
as source and a local JavaScript build; the package is unpublished and its API
may change.

## Layout and scope

- `src/index.ts` is the public source entry point.
- `src/client.ts` implements the single-stream client and Context handles.
- `test/client.test.ts` checks client behavior and interoperability with the
  [terminal protocol module](../terminal/README.md).

The SDK imports the [shared protocol implementation](../protocol/README.md)
and implements the semantics in the [protocol drafts](../docs/README.md).
Interoperability tests use the terminal module; the PTY examples connect both
modules to an experimental renderer.

## Local JavaScript build

Run `pnpm build:sdk` from the repository root. It prints a fresh output directory
under `.tmp/sdk-build-*`, containing ESM JavaScript, TypeScript declarations,
the Apache 2.0 license, and private package metadata. Keep the entire directory:
`sdk/src/index.js` uses the included `node_modules/@tui-protocol/protocol`
package through its public name. The distribution contains the SDK and shared
protocol runtime, with declarations and metadata.

The build uses the repository's pinned compiler and rewrites relative runtime
imports to `.js` for execution as ordinary JavaScript.
Each build uses a fresh directory instead of merging with potentially stale
output; command-line builds are retained for inspection. The metadata uses
`private: true` and the local package name `@tui-protocol/sdk`. The shared build
helper under `scripts/` copies the dependency files into the distribution.
The existing distribution-only `./protocol` export is retained as a forwarding
entry.

`pnpm test` includes two artifact checks in `test/artifact.test.ts`. They copy
only build output outside the checkout and exercise package exports: one runs
a small negotiation/Append/close exchange with a synthetic responder and Node's
TypeScript support disabled; the other checks an external TypeScript consumer's
types with the installed compiler. Both remove their own temporary directories.

## TUI-side use

Create one client for one end-to-end byte stream. Connect its input before
starting negotiation. The transport, raw-input mode, ordinary key handling,
and fallback renderer belong to the application.

The `write` callback must synchronously accept the entire batch into an ordered
transport; it must not be an async function. Serialize other writes on the
same stream and report later transport failure through `dispose(error)`.

```ts
import { TuiClient } from "@tui-protocol/sdk";

const client = new TuiClient({
  write(bytes) { process.stdout.write(bytes); },
  timeoutMs: 2000,
});
process.stdin.on("data", bytes => {
  for (const event of client.receive(bytes)) {
    // Application-provided handlers:
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
For a runnable application using built JavaScript, with raw-stdin handling and
ordinary-text fallback, see the [streaming text example](../examples/streaming-text/README.md).

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
unknown remote Context. Same-ID control recovery is not implemented: the
application must end/recover the old stream before relying on a fresh client
and negotiation.

The client's response deadline defaults to two seconds and can be configured.
A late or unmatched response does not grant support or resolve another request.
During a new negotiation, the client blocks sends on existing handles until support is
positively confirmed again. Create a fresh client after reconnection. Transport
closure and remote-resource cleanup remain the application's responsibility
when retiring the client.

## Terminal-side integration

The [terminal protocol module](../terminal/README.md) handles incoming bytes,
state changes, and responses on the receiving side. Its Operation adapter
connects execution to the host's renderer. The
[terminal host example](../examples/terminal-host/README.md) shows this wiring.
The [xterm endpoint](../prototypes/integration/xterm-protocol-endpoint/README.md)
and [PTY demonstration](../prototypes/integration/pty-demo/README.md) show the
experimental rendering connection. A supporting host must implement the
protocol's native history and rendering behavior and recognize the experimental
OSC `9002` carrier.

## Verification and remaining limits

Run `pnpm typecheck` and `pnpm test` from the root. The SDK tests cover the listed
positive/negative negotiation cases, response correlation, all five Operations
against the existing endpoint with byte-split responses, explicit base IDs,
local validation, close errors/timeouts, input diagnostics, and disposal/write
failure. The real PTY consumer is verified separately through its guided browser
check.

The client exposes baseline `text/plain`. Optional content types, same-ID
control-request recovery, and general transport/backpressure handling remain
future work, along with a supported-runtime matrix and stable package exports.
