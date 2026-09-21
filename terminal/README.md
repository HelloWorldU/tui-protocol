# Terminal protocol module

Terminal-side Session execution, protocol-byte handling, and an Operation
adapter interface for connecting a host renderer. The module is experimental
and unpublished; [protocol drafts](../docs/README.md) define the design.

## Responsibilities

- `src/session.ts`: Capability, Context, Block lifecycle, content-state IDs,
  correlated errors, and prepared Operations over validated Messages.
- `src/endpoint.ts`: decode protocol bytes, execute the Session, consult a host
  adapter, and encode response frames. Also exports `TerminalOperationAdapter`.
- `src/resource-limits.ts` and `src/input-budget.ts`: host-configured retained-state
  and pending-input budgets.
- `src/index.ts`: the module entry point. `test/` holds the module checks
  and an isolated build-consumer test.

Runtime code depends only on [shared protocol code](../protocol/README.md).
The [terminal host example](../examples/terminal-host/README.md) shows how the
experimental xterm adapter connects this layer to a real rendering path.

## Build and use

```sh
pnpm build:terminal
```

The command prints a fresh `.tmp/terminal-build-*` directory with ESM JavaScript,
declarations, the MIT license, and private package metadata. Keep the whole
directory: `terminal/src/index.js` imports the included
`node_modules/@tui-protocol/protocol` package by name.
The exports are `.` for terminal execution and `./protocol` for shared types
and codecs. `@tui-protocol/terminal` is the private workspace/distribution name.

Import `TerminalProtocolEndpoint` from `@tui-protocol/terminal` in the workspace
or when the complete built distribution is installed under that name.
Supply the host's `completeBaselineSupported` assertion and its
`operationAdapter`. Assert support only when the host implements the complete
baseline, including native history and rendering behavior. The adapter may be
omitted for state-only tests.

For a protocol-only stream, call `push(bytes)` and return
each `responseFrames` entry to the application; handle `diagnostics` locally.

For ordinary terminal output mixed with protocol frames, use one decoder with
`emitOrdinaryData: true`. Route ordinary events to the native parser, protocol
events to `acceptDecoded(event)`, and preserve execution/rendering order.
Do not also feed those same bytes to `push()`: it owns a separate protocol-only
decoder and does not return ordinary data. Finalize the external decoder and
deliver its remaining events before calling `endpoint.finish()` at EOF.

## Host adapter boundary

`prepare(operation)` runs before Session commit. Return `undefined` to accept
the preparation, or `resource_exhausted` / `internal_error` to reject without
changing Block content. A thrown preparation error becomes a local diagnostic
and an `internal_error` response. `accept(operation)` runs only after commit;
it is synchronous and must arrange any later rendering and failure handling.

An `accept` exception aborts endpoint processing and throws to the host. For a
later asynchronous rendering failure, the host calls `abort(reason)`. Further
`push`, `acceptDecoded`, invalidation, and `finish` calls then throw; abort does
not Seal Blocks, produce a close response, roll back state, or clear history.
Snapshots remain diagnostic observations, not usable Context authority.

The host owns serialization with rendering, resource checks, native history
behavior, and detection of changes that invalidate a Context's rendered
identity. It calls `invalidateContext(id)` to apply that determination. See the
[native-behavior draft](../docs/protocol/terminal-native-behavior.md).

The host must retire the failed execution session and establish trustworthy
renderer state before renegotiating with a fresh endpoint. Creating only a new
Context is insufficient. The host handles transport shutdown, renderer restart,
and detection of asynchronous failures. A host callback already running when
abort occurs must settle under host control. The
[failure draft](../docs/protocol/contexts.md#12-unrecoverable-execution-failure)
distinguishes this stop from an ordinary atomic rejection.

Session snapshots expose protocol state; the host tracks rendering completion.
Successful Operations have no response. The host and application coordinate
recovery; the module performs no automatic rollback or retry.

## Verification and limits

Optional `resourceLimits` configure local retained-state budgets; the exported
`trialSessionLimits` profile is used by the terminal-host and multi-round
examples. Content growth can return `resource_exhausted`; identity/replay
exhaustion stops the endpoint while preserving consumed IDs. `PendingInputBudget`
helps hosts bound owned queued bytes and items. The
[resource-budget note](../docs/design/trial-resource-budgets.md) explains the
values, accounting scope, and exhaustion behavior.

Run `pnpm typecheck` and `pnpm test`. Existing Session and Endpoint scenarios
now live under `test/`; their experiment records are retained in the original
[Session record](../prototypes/protocol-session/README.md) and
[Endpoint record](../prototypes/integration/protocol-endpoint/README.md).

`test/artifact.test.ts` copies separately built TUI and terminal modules outside
the checkout, disables Node's TypeScript execution, and exchanges all five
Operations through an in-memory adapter. It checks rejection/unchanged content,
Context close, and external declaration resolution.

Extraction checks on 2026-09-12 passed type checking, 158 Node tests, the
66 existing browser endpoint scenarios, and both real-PTY terminal-example
checks.

The xterm adapters and real-PTY fixtures remain in `prototypes/`. Their existing
capacity, Unicode, asynchronous rendering, and platform limits still apply.
Further integration work includes authentication, general transport
backpressure, production recovery, and broader terminal compatibility.
