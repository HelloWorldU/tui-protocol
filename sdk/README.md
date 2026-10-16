# TypeScript TUI SDK

An experimental TypeScript client for the draft Block protocol: capability
negotiation, Context handles, and the five content Operations. It is available
as source and a local JavaScript build; the package is unpublished and its API
may change.

## Layout and scope

- `src/index.ts` is the public source entry point.
- `src/client.ts` implements the single-stream client and Context handles.
- `src/ansi.ts` converts ANSI-styled strings into `text/styled` spans.
- `test/client.test.ts` checks client behavior and interoperability with the
  [terminal protocol module](../terminal/README.md).
- `test/styled-content.test.ts` checks styled content encoding and
  negotiation gating; `test/ansi.test.ts` checks the ANSI conversion.

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
| `negotiate()` | Resolves `true` only for a matched positive response; `false` for an explicit negative or the local response deadline. Correlated control errors and transport failure reject. A positive response's confirmed optional content types become readable through `optionalContentTypes`. |
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

## Styled text content

`client.optionalContentTypes` exposes the optional content types from the
latest positive capability response (empty before one, and reset by a fresh
negotiation); `client.supportsStyledContent` is its `text/styled` shortcut.

The text argument of `append`, `update`, `extend`, and `replaceSuffix` accepts
either a string or a readonly `StyledTextSpan[]`. A string keeps encoding
`text/plain` exactly as before. A span list encodes `text/styled`: a content
snapshot for `append` and `update`, a span-list fragment for `extend` and
`replaceSuffix`. Sending spans only validates and hands bytes to the
transport; as with every Operation, the returned ID means sent, not accepted
or rendered by the terminal.

Passing spans when the latest positive response did not confirm `text/styled`
throws before any bytes are written; stripping styling and sending plain
strings is the application's fallback decision, and the SDK never downgrades
spans on its own. An empty span list is valid content for `append`, `update`,
and `replaceSuffix`; `extend` rejects it locally, matching the protocol's
non-empty fragment rule.

## ANSI conversion

`spansFromAnsi(text)` converts an ANSI-styled string into a span list suitable
for the content Operations. It interprets only SGR sequences (`CSI ... m`):
reset (0, including an empty parameter list); bold, faint, italic, underline,
strikethrough, and inverse (1, 2, 3, 4, 9, 7) with their individual clears
(22, 23, 24, 29, 27); the 16-color foreground (30–37, 90–97) and background
(40–47, 100–107) codes as palette indices 0–15, preserving terminal theme
semantics; 256-palette colors (`38;5;n`, `48;5;n`); true colors
(`38;2;r;g;b`, `48;2;r;g;b`); and default-color restores (39, 49), which drop
the attribute rather than emitting the explicit `"default"` color.

The output merges adjacent runs with equal styles into one span, emits runs
without attributes as spans without a style field, and never produces empty
spans, so empty or styling-only input yields an empty span list.

Limitations of this first version: every non-SGR escape sequence (other CSI
commands, OSC strings, other ESC sequences) is silently discarded; other
control characters are kept as ordinary text; parameters are split on `;`
only, so colon sub-parameters such as underline variants are not
distinguished; unknown SGR attributes and out-of-range color parameters are
ignored.

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
failure, plus the styled content encoding, negotiation gating, and the ANSI
conversion behavior above. The real PTY consumer is verified separately
through its guided browser check.

The client exposes baseline `text/plain` and negotiated `text/styled`. Further
optional content types, same-ID control-request recovery, and general
transport/backpressure handling remain future work, along with a
supported-runtime matrix and stable package exports.
