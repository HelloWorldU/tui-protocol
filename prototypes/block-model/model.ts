export type BlockId = string;

export type BlockLifecycle = "mutable" | "sealed";

export interface Block {
  readonly id: BlockId;
  readonly content: string;
  readonly lifecycle: BlockLifecycle;
}

export interface AppendOperation {
  readonly type: "append";
  readonly block: Block;
}

export interface UpdateOperation {
  readonly type: "update";
  readonly id: BlockId;
  readonly content: string;
}

export interface ExtendOperation {
  readonly type: "extend";
  readonly id: BlockId;
  readonly fragment: string;
}

export interface ReplaceSuffixOperation {
  readonly type: "replaceSuffix";
  readonly id: BlockId;
  readonly retain: number;
  readonly replacement: string;
}

export interface SealOperation {
  readonly type: "seal";
  readonly id: BlockId;
}

export type Operation =
  | AppendOperation
  | UpdateOperation
  | ExtendOperation
  | ReplaceSuffixOperation
  | SealOperation;

export type ProtocolErrorCode =
  | "ALREADY_SEALED"
  | "BLOCK_SEALED"
  | "DUPLICATE_BLOCK"
  | "INVALID_ANCHOR"
  | "INVALID_BLOCK_ID"
  | "INVALID_CONTENT_BOUNDARY"
  | "INVALID_DIMENSIONS"
  | "UNKNOWN_BLOCK";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export interface ViewportAnchor {
  readonly blockId: BlockId;
  readonly offset: number;
}

export interface RenderedRow {
  readonly blockId: BlockId;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
}

export interface TerminalDimensions {
  readonly width: number;
  readonly height: number;
}

export class TerminalPrototype {
  readonly #blocks: Block[] = [];
  readonly #blockIndexes = new Map<BlockId, number>();
  #dimensions: TerminalDimensions;
  #anchor: ViewportAnchor | undefined;

  constructor(dimensions: TerminalDimensions) {
    validateDimensions(dimensions);
    this.#dimensions = { ...dimensions };
  }

  apply(operation: Operation): void {
    switch (operation.type) {
      case "append":
        this.#append(operation.block);
        return;
      case "update":
        this.#update(operation.id, operation.content);
        return;
      case "extend":
        this.#extend(operation.id, operation.fragment);
        return;
      case "replaceSuffix":
        this.#replaceSuffix(
          operation.id,
          operation.retain,
          operation.replacement,
        );
        return;
      case "seal":
        this.#seal(operation.id);
        return;
      default:
        assertNever(operation);
    }
  }

  resize(dimensions: TerminalDimensions): void {
    validateDimensions(dimensions);
    this.#dimensions = { ...dimensions };
  }

  scrollTo(anchor: ViewportAnchor): void {
    this.#validateAnchor(anchor);
    this.#anchor = { ...anchor };
  }

  followTail(): void {
    this.#anchor = undefined;
  }

  anchor(): ViewportAnchor | undefined {
    return this.#anchor === undefined ? undefined : { ...this.#anchor };
  }

  blocks(): readonly Block[] {
    return this.#blocks.map((block) => ({ ...block }));
  }

  allRows(): readonly RenderedRow[] {
    return layoutBlocks(this.#blocks, this.#dimensions.width);
  }

  scrollbackRows(): readonly RenderedRow[] {
    const rows = this.allRows();
    return rows.slice(0, Math.max(0, rows.length - this.#dimensions.height));
  }

  viewportRows(): readonly RenderedRow[] {
    const rows = this.allRows();
    const start =
      this.#anchor === undefined
        ? Math.max(0, rows.length - this.#dimensions.height)
        : findAnchorRow(rows, this.#anchor);

    return rows.slice(start, start + this.#dimensions.height);
  }

  isBlockFullyInScrollback(id: BlockId): boolean {
    this.#requireBlock(id);
    const rows = this.allRows();
    const viewportStart = Math.max(0, rows.length - this.#dimensions.height);
    const blockRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.blockId === id);

    return (
      blockRows.length > 0 &&
      blockRows.every(({ index }) => index < viewportStart)
    );
  }

  #append(block: Block): void {
    validateBlockId(block.id);
    if (this.#blockIndexes.has(block.id)) {
      throw new ProtocolError(
        "DUPLICATE_BLOCK",
        `Block ${JSON.stringify(block.id)} already exists.`,
      );
    }

    const stored = { ...block };
    this.#blockIndexes.set(stored.id, this.#blocks.length);
    this.#blocks.push(stored);
  }

  #update(id: BlockId, content: string): void {
    const index = this.#requireBlockIndex(id);
    const block = this.#blocks[index];
    if (block.lifecycle === "sealed") {
      throw new ProtocolError(
        "BLOCK_SEALED",
        `Block ${JSON.stringify(id)} is sealed.`,
      );
    }

    this.#blocks[index] = { ...block, content };
  }

  #extend(id: BlockId, fragment: string): void {
    const index = this.#requireBlockIndex(id);
    const block = this.#blocks[index];
    if (block.lifecycle === "sealed") {
      throw new ProtocolError(
        "BLOCK_SEALED",
        `Block ${JSON.stringify(id)} is sealed.`,
      );
    }

    this.#blocks[index] = { ...block, content: `${block.content}${fragment}` };
  }

  #replaceSuffix(id: BlockId, retain: number, replacement: string): void {
    const index = this.#requireBlockIndex(id);
    const block = this.#blocks[index];
    if (block.lifecycle === "sealed") {
      throw new ProtocolError(
        "BLOCK_SEALED",
        `Block ${JSON.stringify(id)} is sealed.`,
      );
    }

    const scalars = Array.from(block.content);
    if (
      !Number.isSafeInteger(retain) ||
      retain < 0 ||
      retain >= scalars.length
    ) {
      throw new ProtocolError(
        "INVALID_CONTENT_BOUNDARY",
        `Retained prefix ${retain} does not remove a suffix from Block ${JSON.stringify(id)}.`,
      );
    }

    this.#blocks[index] = {
      ...block,
      content: `${scalars.slice(0, retain).join("")}${replacement}`,
    };
    if (this.#anchor?.blockId === id && this.#anchor.offset >= retain) {
      this.#anchor = { blockId: id, offset: retain };
    }
  }

  #seal(id: BlockId): void {
    const index = this.#requireBlockIndex(id);
    const block = this.#blocks[index];
    if (block.lifecycle === "sealed") {
      throw new ProtocolError(
        "ALREADY_SEALED",
        `Block ${JSON.stringify(id)} is already sealed.`,
      );
    }

    this.#blocks[index] = { ...block, lifecycle: "sealed" };
  }

  #validateAnchor(anchor: ViewportAnchor): void {
    const block = this.#requireBlock(anchor.blockId);
    const contentLength = [...block.content].length;
    if (
      !Number.isInteger(anchor.offset) ||
      anchor.offset < 0 ||
      anchor.offset > contentLength
    ) {
      throw new ProtocolError(
        "INVALID_ANCHOR",
        `Offset ${anchor.offset} is outside Block ${JSON.stringify(anchor.blockId)}.`,
      );
    }
  }

  #requireBlock(id: BlockId): Block {
    return this.#blocks[this.#requireBlockIndex(id)];
  }

  #requireBlockIndex(id: BlockId): number {
    const index = this.#blockIndexes.get(id);
    if (index === undefined) {
      throw new ProtocolError(
        "UNKNOWN_BLOCK",
        `Block ${JSON.stringify(id)} does not exist.`,
      );
    }
    return index;
  }
}

export function layoutBlocks(
  blocks: readonly Block[],
  width: number,
): readonly RenderedRow[] {
  if (!Number.isInteger(width) || width <= 0) {
    throw new ProtocolError(
      "INVALID_DIMENSIONS",
      "Terminal width must be a positive integer.",
    );
  }

  return blocks.flatMap((block) => layoutBlock(block, width));
}

function layoutBlock(block: Block, width: number): readonly RenderedRow[] {
  const rows: RenderedRow[] = [];
  const logicalLines = block.content.split("\n");
  let lineOffset = 0;

  for (const [lineIndex, logicalLine] of logicalLines.entries()) {
    const characters = [...logicalLine];

    if (characters.length === 0) {
      rows.push({
        blockId: block.id,
        startOffset: lineOffset,
        endOffset: lineOffset,
        text: "",
      });
    } else {
      for (let start = 0; start < characters.length; start += width) {
        const chunk = characters.slice(start, start + width);
        rows.push({
          blockId: block.id,
          startOffset: lineOffset + start,
          endOffset: lineOffset + start + chunk.length,
          text: chunk.join(""),
        });
      }
    }

    lineOffset += characters.length;
    if (lineIndex < logicalLines.length - 1) {
      lineOffset += 1;
    }
  }

  return rows;
}

function findAnchorRow(
  rows: readonly RenderedRow[],
  anchor: ViewportAnchor,
): number {
  let candidate = -1;

  for (const [index, row] of rows.entries()) {
    if (row.blockId !== anchor.blockId) {
      continue;
    }
    if (row.startOffset <= anchor.offset) {
      candidate = index;
      continue;
    }
    break;
  }

  if (candidate === -1) {
    throw new ProtocolError(
      "INVALID_ANCHOR",
      `Block ${JSON.stringify(anchor.blockId)} has no renderable anchor.`,
    );
  }

  return candidate;
}

function validateBlockId(id: BlockId): void {
  if (id.length === 0) {
    throw new ProtocolError("INVALID_BLOCK_ID", "Block ID must not be empty.");
  }
}

function validateDimensions(dimensions: TerminalDimensions): void {
  if (
    !Number.isInteger(dimensions.width) ||
    dimensions.width <= 0 ||
    !Number.isInteger(dimensions.height) ||
    dimensions.height <= 0
  ) {
    throw new ProtocolError(
      "INVALID_DIMENSIONS",
      "Terminal width and height must be positive integers.",
    );
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Operation: ${JSON.stringify(value)}`);
}
