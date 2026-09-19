# Terminal protocol module

Reusable terminal-side Session execution, protocol-byte handling, and the
Operation adapter interface. The implementation was moved out of the Session
and Endpoint prototypes without changing their behavior. It remains experimental
and unpublished; [protocol drafts](../docs/README.md) define the design.

## Responsibilities

- `src/session.ts`: Capability, Context, Block lifecycle, content-state IDs,
  correlated errors, and prepared Operations over validated Messages.
- `src/endpoint.ts`: decode protocol bytes, execute the Session, consult a host
  adapter, and encode response frames. Also exports `TerminalOperationAdapter`.
- `src/index.ts`: the module entry point. `test/` holds the migrated checks
  and an isolated build-consumer test.

Runtime code depends only on [shared protocol code](../protocol/README.md).
It contains no TUI client, renderer, xterm private API, or PTY library.
The [terminal host example](../examples/terminal-host/README.md) shows how the
experimental xterm adapter connects this layer to a real rendering path.

## Build and use

```sh
pnpm build:terminal
```

The command prints a fresh `.tmp/terminal-build-*` directory with ESM JavaScript,
declarations, the MIT license, and private package metadata. Keep the whole
directory: `terminal/src/index.js` imports the included
`node_modules/@tui-protocol/protocol` package by name, not through workspace links.
The exports are `.` for terminal execution and `./protocol` for shared types
and codecs. `@tui-protocol/terminal` is the private workspace/distribution name;
registry publication and a stable API contract remain deferred.

Import `TerminalProtocolEndpoint` from `@tui-protocol/terminal` in the workspace
or when the complete built distribution is installed under that name.
Supply the host's `completeBaselineSupported` assertion and its
`operationAdapter`. For a protocol-only stream, call `push(bytes)` and return
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

The host owns serialization with rendering, resource checks, native
history behavior, and invalidation of Contexts whose rendered identity is no
longer trustworthy. `invalidateContext(id)` acts on a host determination; it
does not inspect rows or terminal controls. See the
[native-behavior draft](../docs/protocol/terminal-native-behavior.md).

The host must retire the failed execution session and establish trustworthy
renderer state before renegotiating with a fresh endpoint. Creating only a new
Context is insufficient. This abort API does not itself close a transport,
restart a renderer, or detect asynchronous failures. The
API also cannot cancel a host callback that is already running. The
[failure draft](../docs/protocol/contexts.md#12-unrecoverable-execution-failure)
distinguishes this stop from an ordinary atomic rejection.

Capability support is a host assertion, not a result of loading this module.
Omitting the optional adapter is useful for state tests, not a complete terminal
implementation. The host owns transport and shutdown; Session snapshots are
observations, not rendering acknowledgements. No successful Operation response
or automatic rollback/retry is added.

## Verification and limits

Optional `resourceLimits` configure local retained-state budgets; the exported
`trialSessionLimits` profile is used by the browser examples. Content growth
can return `resource_exhausted`; identity/replay exhaustion stops the endpoint
instead of forgetting IDs. `PendingInputBudget` helps hosts bound owned queued
bytes and items. See [accounting, values, tests, and exclusions](../docs/design/trial-resource-budgets.md).
These are opt-in implementation controls, not negotiated limits or heap bounds.

Run `pnpm typecheck` and `pnpm test`. Existing Session and Endpoint scenarios
now live under `test/`; their bounded evidence is retained in the original
[Session record](../prototypes/protocol-session/README.md) and
[Endpoint record](../prototypes/integration/protocol-endpoint/README.md).

`test/artifact.test.ts` copies separately built TUI and terminal modules outside
the checkout, disables Node's TypeScript execution, and exchanges all five
Operations through an in-memory adapter. It checks rejection/unchanged content,
Context close, and external declaration resolution. This validates packaging
and the tested exchange, not native rendering or full protocol conformance.

Extraction checks on 2026-09-12 passed type checking, 158 Node tests, the
66 existing browser endpoint scenarios, and both real-PTY terminal-example
checks. The moved implementations and their original tests were also compared
against their prior versions: changes were limited to import paths.

The xterm adapters and real-PTY fixtures remain in `prototypes/`. Their existing
capacity, Unicode, asynchronous rendering, and platform limits still apply.
This extraction adds no authentication, cache bounds, general transport
backpressure, production recovery, or new terminal compatibility guarantees.
