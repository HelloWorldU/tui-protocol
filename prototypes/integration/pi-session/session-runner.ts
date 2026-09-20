import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PiEventAdapter, type TrialEvent } from "./event-adapter.ts";

export const TRIAL_PROMPT = "Read the trial sample using read_trial_sample, then give a brief answer.";

// Type checked against the actual pinned SDK. Tool-result payloads in upstream are
// loosely typed; the adapter still rejects content it cannot project.
export function transcriptEvent(event: AgentSessionEvent): TrialEvent | undefined {
  switch (event.type) {
    case "agent_settled": case "queue_update": return undefined;
    case "message_start": case "message_update": case "message_end":
      switch (event.message.role) {
        case "system": return undefined;
        case "user": case "assistant": case "toolResult": return { type: event.type, message: event.message };
        default: throw new Error(`Unsupported live Pi message: ${event.message.role}`);
      }
    case "agent_start": case "agent_end": case "turn_start": case "turn_end":
    case "tool_execution_start": case "tool_execution_update": case "tool_execution_end":
      return event;
    default: throw new Error(`Unsupported live Pi event: ${event.type}`);
  }
}

/** Listener work is synchronous; errors are contained instead of escaping into Pi's event loop. */
export async function runPiSession(session: AgentSession, adapter: PiEventAdapter, options: {
  signal?: AbortSignal;
  onEvent?: (event: AgentSessionEvent) => void;
} = {}): Promise<"completed" | "aborted"> {
  let failure: Error | undefined;
  let aborted = false;
  let aborting: Promise<void> | undefined;
  const abort = () => {
    aborted = true;
    aborting ??= session.abort().catch(error => { failure ??= error instanceof Error ? error : new Error(String(error)); });
  };
  const unsubscribe = session.subscribe(event => {
    if (failure) return;
    try {
      const selected = transcriptEvent(event);
      if (selected) adapter.accept(selected);
      if (event.type === "message_end" && event.message.role === "assistant") {
        if (event.message.stopReason === "error" || event.message.stopReason === "length") {
          throw new Error(`Pi response ended with ${event.message.stopReason}`);
        }
        if (event.message.stopReason === "aborted") aborted = true;
      }
      options.onEvent?.(event);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      adapter.fail(failure);
      // Do not re-enter the agent while it is delivering this event.
      queueMicrotask(abort);
    }
  });
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) return "aborted";
    await session.prompt(TRIAL_PROMPT);
    await aborting;
    if (failure) throw failure;
    if (adapter.state !== "finished") throw new Error("Pi prompt settled without a completed adapter run");
    return aborted ? "aborted" : "completed";
  } finally {
    unsubscribe();
    options.signal?.removeEventListener("abort", abort);
  }
}
