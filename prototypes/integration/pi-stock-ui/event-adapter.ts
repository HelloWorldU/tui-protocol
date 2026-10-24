import type { LinesTextLine, StyledTextColor, StyledTextSpan, StyledTextStyle, TuiContext } from "@tui-protocol/sdk";
import { spanDrop, spanPrefix } from "@tui-protocol/terminal";
import { linesEdit } from "./lines-edit.ts";
import type { AssistantLinesRenderer } from "./lines-renderer.ts";
import type { AssistantSpanRenderer, RenderableAssistantMessage } from "./styled-renderer.ts";

// Structural slice of the pinned Pi events, not an upstream SDK type or wire schema.
// Additional Pi fields are not consumed. Unsupported content/events fail the trial.
// The mapping matches the pi-session trial: sealed user Block, one mutable assistant
// Block per message, one tool Block per call, Seal on end, abort label on cancel.
// One addition the stock UI needs: a steered follow-up joins the current run, so a
// run may carry more than one user message; each becomes its own sealed Block.
// When the terminal confirmed text/styled, assistant Blocks carry Pi's real
// rendered styling through the renderer; user and tool Blocks stay text/plain.
// When it confirmed text/lines, assistant Blocks instead carry Pi's render as
// lines with layout attributes, which the terminal lays out at every width.
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

export type BlockWriter = Pick<TuiContext, "append" | "update" | "extend" | "replaceSuffix" | "seal">;
export interface TrialLimits {
  readonly maxEvents: number;
  readonly maxBlocks: number;
  readonly maxTextUnits: number;
}
export const DEFAULT_TRIAL_LIMITS: TrialLimits = Object.freeze({
  maxEvents: 256, maxBlocks: 32, maxTextUnits: 65_536,
});

type BlockContent =
  | { readonly type: "text/plain"; text: string }
  | { readonly type: "text/styled"; spans: readonly StyledTextSpan[] }
  | { readonly type: "text/lines"; lines: readonly LinesTextLine[] };

type SentContent = string | readonly StyledTextSpan[] | { readonly lines: readonly LinesTextLine[] };

function isSentLines(content: SentContent): content is { readonly lines: readonly LinesTextLine[] } {
  return typeof content === "object" && "lines" in content;
}
interface Block {
  id: string;
  content: BlockContent;
  sentState: string;
  sealed: boolean;
}
interface Tool { block: Block; name: string }

const ASSISTANT_LABEL: StyledTextSpan = Object.freeze({ text: "Assistant:\n" });
const ASSISTANT_LABEL_LINE: LinesTextLine = Object.freeze({ spans: [{ text: "Assistant:" }] });

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

/** One finite run; assistant Blocks are styled when a renderer is wired. A returned Operation ID is sent state, not acknowledgement. */
export class PiEventAdapter {
  readonly #writer: BlockWriter;
  readonly #limits: TrialLimits;
  readonly #assistantRenderer?: AssistantSpanRenderer;
  readonly #assistantLines?: AssistantLinesRenderer;
  readonly #tools = new Map<string, Tool>();
  #state: "ready" | "running" | "finished" | "failed" = "ready";
  #failure?: Error;
  #events = 0;
  #blocks = 0;
  #activeUser?: string;
  #userMessages = 0;
  #assistant?: Block;

  constructor(
    writer: BlockWriter,
    limits: TrialLimits = DEFAULT_TRIAL_LIMITS,
    assistantRenderer?: AssistantSpanRenderer,
    assistantLines?: AssistantLinesRenderer,
  ) {
    for (const value of [limits.maxEvents, limits.maxBlocks, limits.maxTextUnits]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Trial limits must be positive safe integers");
    }
    this.#writer = writer;
    this.#limits = { ...limits };
    this.#assistantRenderer = assistantRenderer;
    this.#assistantLines = assistantLines;
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
          if (this.#userMessages === 0 || this.#activeUser !== undefined) {
            throw new Error("Expected completed user input before tool execution");
          }
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
          if (this.#userMessages === 0 || this.#activeUser !== undefined || this.#assistant ||
              [...this.#tools.values()].some(tool => !tool.block.sealed)) {
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
      if (type === "message_start") {
        // A steered follow-up joins the same run; each user message is its own sealed Block.
        if (this.#activeUser !== undefined) throw new Error("Previous user message is still active");
        this.#append(`User:\n${text}`, true);
        this.#activeUser = text;
      } else if (type === "message_end" && this.#activeUser !== undefined && text === this.#activeUser) {
        this.#activeUser = undefined;
        this.#userMessages++;
      } else throw new Error("Expected one unchanged user message at a time");
      return;
    }
    if (message.role !== "assistant") throw new Error(`Unsupported message role: ${message.role}`);
    if (this.#userMessages === 0 || this.#activeUser !== undefined) {
      throw new Error("Expected completed user input before assistant output");
    }
    if (type === "message_end" &&
        !["stop", "toolUse", "length", "aborted", "error"].includes(message.stopReason ?? "")) {
      throw new Error("Unsupported final assistant stop reason");
    }
    if (this.#assistantLines) {
      // Lines path: as the styled path, but Pi renders once without width
      // breaks and the lines carry the layout the terminal applies.
      const renderable: RenderableAssistantMessage = {
        content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
      };
      const lines = { lines: [ASSISTANT_LABEL_LINE, ...this.#assistantLines.render(renderable, type !== "message_end")] };
      if (type === "message_start") {
        if (this.#assistant) throw new Error("Previous assistant message is still active");
        this.#assistant = this.#append(lines);
      } else {
        if (!this.#assistant) throw new Error("Assistant update requires message_start");
        this.#replace(this.#assistant, lines);
        if (type === "message_end") {
          this.#seal(this.#assistant);
          this.#assistant = undefined;
        }
      }
      return;
    }
    if (this.#assistantRenderer) {
      // Styled path: Pi's renderer owns the body, including its abort/error
      // labels, so the plain "[aborted]" suffix is not added. The "Assistant:"
      // label span stays unstyled, keeping the Block's logical structure.
      const renderable: RenderableAssistantMessage = {
        content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
      };
      const spans: StyledTextSpan[] = [
        ASSISTANT_LABEL,
        ...this.#assistantRenderer.render(renderable, type !== "message_end"),
      ];
      if (type === "message_start") {
        if (this.#assistant) throw new Error("Previous assistant message is still active");
        this.#assistant = this.#append(spans);
      } else {
        if (!this.#assistant) throw new Error("Assistant update requires message_start");
        this.#replace(this.#assistant, spans);
        if (type === "message_end") {
          this.#seal(this.#assistant);
          this.#assistant = undefined;
        }
      }
      return;
    }
    let text = `Assistant:\n${textParts(message.content, true)}`;
    if (type === "message_end") {
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

  #checkContent(content: SentContent): void {
    if (typeof content === "string") this.#checkText(content);
    else if (!isSentLines(content)) this.#checkText(content.map(span => span.text).join(""));
    else this.#checkText(content.lines.map(line => line.spans.map(span => span.text).join("")).join("\n"));
  }

  #append(content: SentContent, sealed = false): Block {
    this.#checkContent(content);
    if (this.#blocks >= this.#limits.maxBlocks) throw new Error("Trial Block limit exceeded");
    const id = `pi-${++this.#blocks}`;
    const lifecycle = sealed ? "sealed" : "mutable";
    if (isSentLines(content)) {
      const sentState = this.#writer.append(id, content.lines, lifecycle);
      return { id, content: { type: "text/lines", lines: content.lines }, sentState, sealed };
    }
    const sentState = this.#writer.append(id, content as string | readonly StyledTextSpan[], lifecycle);
    return {
      id,
      content: typeof content === "string" ? { type: "text/plain", text: content } : { type: "text/styled", spans: content as readonly StyledTextSpan[] },
      sentState,
      sealed,
    };
  }

  #replace(block: Block, next: SentContent): void {
    this.#checkContent(next);
    let sentState: string;
    if (isSentLines(next)) {
      if (block.content.type !== "text/lines") throw new Error("Block content type changed unexpectedly");
      const edit = linesEdit(block.content.lines, next.lines);
      switch (edit.kind) {
        case "none": return;
        case "extend": sentState = this.#writer.extend(block.id, block.sentState, edit.fragment); break;
        case "replaceSuffix": sentState = this.#writer.replaceSuffix(block.id, block.sentState, edit.retain, edit.replacement); break;
        case "update": sentState = this.#writer.update(block.id, next.lines); break;
      }
      block.content = { type: "text/lines", lines: next.lines };
    } else if (typeof next === "string") {
      if (block.content.type !== "text/plain") throw new Error("Block content type changed unexpectedly");
      if (next === block.content.text) return;
      if (next.startsWith(block.content.text)) {
        sentState = this.#writer.extend(block.id, block.sentState, next.slice(block.content.text.length));
      } else {
        const previous = Array.from(block.content.text);
        const following = Array.from(next);
        let retain = 0;
        while (retain < previous.length && retain < following.length && previous[retain] === following[retain]) retain++;
        sentState = this.#writer.replaceSuffix(block.id, block.sentState, retain, following.slice(retain).join(""));
      }
      block.content = { type: "text/plain", text: next };
    } else {
      if (block.content.type !== "text/styled") throw new Error("Block content type changed unexpectedly");
      const previous = block.content.spans;
      if (spanListEqual(previous, next)) return;
      const previousScalars = logicalScalars(previous);
      if (spanListEqual(spanPrefix(next, previousScalars), previous)) {
        // The previous content is an exact prefix at span granularity (the
        // boundary span may grow with the same style): extend with the tail.
        sentState = this.#writer.extend(block.id, block.sentState, spanDrop(next, previousScalars));
      } else {
        // Style drift (a markdown re-render restyled earlier text) shortens the
        // span-exact common prefix; the update degrades to a ReplaceSuffix whose
        // retain counts the shared prefix's logical scalars.
        let prefix = 0;
        while (prefix < previous.length && prefix < next.length && spanEqual(previous[prefix]!, next[prefix]!)) prefix++;
        const retain = logicalScalars(previous.slice(0, prefix));
        sentState = this.#writer.replaceSuffix(block.id, block.sentState, retain, spanDrop(next, retain));
      }
      block.content = { type: "text/styled", spans: next as readonly StyledTextSpan[] };
    }
    block.sentState = sentState;
  }

  #seal(block: Block): void {
    this.#writer.seal(block.id);
    block.sealed = true;
  }
}

function logicalScalars(spans: readonly StyledTextSpan[]): number {
  let scalars = 0;
  for (const span of spans) scalars += Array.from(span.text).length;
  return scalars;
}

function spanListEqual(a: readonly StyledTextSpan[], b: readonly StyledTextSpan[]): boolean {
  return a.length === b.length && a.every((span, index) => spanEqual(span, b[index]!));
}

function spanEqual(a: StyledTextSpan, b: StyledTextSpan): boolean {
  return a.text === b.text && sameStyle(a.style, b.style);
}

function sameStyle(a: StyledTextStyle | undefined, b: StyledTextStyle | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameColor(a.foreground, b.foreground) &&
    sameColor(a.background, b.background) &&
    a.bold === b.bold &&
    a.faint === b.faint &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse;
}

function sameColor(a: StyledTextColor | undefined, b: StyledTextColor | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if ("palette" in a) return "palette" in b && a.palette === b.palette;
  return "rgb" in b && a.rgb[0] === b.rgb[0] && a.rgb[1] === b.rgb[1] && a.rgb[2] === b.rgb[2];
}
