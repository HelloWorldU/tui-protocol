import type { Terminal } from "@xterm/headless";
import type { ContentSnapshot, LinesTextLine } from "@tui-protocol/protocol";
import type {
  AppliedBlockOperation,
  OperationExecutionErrorCode,
  TerminalOperationAdapter,
  TerminalProtocolEndpoint,
} from "@tui-protocol/terminal";
import { layoutLines, type LayoutRow } from "../../line-layout/layout.ts";
import { LinesProjection, type CellPosition } from "../../line-layout/projection.ts";
import { spansToSgr } from "../../xterm-headless/styled-render.ts";

/** A buffer cell position in the host terminal. */
export interface BufferPosition {
  readonly row: number;
  readonly col: number;
}

interface RenderedBlock {
  readonly key: string;
  readonly projection: LinesProjection;
  readonly rows: readonly LayoutRow[];
  /** Buffer row of the Block's first display row. */
  readonly start: number;
}

/**
 * Experimental xterm.js host for RFC 0003 text/lines: every Block is laid out
 * by the line layout engine at the current width, and the whole managed
 * history is redrawn after each accepted Operation and each resize, keeping a
 * history reader's top row bound to its logical position. A protocol-only
 * stream: no ordinary output is mixed in. text/plain and text/styled Blocks
 * are shown as char-wrapped lines.
 *
 * Not a renderer design: a full redraw is O(history) per change, and the
 * prototype relies on a scrollback large enough for all managed rows.
 */
export class XtermLinesHost implements TerminalOperationAdapter {
  readonly #terminal: Terminal;
  readonly #order: string[] = [];
  #endpoint: TerminalProtocolEndpoint | undefined;
  #rendered: RenderedBlock[] = [];
  #pending: Promise<void> = Promise.resolve();

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    terminal.onResize(() => this.#schedule());
  }

  /** The endpoint whose Session state this host renders; set once after construction. */
  attach(endpoint: TerminalProtocolEndpoint): void {
    this.#endpoint = endpoint;
  }

  prepare(operation: AppliedBlockOperation): OperationExecutionErrorCode | undefined {
    const content = operation.kind === "block.append" || operation.kind === "block.update" ? operation.body.content : undefined;
    // Tabs and control labels of the plain-text projection are not implemented here.
    if (content !== undefined && /[\t\x00-\x09\x0b-\x1f\x7f]/.test(contentTextOf(content))) return "resource_exhausted";
    if (operation.kind === "block.extend" || operation.kind === "block.replace_suffix") {
      const fragment = operation.kind === "block.extend" ? operation.body.fragment : operation.body.replacement;
      if (/[\t\x00-\x09\x0b-\x1f\x7f]/.test(JSON.stringify(fragment).replace(/\\n|\\r/g, ""))) return "resource_exhausted";
    }
    return undefined;
  }

  accept(operation: AppliedBlockOperation): void {
    if (operation.kind === "block.append") this.#order.push(key(operation.context_id, operation.body.block_id));
    if (operation.kind !== "block.seal") this.#schedule();
  }

  /** Resolves when every scheduled redraw has reached the terminal buffer. */
  drain(): Promise<void> {
    return this.#pending;
  }

  /** Buffer range of a Block's rows. */
  range(contextId: string, blockId: string): { start: number; lineCount: number } | undefined {
    const block = this.#rendered.find(entry => entry.key === key(contextId, blockId));
    return block === undefined ? undefined : { start: block.start, lineCount: block.rows.length };
  }

  /** Copy of a selection inside one Block: its logical text, without prefixes or soft breaks. */
  copy(from: BufferPosition, to: BufferPosition): string | undefined {
    const block = this.#blockAt(from.row);
    if (block === undefined || block !== this.#blockAt(to.row - (to.col === 0 ? 1 : 0))) return undefined;
    return block.projection.copy(local(block, from), local(block, to));
  }

  /** Buffer position of the first logical-text match at or after a Block, for selecting it. */
  find(term: string): BufferPosition | undefined {
    for (const block of this.#rendered) {
      const offset = block.projection.find(term)[0];
      if (offset === undefined) continue;
      const position = block.projection.positionOf(offset);
      return { row: block.start + position.row, col: position.col };
    }
    return undefined;
  }

  #blockAt(row: number): RenderedBlock | undefined {
    return this.#rendered.find(block => row >= block.start && row < block.start + block.rows.length);
  }

  #schedule(): void {
    this.#pending = this.#pending.then(() => this.#redraw());
  }

  async #redraw(): Promise<void> {
    const endpoint = this.#endpoint;
    if (endpoint === undefined) return;
    const buffer = this.#terminal.buffer.active;
    // A reader above the tail keeps the logical position at the top of the viewport.
    const following = buffer.viewportY >= buffer.baseY;
    const anchorBlock = following ? undefined : this.#blockAt(buffer.viewportY);
    const anchor = anchorBlock === undefined ? undefined
      : { key: anchorBlock.key, offset: anchorBlock.projection.offsetAt(local(anchorBlock, { row: buffer.viewportY, col: 0 })) };

    const cols = this.#terminal.cols;
    const rendered: RenderedBlock[] = [];
    const output: string[] = [];
    for (const entry of this.#order) {
      const [contextId, blockId] = JSON.parse(entry) as [string, string];
      const content = endpoint.context(contextId)?.blocks.find(block => block.id === blockId)?.content;
      if (content === undefined) continue;
      const lines = linesOf(content);
      const rows = layoutLines(lines, cols);
      rendered.push({ key: entry, projection: new LinesProjection(lines, rows), rows, start: output.length });
      output.push(...rows.map(row => spansToSgr(row.spans)));
    }
    this.#rendered = rendered;
    this.#terminal.reset();
    await new Promise<void>(resolve => this.#terminal.write(output.map(row => `${row}\r\n`).join(""), resolve));

    if (anchor !== undefined) {
      const block = rendered.find(entry => entry.key === anchor.key);
      if (block !== undefined) this.#terminal.scrollToLine(block.start + block.projection.positionOf(anchor.offset).row);
    }
  }
}

function key(contextId: string, blockId: string): string {
  return JSON.stringify([contextId, blockId]);
}

function local(block: RenderedBlock, position: BufferPosition): CellPosition {
  return { row: position.row - block.start, col: position.col };
}

function contentTextOf(content: ContentSnapshot): string {
  return content.type === "text/plain" ? content.data
    : content.type === "text/styled" ? content.data.map(span => span.text).join("")
    : content.data.map(line => line.spans.map(span => span.text).join("")).join("\n");
}

/** text/plain and text/styled become char-wrapped lines, matching cell reflow. */
function linesOf(content: ContentSnapshot): LinesTextLine[] {
  if (content.type === "text/lines") return [...content.data];
  const spans = content.type === "text/plain" ? [{ text: content.data }] : content.data;
  const lines: LinesTextLine[] = [{ spans: [], wrap: "char" }];
  for (const span of spans) {
    span.text.replace(/\r\n?/g, "\n").split("\n").forEach((part, index) => {
      if (index > 0) lines.push({ spans: [], wrap: "char" });
      if (part !== "") (lines.at(-1)!.spans as typeof spans[number][]).push({ ...span, text: part });
    });
  }
  return lines;
}
