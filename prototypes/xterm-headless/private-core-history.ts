import headless from "@xterm/headless";
import type { IDisposable, Terminal } from "@xterm/headless";

import {
  TerminalPrototype,
  layoutBlocks,
  type Block,
  type BlockId,
  type Operation,
} from "../block-model/model.ts";

const { Terminal: HeadlessTerminal } = headless;

interface BlockRange {
  start: number;
  lineCount: number;
}

interface PrivateMarker extends IDisposable {
  readonly isDisposed: boolean;
  line: number;
}

interface BlockEntry {
  readonly id: BlockId;
  marker: PrivateMarker;
}

type TargetAnchorMapping =
  | "reject"
  | "preserve"
  | { readonly retainedLineCount: number };

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
  addMarker(line: number): PrivateMarker;
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
  readonly #plannedModel: TerminalPrototype;
  readonly #entries: BlockEntry[] = [];
  readonly #entryIndexes = new Map<BlockId, number>();
  readonly #registrations: IDisposable[] = [];
  #readingAnchor: PrivateMarker | undefined;

  constructor(terminal: Terminal) {
    this.#terminal = terminal;
    this.#bufferService = (
      terminal as unknown as PrivateHeadlessTerminal
    )._core._bufferService;
    this.#model = new TerminalPrototype({
      width: terminal.cols,
      height: terminal.rows,
    });
    this.#plannedModel = new TerminalPrototype({
      width: terminal.cols,
      height: terminal.rows,
    });
    this.#registrations.push(
      terminal.onResize(({ cols, rows }) => {
        this.#model.resize({ width: cols, height: rows });
        this.#plannedModel.resize({ width: cols, height: rows });
        this.#restoreReadingAnchor();
      }),
      terminal.onScroll((position) => this.#captureReadingAnchor(position)),
    );
  }

  async apply(operation: Operation): Promise<void> {
    this.accept(operation);
    await this.renderAccepted(operation);
  }

  /** Records an accepted Operation in the projection used by preflight. */
  accept(operation: Operation): void {
    this.#plannedModel.apply(operation);
  }

  /** Materializes an Operation that was already recorded by accept(). */
  async renderAccepted(operation: Operation): Promise<void> {
    switch (operation.type) {
      case "append":
        await this.#append(operation.block);
        return;
      case "update":
        await this.#update(operation.id, operation.content);
        return;
      case "extend":
        await this.#extend(operation.id, operation.fragment);
        return;
      case "replaceSuffix":
        await this.#replaceSuffix(
          operation.id,
          operation.retain,
          operation.replacement,
        );
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
    const index = this.#entryIndexes.get(id);
    if (index === undefined) {
      return undefined;
    }
    return { ...this.#rangeAt(index) };
  }

  wouldExceedCapacity(operation: Operation): boolean {
    if (
      operation.type !== "update" &&
      operation.type !== "extend" &&
      operation.type !== "replaceSuffix"
    ) {
      return false;
    }

    const block = this.#plannedModel
      .blocks()
      .find((candidate) => candidate.id === operation.id);
    if (block === undefined) {
      throw new Error(
        `Block ${JSON.stringify(operation.id)} has no planned xterm.js content.`,
      );
    }
    const currentLineCount = layoutBlocks(
      [block],
      this.#terminal.cols,
    ).length;
    let replacementContent: string;
    switch (operation.type) {
      case "update":
        replacementContent = operation.content;
        break;
      case "extend":
        replacementContent = `${block.content}${operation.fragment}`;
        break;
      case "replaceSuffix":
        replacementContent = replaceSuffixText(
          block.content,
          operation.retain,
          operation.replacement,
        );
        break;
    }
    const replacementLineCount = layoutBlocks(
      [
        {
          id: operation.id,
          lifecycle: "mutable",
          content: replacementContent,
        },
      ],
      this.#terminal.cols,
    ).length;
    const plannedLineCount =
      this.#plannedModel.allRows().length -
      currentLineCount +
      replacementLineCount;
    const lines = this.#bufferService.buffer.lines;
    return (
      Math.max(this.#terminal.rows, plannedLineCount + 1) > lines.maxLength
    );
  }

  dispose(): void {
    for (const registration of this.#registrations.splice(0)) {
      registration.dispose();
    }
    this.#readingAnchor?.dispose();
    this.#readingAnchor = undefined;
    for (const entry of this.#entries) {
      entry.marker.dispose();
    }
    this.#entries.length = 0;
    this.#entryIndexes.clear();
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
    const marker = buffer.addMarker(start);
    this.#entryIndexes.set(block.id, this.#entries.length);
    this.#entries.push({ id: block.id, marker });
  }

  async #update(
    id: BlockId,
    content: string,
    targetAnchorMapping: TargetAnchorMapping = "reject",
  ): Promise<void> {
    const replacement = await this.#materialize(content);
    const entryIndex = this.#entryIndexes.get(id);
    if (entryIndex === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no xterm.js line range.`);
    }
    const entry = this.#entries[entryIndex];
    const range = this.#rangeAt(entryIndex);

    const buffer = this.#bufferService.buffer;
    const oldEnd = range.start + range.lineCount;
    const oldYbase = buffer.ybase;
    const oldYdisp = buffer.ydisp;
    const wasFollowingTail = oldYdisp === oldYbase;
    const targetAnchorOffset =
      !wasFollowingTail && oldYdisp >= range.start && oldYdisp < oldEnd
        ? oldYdisp - range.start
        : undefined;
    const mappedTargetAnchorOffset =
      targetAnchorOffset === undefined
        ? undefined
        : mapTargetAnchor(targetAnchorOffset, targetAnchorMapping);

    const delta = replacement.length - range.lineCount;
    if (delta > 0 && buffer.lines.length + delta > buffer.lines.maxLength) {
      throw new Error("This spike does not yet handle scrollback capacity trimming.");
    }

    this.#model.apply({ type: "update", id, content });

    buffer.lines.splice(range.start, range.lineCount, ...replacement);
    buffer.ybase = Math.max(0, oldYbase + delta);

    if (wasFollowingTail) {
      buffer.ydisp = buffer.ybase;
    } else if (mappedTargetAnchorOffset !== undefined) {
      buffer.ydisp = Math.min(
        buffer.ybase,
        range.start + mappedTargetAnchorOffset,
      );
    } else if (oldYdisp >= oldEnd) {
      buffer.ydisp = Math.max(0, oldYdisp + delta);
    }

    entry.marker = buffer.addMarker(range.start);

    this.#bufferService._onScroll.fire(buffer.ydisp);
  }

  async #extend(id: BlockId, fragment: string): Promise<void> {
    const block = this.#model
      .blocks()
      .find((candidate) => candidate.id === id);
    if (block === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no rendered content.`);
    }
    await this.#update(id, `${block.content}${fragment}`, "preserve");
  }

  async #replaceSuffix(
    id: BlockId,
    retain: number,
    replacement: string,
  ): Promise<void> {
    const block = this.#model
      .blocks()
      .find((candidate) => candidate.id === id);
    if (block === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no rendered content.`);
    }
    const retainedPrefix = Array.from(block.content)
      .slice(0, retain)
      .join("");
    const retainedLines = await this.#materialize(retainedPrefix);
    await this.#update(
      id,
      `${retainedPrefix}${replacement}`,
      { retainedLineCount: retainedLines.length },
    );
  }

  #rangeAt(index: number): BlockRange {
    const entry = this.#entries[index];
    if (entry.marker.isDisposed) {
      throw new Error(`Block ${JSON.stringify(entry.id)} was trimmed from xterm.js.`);
    }
    const start = entry.marker.line;
    const nextEntry = this.#entries[index + 1];
    const end =
      nextEntry === undefined
        ? this.#bufferService.buffer.ybase + this.#bufferService.buffer.y
        : nextEntry.marker.line;
    return { start, lineCount: end - start };
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

  #captureReadingAnchor(position: number): void {
    this.#readingAnchor?.dispose();
    this.#readingAnchor = undefined;

    const buffer = this.#bufferService.buffer;
    if (position !== buffer.ybase) {
      this.#readingAnchor = buffer.addMarker(position);
    }
  }

  #restoreReadingAnchor(): void {
    const anchor = this.#readingAnchor;
    if (anchor === undefined || anchor.isDisposed) {
      return;
    }

    const buffer = this.#bufferService.buffer;
    const position = Math.min(buffer.ybase, Math.max(0, anchor.line));
    if (position !== buffer.ydisp) {
      buffer.ydisp = position;
      this.#bufferService._onScroll.fire(position);
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

function replaceSuffixText(
  content: string,
  retain: number,
  replacement: string,
): string {
  return `${Array.from(content).slice(0, retain).join("")}${replacement}`;
}

function mapTargetAnchor(
  rowOffset: number,
  mapping: TargetAnchorMapping,
): number {
  if (mapping === "reject") {
    throw new Error(
      "Updating the Block containing the viewport anchor is undefined.",
    );
  }
  if (mapping === "preserve") {
    return rowOffset;
  }
  return Math.min(rowOffset, Math.max(0, mapping.retainedLineCount - 1));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Operation: ${JSON.stringify(value)}`);
}
