import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { TuiClient, TuiContext } from "@tui-protocol/sdk";
import { PiEventAdapter, type TrialEvent } from "./event-adapter.ts";

/**
 * 0.87.1 live-event mapping. Session-level events without transcript content are
 * ignored; events that cannot occur under the trial settings (compaction and retry
 * disabled, no extensions, no bash mode) fail the trial instead of being hidden.
 */
export function transcriptEvent(event: AgentSessionEvent): TrialEvent | undefined {
  switch (event.type) {
    case "agent_settled": case "queue_update": case "entry_appended":
    case "session_info_changed": case "thinking_level_changed": return undefined;
    case "message_start": case "message_update": case "message_end":
      switch (event.message.role) {
        case "system": return undefined;
        case "user": case "assistant": case "toolResult": return { type: event.type, message: event.message };
        default: throw new Error(`Unsupported live Pi message role: ${event.message.role}`);
      }
    case "agent_start": case "turn_start": case "turn_end":
    case "tool_execution_start": case "tool_execution_update": case "tool_execution_end":
      return event;
    case "agent_end":
      return { type: "agent_end", willRetry: event.willRetry };
    default: throw new Error(`Unsupported live Pi event: ${event.type}`);
  }
}

/**
 * Second session.subscribe listener: turns the same event stream InteractiveMode
 * consumes into protocol Blocks. One Context per agent run (turn), explicit close
 * on completion or cancellation. Work is serialized on a queue because Context
 * open/close are request/response round trips while Pi events are synchronous.
 */
export class ProtocolTranscriptBridge {
  readonly #client: TuiClient;
  readonly #onFailure: (error: Error) => void;
  #queue: Promise<void> = Promise.resolve();
  #unsubscribe?: () => void;
  #adapter?: PiEventAdapter;
  #context?: TuiContext;
  #failure?: Error;
  #turns = 0;
  #closedContexts = 0;

  constructor(options: { client: TuiClient; onFailure: (error: Error) => void }) {
    this.#client = options.client;
    this.#onFailure = options.onFailure;
  }

  attach(session: Pick<AgentSession, "subscribe">): void {
    if (this.#unsubscribe) throw new Error("Bridge is already attached");
    this.#unsubscribe = session.subscribe(event => this.#onEvent(event));
  }

  detach(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  /** Settles when all queued protocol work finished; rethrows the first failure. */
  async drain(): Promise<void> {
    await this.#queue;
    if (this.#failure) throw this.#failure;
  }

  get failure(): Error | undefined { return this.#failure; }
  get turns(): number { return this.#turns; }
  get closedContexts(): number { return this.#closedContexts; }
  get contextOpen(): boolean { return this.#context !== undefined; }

  #onEvent(event: AgentSessionEvent): void {
    if (this.#failure) return;
    let selected: TrialEvent | undefined;
    try {
      selected = transcriptEvent(event);
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!selected) return;
    if (selected.type === "agent_start") {
      if (this.#context || this.#adapter) {
        this.#fail(new Error("agent_start arrived while a turn Context is still active"));
        return;
      }
      this.#turns++;
      this.#enqueue(async () => {
        const context = await this.#client.openContext();
        const adapter = new PiEventAdapter(context);
        adapter.accept(selected);
        this.#context = context;
        this.#adapter = adapter;
      });
      return;
    }
    this.#enqueue(() => {
      if (!this.#adapter) throw new Error(`${selected.type} arrived outside an agent run`);
      this.#adapter.accept(selected);
    });
    if (selected.type === "agent_end") {
      this.#enqueue(async () => {
        const context = this.#context;
        const adapter = this.#adapter;
        this.#context = undefined;
        this.#adapter = undefined;
        if (!context || !adapter) throw new Error("agent_end arrived outside an agent run");
        if (adapter.state !== "finished") throw new Error("Turn ended without a completed adapter run");
        await context.close();
        this.#closedContexts++;
      });
    }
  }

  #enqueue(task: () => void | Promise<void>): void {
    this.#queue = this.#queue.then(async () => {
      if (this.#failure) return;
      try {
        await task();
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    this.#adapter?.fail(this.#failure);
    // Do not re-enter the agent while it is delivering this event.
    queueMicrotask(() => this.#onFailure(this.#failure!));
  }
}
