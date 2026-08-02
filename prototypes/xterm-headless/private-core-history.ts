import headless from "@xterm/headless";
import type { IDisposable, Terminal } from "@xterm/headless";

import {
  TerminalPrototype,
  type Block,
  type BlockId,
  type Operation,
} from "../block-model/model.ts";

const { Terminal: HeadlessTerminal } = headless;

interface BlockRange {
  start: number;
  lineCount: number;
}

interface PrivateBufferLine {
  readonly isWrapped: boolean;
  copyFrom(line: PrivateBufferLine): void;
  translateToString(trimRight: boolean): string;
}

interface PrivateCircularList {
  readonly length: number;
  readonly maxLength: number;
  get(index: number): PrivateBufferLine | undefined;
  splice(
    start: number,
    deleteCount: number,
    ...items: PrivateBufferLine[]
  ): void;
}

interface PrivateBuffer {
  readonly lines: PrivateCircularList;
  ybase: number;
  ydisp: number;
  readonly y: number;
  getBlankLine(): PrivateBufferLine;
}

interface PrivateBufferService {
  readonly buffer: PrivateBuffer;
  readonly _onScroll: { fire(position: number): void };
}

interface PrivateHeadlessTerminal {
  readonly _core: { readonly _bufferService: PrivateBufferService };
}

/**
 * A deliberately private-API experiment. It proves that a historical Block
 * can be replaced inside xterm.js; it is not a reusable integration surface.
 */
export class PrivateCoreBlockHistory implements IDisposable {
  readonly #terminal: Terminal;
  readonly #bufferService: PrivateBufferService;
  readonly #model: TerminalPrototype;
  readonly #ranges = new Map<BlockId, BlockRange>();

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#bufferService = (
      terminal as unknown as PrivateHeadlessTerminal
    )._core._bufferService;
    this.#model = new TerminalPrototype({
      width: terminal.cols,
      height: terminal.rows,
    });
  }

  async apply(operation: Operation): Promise<void> {
    switch (operation.type) {
      case "append":
        await this.#append(operation.block);
        return;
      case "update":
        await this.#update(operation.id, operation.content);
        return;
      case "seal":
        this.#model.apply(operation);
        return;
      default:
        assertNever(operation);
    }
  }

  blocks(): readonly Block[] {
    return this.#model.blocks();
  }

  range(id: BlockId): Readonly<BlockRange> | undefined {
    const range = this.#ranges.get(id);
    return range === undefined ? undefined : { ...range };
  }

  dispose(): void {
    this.#ranges.clear();
  }

  async #append(block: Block): Promise<void> {
    const lines = await this.#materialize(block.content);
    this.#model.apply({ type: "append", block });

    await write(this.#terminal, toTerminalText(block.content));
    const buffer = this.#bufferService.buffer;
    const end = buffer.ybase + buffer.y;
    const start = end - lines.length;
    if (start < 0) {
      throw new Error("The appended Block was trimmed before it could be indexed.");
    }
    this.#ranges.set(block.id, { start, lineCount: lines.length });
  }

  async #update(id: BlockId, content: string): Promise<void> {
    const replacement = await this.#materialize(content);
    const range = this.#ranges.get(id);
    if (range === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no xterm.js line range.`);
    }

    const buffer = this.#bufferService.buffer;
    const oldEnd = range.start + range.lineCount;
    if (buffer.ydisp >= range.start && buffer.ydisp < oldEnd) {
      throw new Error("Updating the Block containing the viewport anchor is undefined.");
    }

    const delta = replacement.length - range.lineCount;
    if (delta > 0 && buffer.lines.length + delta > buffer.lines.maxLength) {
      throw new Error("This spike does not yet handle scrollback capacity trimming.");
    }

    this.#model.apply({ type: "update", id, content });

    const oldYbase = buffer.ybase;
    const oldYdisp = buffer.ydisp;
    const wasFollowingTail = oldYdisp === oldYbase;
    buffer.lines.splice(range.start, range.lineCount, ...replacement);
    buffer.ybase = Math.max(0, oldYbase + delta);

    if (wasFollowingTail) {
      buffer.ydisp = buffer.ybase;
    } else if (oldYdisp >= oldEnd) {
      buffer.ydisp = Math.max(0, oldYdisp + delta);
    }

    range.lineCount = replacement.length;
    for (const [otherId, otherRange] of this.#ranges) {
      if (otherId !== id && otherRange.start >= oldEnd) {
        otherRange.start += delta;
      }
    }

    this.#bufferService._onScroll.fire(buffer.ydisp);
  }

  async #materialize(content: string): Promise<PrivateBufferLine[]> {
    const scratch = new HeadlessTerminal({
      cols: this.#terminal.cols,
      rows: 1,
      scrollback: 10_000,
    });
    try {
      await write(scratch, toTerminalText(content));
      const scratchBuffer = (
        scratch as unknown as PrivateHeadlessTerminal
      )._core._bufferService.buffer;
      const lineCount = scratchBuffer.ybase + scratchBuffer.y;
      const lines: PrivateBufferLine[] = [];
      for (let index = 0; index < lineCount; index += 1) {
        const source = scratchBuffer.lines.get(index);
        if (source === undefined) {
          throw new Error(`Scratch BufferLine ${index} is missing.`);
        }
        const destination = this.#bufferService.buffer.getBlankLine();
        destination.copyFrom(source);
        lines.push(destination);
      }
      return lines;
    } finally {
      scratch.dispose();
    }
  }
}

function toTerminalText(content: string): string {
  const normalized = content
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\r\n");
  return `${normalized}\r\n`;
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Operation: ${JSON.stringify(value)}`);
}
