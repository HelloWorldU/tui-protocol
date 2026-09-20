import { pathToFileURL } from "node:url";
import { TuiClient } from "@tui-protocol/sdk";
import {
  TerminalProtocolEndpoint, type AppliedBlockOperation, type OperationExecutionErrorCode,
  type SessionContextSnapshot,
} from "@tui-protocol/terminal";
import { PiEventAdapter, type TrialEvent } from "./event-adapter.ts";
import { toolTurn } from "./fixtures/tool-turn.ts";

export interface ReplayOptions {
  readonly supported?: boolean;
  readonly rejectOperation?: (operation: AppliedBlockOperation) => OperationExecutionErrorCode | undefined;
}
export type ReplayResult =
  | { readonly outcome: "unsupported"; readonly operations: readonly AppliedBlockOperation[] }
  | { readonly outcome: "completed"; readonly operations: readonly AppliedBlockOperation[]; readonly context: SessionContextSnapshot };

/** In-process fixture: not a Pi subscription, transport, renderer, or Operation acknowledgement. */
export async function replay(events: readonly TrialEvent[], options: ReplayOptions = {}): Promise<ReplayResult> {
  const operations: AppliedBlockOperation[] = [];
  const endpoint = new TerminalProtocolEndpoint({
    completeBaselineSupported: options.supported ?? true,
    operationAdapter: {
      prepare: operation => options.rejectOperation?.(operation),
      accept: operation => { operations.push(operation); },
    },
  });
  let adapter: PiEventAdapter | undefined;
  let failure: Error | undefined;
  const stop = (error: Error) => {
    failure ??= error;
    adapter?.fail(error);
    client.dispose(error);
  };
  const client = new TuiClient({ timeoutMs: 1000, write(bytes) {
    const result = endpoint.push(bytes);
    if (result.diagnostics.length > 0) throw new Error(result.diagnostics.map(item => item.reason).join("; "));
    // Responses arrive after write returns; split frames to exercise the real codec.
    queueMicrotask(() => {
      if (failure) return;
      try {
        for (const frame of result.responseFrames) {
          for (const chunk of [frame.subarray(0, 3), frame.subarray(3)]) {
            for (const event of client.receive(chunk)) {
              if (event.type === "error") throw new Error(`Response decode failed: ${JSON.stringify(event)}`);
              if (event.type === "message" && event.message.kind === "protocol.error") {
                throw new Error(`Terminal rejected Operation: ${event.message.body.code}`);
              }
            }
          }
        }
      } catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
    });
  } });
  try {
    if (!await client.negotiate()) return { outcome: "unsupported", operations };
    const context = await client.openContext();
    adapter = new PiEventAdapter(context);
    for (const event of events) {
      if (failure) throw failure;
      adapter.accept(event);
      // A local fixture scheduling point, not upstream Pi backpressure.
      await Promise.resolve();
    }
    if (failure) throw failure;
    if (adapter.state !== "finished") throw new Error("Fixture ended before agent_end");
    await context.close();
    if (failure) throw failure;
    const snapshot = endpoint.context(context.id);
    if (!snapshot) throw new Error("Missing fixture Context");
    return { outcome: "completed", operations, context: snapshot };
  } catch (error) {
    stop(error instanceof Error ? error : new Error(String(error)));
    throw failure;
  } finally { client.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await replay(toolTurn);
  console.log(JSON.stringify(result.outcome === "completed" ? {
    outcome: result.outcome,
    operations: result.operations.map(operation => operation.kind),
    context: result.context,
  } : result, null, 2));
}
