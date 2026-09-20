import type { TuiContext } from "@tui-protocol/sdk";

// Structural slice of the pinned Pi events, not an upstream SDK type or wire schema.
// Additional Pi fields are not consumed. Unsupported content/events fail the trial.
export interface ContentPart {
  readonly type: string;
  readonly text?: string;
  readonly thinking?: string;
}

export interface TrialMessage {
  readonly role: string;
  readonly content: string | readonly ContentPart[];
  readonly stopReason?: string;
  readonly errorMessage?: string;
  readonly toolCallId?: string;
}

export type TrialEvent =
  | { readonly type: "agent_start" | "turn_start" | "turn_end" }
  | { readonly type: "agent_end"; readonly willRetry: boolean }
  | { readonly type: "message_start" | "message_update" | "message_end"; readonly message: TrialMessage }
  | { readonly type: "tool_execution_start"; readonly toolCallId: string; readonly toolName: string }
  | { readonly type: "tool_execution_update"; readonly toolCallId: string; readonly partialResult: { readonly content: readonly ContentPart[] } }
  | { readonly type: "tool_execution_end"; readonly toolCallId: string; readonly result: { readonly content: readonly ContentPart[] }; readonly isError: boolean };

export type BlockWriter = Pick<TuiContext, "append" | "extend" | "replaceSuffix" | "seal">;
export interface TrialLimits {
  readonly maxEvents: number;
  readonly maxBlocks: number;
  readonly maxTextUnits: number;
}
export const DEFAULT_TRIAL_LIMITS: TrialLimits = Object.freeze({
  maxEvents: 256, maxBlocks: 32, maxTextUnits: 65_536,
});

interface Block {
  id: string;
  text: string;
  sentState: string;
  sealed: boolean;
}
interface Tool { block: Block; name: string }

function textParts(parts: string | readonly ContentPart[], assistant = false): string {
  if (typeof parts === "string") return parts;
  return parts.map(part => {
    if (part.type === "text" && typeof part.text === "string") return part.text;
    if (assistant && part.type === "thinking" && typeof part.thinking === "string") {
      return `[Thinking]\n${part.thinking}`;
    }
    // Tool calls are presented by execution events, not twice in the transcript.
    if (assistant && part.type === "toolCall") return "";
    throw new Error(`Unsupported content part: ${part.type}`);
  }).filter(text => text !== "").join("\n\n");
}

/** One finite, plain-text run. A returned Operation ID is sent state, not acknowledgement. */
export class PiEventAdapter {
  readonly #writer: BlockWriter;
  readonly #limits: TrialLimits;
  readonly #tools = new Map<string, Tool>();
  #state: "ready" | "running" | "finished" | "failed" = "ready";
  #failure?: Error;
  #events = 0;
  #blocks = 0;
  #userText?: string;
  #userEnded = false;
  #assistant?: Block;

  constructor(writer: BlockWriter, limits: TrialLimits = DEFAULT_TRIAL_LIMITS) {
    for (const value of [limits.maxEvents, limits.maxBlocks, limits.maxTextUnits]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Trial limits must be positive safe integers");
    }
    this.#writer = writer;
    this.#limits = { ...limits };
  }

  get state() { return this.#state; }

  // Hosts must call this on an asynchronous protocol or transport failure too.
  fail(reason: Error): void {
    this.#failure ??= reason;
    this.#state = "failed";
  }

  accept(event: TrialEvent): void {
    if (this.#failure) throw this.#failure;
    try {
      if (this.#state === "finished") throw new Error("Run already finished");
      if (++this.#events > this.#limits.maxEvents) throw new Error("Trial event limit exceeded");
      if (event.type === "agent_start") {
        if (this.#state !== "ready") throw new Error("Duplicate agent_start");
        this.#state = "running";
        return;
      }
      if (this.#state !== "running") throw new Error("Expected agent_start first");
      switch (event.type) {
        case "turn_start": case "turn_end": return;
        case "message_start": case "message_update": case "message_end":
          this.#message(event.type, event.message);
          return;
        case "tool_execution_start": {
          if (!event.toolCallId || this.#tools.has(event.toolCallId)) throw new Error("Duplicate or empty tool call ID");
          if (!this.#userEnded) throw new Error("Expected completed user input before tool execution");
          this.#checkText(event.toolCallId);
          this.#checkText(event.toolName);
          const block = this.#append(`Tool: ${event.toolName}\n[Running]`);
          this.#tools.set(event.toolCallId, { block, name: event.toolName });
          return;
        }
        case "tool_execution_update": case "tool_execution_end": {
          const tool = this.#tools.get(event.toolCallId);
          if (!tool || tool.block.sealed) throw new Error("Tool update requires an active tool call");
          const end = event.type === "tool_execution_end";
          const text = textParts(end ? event.result.content : event.partialResult.content);
          this.#replace(tool.block, `Tool: ${tool.name}\n${text}${end && event.isError ? "\n[Tool error]" : ""}`);
          if (end) this.#seal(tool.block);
          return;
        }
        case "agent_end":
          if (event.willRetry) throw new Error("Retry is outside this finite trial");
          if (!this.#userEnded || this.#assistant || [...this.#tools.values()].some(tool => !tool.block.sealed)) {
            throw new Error("Run ended with incomplete message or tool lifecycle");
          }
          this.#state = "finished";
          return;
        default: throw new Error("Unsupported Pi event");
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw this.#failure;
    }
  }

  #message(type: "message_start" | "message_update" | "message_end", message: TrialMessage): void {
    if (message.role === "toolResult") {
      // Pi also emits message lifecycle events for the result already displayed above.
      if (type === "message_update" || !message.toolCallId || !this.#tools.get(message.toolCallId)?.block.sealed) {
        throw new Error("Tool result message requires a completed tool execution");
      }
      return;
    }
    if (message.role === "user") {
      const text = textParts(message.content);
      if (type === "message_start" && this.#userText === undefined) {
        this.#append(`User:\n${text}`, true);
        this.#userText = text;
      } else if (type === "message_end" && !this.#userEnded && text === this.#userText) {
        this.#userEnded = true;
      } else throw new Error("Expected one unchanged user message");
      return;
    }
    if (message.role !== "assistant") throw new Error(`Unsupported message role: ${message.role}`);
    if (!this.#userEnded) throw new Error("Expected completed user input before assistant output");
    let text = `Assistant:\n${textParts(message.content, true)}`;
    if (type === "message_end") {
      if (!["stop", "toolUse", "length", "aborted", "error"].includes(message.stopReason ?? "")) {
        throw new Error("Unsupported final assistant stop reason");
      }
      if (message.stopReason === "aborted" || message.stopReason === "error" || message.stopReason === "length") {
        text += `\n[${message.stopReason}]${message.errorMessage ? ` ${message.errorMessage}` : ""}`;
      }
    }
    if (type === "message_start") {
      if (this.#assistant) throw new Error("Previous assistant message is still active");
      this.#assistant = this.#append(text);
    } else {
      if (!this.#assistant) throw new Error("Assistant update requires message_start");
      this.#replace(this.#assistant, text);
      if (type === "message_end") {
        this.#seal(this.#assistant);
        this.#assistant = undefined;
      }
    }
  }

  #checkText(text: string): void {
    if (text.length > this.#limits.maxTextUnits) throw new Error("Trial text limit exceeded");
    if (/[\uD800-\uDFFF]/u.test(text)) throw new Error("Text contains an unpaired surrogate");
  }

  #append(text: string, sealed = false): Block {
    this.#checkText(text);
    if (this.#blocks >= this.#limits.maxBlocks) throw new Error("Trial Block limit exceeded");
    const id = `pi-${++this.#blocks}`;
    const sentState = this.#writer.append(id, text, sealed ? "sealed" : "mutable");
    return { id, text, sentState, sealed };
  }

  #replace(block: Block, text: string): void {
    this.#checkText(text);
    if (text === block.text) return;
    let sentState: string;
    if (text.startsWith(block.text)) {
      sentState = this.#writer.extend(block.id, block.sentState, text.slice(block.text.length));
    } else {
      const previous = Array.from(block.text);
      const next = Array.from(text);
      let retain = 0;
      while (retain < previous.length && retain < next.length && previous[retain] === next[retain]) retain++;
      sentState = this.#writer.replaceSuffix(block.id, block.sentState, retain, next.slice(retain).join(""));
    }
    block.text = text;
    block.sentState = sentState;
  }

  #seal(block: Block): void {
    this.#writer.seal(block.id);
    block.sealed = true;
  }
}
