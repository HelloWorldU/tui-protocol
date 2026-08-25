import headless from "@xterm/headless";
import type { Terminal as HeadlessTerminalType } from "@xterm/headless";
import type { Terminal } from "@xterm/xterm";

import type { BlockId, Operation } from "../../block-model/model.ts";
import { PrivateCoreBlockHistory } from "../../xterm-headless/private-core-history.ts";

const { Terminal: HeadlessTerminal } = headless;

export type MetadataStyle = "blue-bold" | "green" | "red-bold";

export interface CellStyleSnapshot {
  readonly bold: boolean;
  readonly foreground: number;
  readonly foregroundMode: number;
}

interface PrivateBufferLine {
  get(index: number): [number, string, number, number];
  set(index: number, value: [number, string, number, number]): void;
}

interface PrivateBuffer {
  readonly lines: {
    get(index: number): PrivateBufferLine | undefined;
  };
  readonly y: number;
  readonly ybase: number;
}

interface PrivateTerminal {
  readonly _core: {
    readonly _bufferService: { readonly buffer: PrivateBuffer };
  };
}

/**
 * Browser-only metadata projection for printable, single-line ASCII fixtures.
 * SGR is used only to obtain native xterm cell attributes for the experiment;
 * it is not a proposed content representation or protocol encoding.
 */
export class BrowserMetadataHistory {
  readonly #terminal: Terminal;
  readonly #history: PrivateCoreBlockHistory;
  readonly #styleAttributes: ReadonlyMap<MetadataStyle, number>;
  readonly #metadata = new Map<BlockId, MetadataStyle>();

  private constructor(
    terminal: Terminal,
    styleAttributes: ReadonlyMap<MetadataStyle, number>,
  ) {
    this.#terminal = terminal;
    this.#history = new PrivateCoreBlockHistory(
      terminal as unknown as HeadlessTerminalType,
    );
    this.#styleAttributes = styleAttributes;
  }

  static async create(terminal: Terminal): Promise<BrowserMetadataHistory> {
    return new BrowserMetadataHistory(terminal, await createStyleAttributes());
  }

  async apply(operation: Operation, style?: MetadataStyle): Promise<void> {
    if (
      style !== undefined &&
      operation.type !== "append" &&
      operation.type !== "update"
    ) {
      throw new Error("Metadata style is accepted only for Append or Update.");
    }

    await this.#history.apply(operation);

    if (operation.type === "append") {
      this.#setMetadata(operation.block.id, style);
    } else if (operation.type === "update") {
      this.#setMetadata(operation.id, style);
    }

    this.#dropEvictedMetadata();
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  resize(cols: number, rows: number): void {
    this.#terminal.resize(cols, rows);
    this.#terminal.refresh(0, this.#terminal.rows - 1);
  }

  range(id: BlockId):
    | Readonly<{ start: number; lineCount: number }>
    | undefined {
    return this.#history.range(id);
  }

  hasMetadata(id: BlockId): boolean {
    return this.#metadata.has(id);
  }

  cellStyle(id: BlockId, offset: number): CellStyleSnapshot {
    const block = this.#requiredAsciiBlock(id);
    const range = this.#history.range(id);
    if (range === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no rendered range.`);
    }
    if (offset < 0 || offset >= block.content.length) {
      throw new Error(`Offset ${offset} is outside Block ${JSON.stringify(id)}.`);
    }

    const row = range.start + Math.floor(offset / this.#terminal.cols);
    const column = offset % this.#terminal.cols;
    const cell = this.#terminal.buffer.active.getLine(row)?.getCell(column);
    if (cell === undefined) {
      throw new Error(`Cell ${column},${row} is missing.`);
    }
    return {
      bold: Boolean(cell.isBold()),
      foreground: cell.getFgColor(),
      foregroundMode: cell.getFgColorMode(),
    };
  }

  content(id: BlockId): string {
    return this.#requiredAsciiBlock(id).content;
  }

  dispose(): void {
    this.#history.dispose();
    this.#metadata.clear();
  }

  #setMetadata(id: BlockId, style: MetadataStyle | undefined): void {
    if (style === undefined) {
      this.#metadata.delete(id);
      return;
    }
    this.#metadata.set(id, style);
    this.#projectStyle(id, style);
  }

  #projectStyle(id: BlockId, style: MetadataStyle): void {
    const block = this.#requiredAsciiBlock(id);
    const range = this.#history.range(id);
    if (range === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no rendered range.`);
    }
    const attribute = this.#styleAttributes.get(style);
    if (attribute === undefined) {
      throw new Error(`Style ${JSON.stringify(style)} has no xterm attribute.`);
    }
    const buffer = (this.#terminal as unknown as PrivateTerminal)._core
      ._bufferService.buffer;

    for (let offset = 0; offset < block.content.length; offset += 1) {
      const row = range.start + Math.floor(offset / this.#terminal.cols);
      const column = offset % this.#terminal.cols;
      const line = buffer.lines.get(row);
      if (line === undefined) {
        throw new Error(`BufferLine ${row} is missing.`);
      }
      const cell = line.get(column);
      line.set(column, [attribute, cell[1], cell[2], cell[3]]);
    }
  }

  #dropEvictedMetadata(): void {
    for (const id of this.#metadata.keys()) {
      if (this.#history.range(id) === undefined) {
        this.#metadata.delete(id);
      }
    }
  }

  #requiredAsciiBlock(id: BlockId): { readonly content: string } {
    const block = this.#history.blocks().find((candidate) => candidate.id === id);
    if (block === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} is not retained.`);
    }
    if (!/^[\x20-\x7e]*$/.test(block.content)) {
      throw new Error("Metadata projection is limited to printable ASCII.");
    }
    return block;
  }
}

async function createStyleAttributes(): Promise<ReadonlyMap<MetadataStyle, number>> {
  return new Map<MetadataStyle, number>([
    ["blue-bold", await sgrAttribute("\u001b[1;38;2;37;99;235m")],
    ["green", await sgrAttribute("\u001b[38;2;22;163;74m")],
    ["red-bold", await sgrAttribute("\u001b[1;38;2;220;38;38m")],
  ]);
}

async function sgrAttribute(sgr: string): Promise<number> {
  const scratch = new HeadlessTerminal({ cols: 2, rows: 1 });
  try {
    await write(scratch, `${sgr}X`);
    const buffer = (scratch as unknown as PrivateTerminal)._core._bufferService
      .buffer;
    const line = buffer.lines.get(buffer.ybase + buffer.y);
    if (line === undefined) {
      throw new Error("Styled scratch BufferLine is missing.");
    }
    return line.get(0)[0];
  } finally {
    scratch.dispose();
  }
}

function write(terminal: HeadlessTerminalType, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}
