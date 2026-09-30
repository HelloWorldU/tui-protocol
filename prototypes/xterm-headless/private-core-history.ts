import headless from "@xterm/headless";
import type { IDisposable, Terminal } from "@xterm/headless";
import { fixtureCellWidth, projectPlainText } from "./plain-text.ts";

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

interface PrivateMarker extends IDisposable {
  readonly isDisposed: boolean;
  line: number;
}

interface BlockEntry {
  readonly id: BlockId;
  startMarker: PrivateMarker;
  endMarker: PrivateMarker;
}

type TargetAnchorMapping =
  | "replacementStart"
  | "preserve"
  | { readonly retainedBoundaryRow: number };

interface CapacityTrimPlan {
  readonly entryCount: number;
  readonly blockIds: readonly BlockId[];
}

interface TextLineCount {
  readonly count: number;
  readonly exact: boolean;
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
  readonly x: number;
  y: number;
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
 * The minimal view of an app-owned screen region that region-aware placement
 * needs. The integration layer supplies the concrete passive tracker; the
 * history only reads the region top and reports how materialization moves it.
 */
export interface BlockHistoryRegion {
  /**
   * First absolute buffer row owned by the application's ordinary output, or
   * undefined when the extent is unknown. Every managed Block range must end
   * at or above this row; placement checks enforce that and drop the
   * estimate when it is contradicted.
   */
  topRow(): number | undefined;
  /** Moves the extent by rows inserted (+) or removed (-) above it. */
  shift(delta: number): void;
  /** Drops the extent estimate; placement falls back to the cursor. */
  reset(): void;
}

export interface PrivateCoreBlockHistoryOptions {
  /**
   * Opt-in experimental region-aware mode. Without it, every Block
   * materializes at the cursor exactly as before.
   */
  readonly region?: BlockHistoryRegion;
}

/**
 * Region-mode recovery from the application's clearing full redraw
 * (`CSI 2J` / `CSI 3J`, emitted together by Pi's resize re-render). The mixed
 * ingress reports the erased row ranges instead of invalidating Contexts;
 * the history then re-materializes the damaged retained Blocks above the
 * re-learned app region. `ESC c` is not covered: it remains a genuine reset
 * and still invalidates.
 */
export interface BlockHistoryClearRecovery {
  /** Records the normal-buffer rows an application erase destroys. */
  noteAppEraseRows(start: number, end: number): void;
  /** True when damaged Blocks wait for the region to be re-established. */
  hasPendingRematerialization(): boolean;
  /**
   * Re-materializes every damaged retained Block in document order above the
   * current region estimate and recomputes the managed ranges. Throws when
   * the region extent is not yet observable again; the endpoint aborts
   * rather than risk drawing over the application's next frame.
   */
  rematerializeDamagedBlocks(): Promise<void>;
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
  readonly #region: BlockHistoryRegion | undefined;
  readonly #entries: BlockEntry[] = [];
  readonly #entryIndexes = new Map<BlockId, number>();
  readonly #plannedAppendTrims = new Map<BlockId, CapacityTrimPlan>();
  readonly #plannedTrimmedBlockIds = new Set<BlockId>();
  readonly #damagedBlockIds = new Set<BlockId>();
  readonly #registrations: IDisposable[] = [];
  #readingAnchor: PrivateMarker | undefined;
  #acceptedRenderCount = 0;

  constructor(terminal: Terminal, options?: PrivateCoreBlockHistoryOptions) {
    this.#terminal = terminal;
    this.#region = options?.region;
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
    this.#acceptedRenderCount += 1;
  }

  /** Materializes an Operation that was already recorded by accept(). */
  async renderAccepted(operation: Operation): Promise<void> {
    try {
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
    } finally {
      this.#acceptedRenderCount -= 1;
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
    const entry = this.#entries[index];
    if (
      entry.startMarker.isDisposed ||
      entry.endMarker.isDisposed ||
      entry.endMarker.line <= entry.startMarker.line
    ) {
      return undefined;
    }
    return { ...this.#rangeAt(index) };
  }

  /** Stops treating a rendered Block as managed after native traffic owns it. */
  retire(id: BlockId): void {
    const index = this.#entryIndexes.get(id);
    if (index === undefined) {
      return;
    }
    const [entry] = this.#entries.splice(index, 1);
    entry.startMarker.dispose();
    entry.endMarker.dispose();
    this.#plannedTrimmedBlockIds.add(id);
    this.#damagedBlockIds.delete(id);
    this.#rebuildEntryIndexes();
  }

  noteAppEraseRows(start: number, end: number): void {
    if (this.#region === undefined || end <= start) {
      return;
    }
    for (const entry of this.#entries) {
      const range = this.range(entry.id);
      if (
        range !== undefined &&
        range.start < end &&
        start < range.start + range.lineCount
      ) {
        this.#damagedBlockIds.add(entry.id);
      }
    }
  }

  hasPendingRematerialization(): boolean {
    return this.#damagedBlockIds.size > 0;
  }

  /**
   * Re-materializes damaged retained Blocks above the current region
   * estimate, in document order, reusing the region-aware insertion (cursor
   * compensation, capacity trimming, and boundary-marker handling all
   * apply). Blocks the Session still retains keep their identity and later
   * Operations see fresh ranges; capacity-evicted and retired Blocks stay
   * gone. Validated only by the region-ownership tests in the xterm
   * protocol endpoint prototype.
   */
  async rematerializeDamagedBlocks(): Promise<void> {
    if (this.#damagedBlockIds.size === 0) {
      return;
    }
    const region = this.#region;
    if (region === undefined) {
      this.#damagedBlockIds.clear();
      return;
    }
    const damaged = new Set(this.#damagedBlockIds);
    this.#damagedBlockIds.clear();
    // An entry whose markers the erase disposed before it could be reported
    // is damaged as well, unless the Block was capacity-evicted on purpose.
    // `CSI 2J` also disposes markers on the rows it blanks, which can cost a
    // Block entirely above the erased span only its end marker; that loss is
    // repaired in place instead of duplicating its intact rows.
    for (const entry of this.#entries) {
      if (
        !this.#plannedTrimmedBlockIds.has(entry.id) &&
        this.range(entry.id) === undefined &&
        !(await this.#tryRepairBoundaryMarker(entry))
      ) {
        damaged.add(entry.id);
      }
    }
    const retainedEntries = this.#entries.filter(
      (entry) => !damaged.has(entry.id),
    );
    for (const entry of this.#entries) {
      if (damaged.has(entry.id)) {
        entry.startMarker.dispose();
        entry.endMarker.dispose();
      }
    }
    this.#entries.length = 0;
    this.#entries.push(...retainedEntries);
    this.#rebuildEntryIndexes();

    const modelOrder = this.#model.blocks().map((block) => block.id);
    for (const block of this.#model.blocks()) {
      if (!damaged.has(block.id) || this.#plannedTrimmedBlockIds.has(block.id)) {
        continue;
      }
      const lines = await this.#materialize(block.content);
      const top = this.#rematerializationTop(modelOrder.indexOf(block.id), modelOrder);
      if (top === undefined) {
        throw new Error(
          "This spike cannot re-materialize Blocks before the app region is observable again.",
        );
      }
      this.#insertAboveRegion(block, lines, top);
    }
  }

  /**
   * `CSI 2J` disposes markers on the rows it blanks, including the end
   * marker of a Block whose content rows sit entirely above the erased span
   * (its end marker rests on the first erased row). When the surviving
   * buffer rows still match the Block's materialization exactly, recreating
   * the lost end marker is sound and avoids duplicating intact rows; any
   * other marker loss means content is gone and the Block is damage to
   * re-materialize.
   */
  async #tryRepairBoundaryMarker(entry: BlockEntry): Promise<boolean> {
    if (entry.startMarker.isDisposed || !entry.endMarker.isDisposed) {
      return false;
    }
    const block = this.#model
      .blocks()
      .find((candidate) => candidate.id === entry.id);
    if (block === undefined) {
      return false;
    }
    const lines = await this.#materialize(block.content);
    const buffer = this.#bufferService.buffer;
    const start = entry.startMarker.line;
    if (start + lines.length > buffer.lines.length) {
      return false;
    }
    for (let index = 0; index < lines.length; index += 1) {
      const actual = buffer.lines.get(start + index)?.translateToString(true);
      if (actual !== lines[index].translateToString(true)) {
        return false;
      }
    }
    entry.endMarker = buffer.addMarker(start + lines.length);
    return true;
  }

  /**
   * The row at which one damaged Block re-materializes: immediately above
   * the oldest retained Block that is newer in document order, falling back
   * to the region estimate when no newer Block survives. Document order is
   * preserved whether the erase damaged older Blocks (scrollback clear),
   * newer Blocks (viewport clear), or all of them; already re-materialized
   * Blocks anchor later ones through their fresh markers.
   */
  #rematerializationTop(
    modelIndex: number,
    modelOrder: readonly BlockId[],
  ): number | undefined {
    let top = this.#region?.topRow();
    for (const entry of this.#entries) {
      if (modelOrder.indexOf(entry.id) <= modelIndex) {
        continue;
      }
      const range = this.range(entry.id);
      if (range !== undefined) {
        top = top === undefined ? range.start : Math.min(top, range.start);
        break;
      }
    }
    return top;
  }

  wouldExceedCapacity(operation: Operation): boolean {
    if (operation.type === "append") {
      return this.#appendWouldExceedCapacity(operation.block);
    }
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
    if (this.#plannedTrimmedBlockIds.has(operation.id)) {
      return true;
    }
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
    const replacementLayout = conservativeTextLineCount(
      replacementContent,
      this.#terminal.cols,
      this.#terminal.options.tabStopWidth,
    );
    if (replacementLayout === undefined) {
      return true;
    }
    const retainedBlocks = this.#plannedModel
      .blocks()
      .filter((candidate) => !this.#plannedTrimmedBlockIds.has(candidate.id));
    const lines = this.#bufferService.buffer.lines;
    let excess: number;
    let estimateIsExact = replacementLayout.exact;
    if (this.#acceptedRenderCount === 0) {
      const renderedRange = this.range(operation.id);
      if (renderedRange === undefined) {
        return true;
      }
      excess = Math.max(
        0,
        lines.length -
          renderedRange.lineCount +
          replacementLayout.count -
          lines.maxLength,
      );
    } else {
      let plannedLineCount = 0;
      for (const candidate of retainedBlocks) {
        const layout = conservativeTextLineCount(
          candidate.id === operation.id
            ? replacementContent
            : candidate.content,
          this.#terminal.cols,
          this.#terminal.options.tabStopWidth,
        );
        if (layout === undefined) {
          return true;
        }
        plannedLineCount += layout.count;
        estimateIsExact &&= layout.exact;
      }
      excess =
        Math.max(this.#terminal.rows, plannedLineCount + 1) - lines.maxLength;
    }
    if (excess <= 0) {
      return false;
    }
    if (!estimateIsExact) {
      return true;
    }
    const trimPlan = this.#capacityTrimPlan(excess, operation.id);
    if (trimPlan === undefined) {
      return true;
    }
    for (const id of trimPlan.blockIds) {
      this.#plannedTrimmedBlockIds.add(id);
    }
    return false;
  }

  dispose(): void {
    for (const registration of this.#registrations.splice(0)) {
      registration.dispose();
    }
    this.#readingAnchor?.dispose();
    this.#readingAnchor = undefined;
    for (const entry of this.#entries) {
      entry.startMarker.dispose();
      entry.endMarker.dispose();
    }
    this.#entries.length = 0;
    this.#entryIndexes.clear();
    this.#plannedAppendTrims.clear();
    this.#plannedTrimmedBlockIds.clear();
    this.#damagedBlockIds.clear();
  }

  async #append(block: Block): Promise<void> {
    const trimPlan = this.#plannedAppendTrims.get(block.id);
    this.#plannedAppendTrims.delete(block.id);
    const lines = await this.#materialize(block.content);
    this.#model.apply({ type: "append", block });

    const regionTop = this.#regionPlacementTop();
    if (regionTop !== undefined) {
      this.#insertAboveRegion(block, lines, regionTop);
      return;
    }

    const buffer = this.#bufferService.buffer;
    await write(
      this.#terminal,
      `${appendBoundary(buffer)}${toTerminalText(block.content, this.#terminal.options.tabStopWidth)}`,
    );
    const end = buffer.ybase + buffer.y;
    const start = end - lines.length;
    if (start < 0) {
      throw new Error("The appended Block was trimmed before it could be indexed.");
    }
    if (trimPlan !== undefined) {
      this.#dropLeadingEntries(trimPlan.entryCount);
    }
    const startMarker = buffer.addMarker(start);
    const endMarker = buffer.addMarker(end);
    this.#entryIndexes.set(block.id, this.#entries.length);
    this.#entries.push({ id: block.id, startMarker, endMarker });
  }

  /**
   * The row where a Block may materialize above the app region, or undefined
   * to place at the cursor. A region estimate contradicted by the Block
   * ranges already placed is dropped, so a wrong estimate falls back to
   * cursor placement where the mixed-ingress watchdog still sees any real
   * conflict instead of the insertion hiding it.
   */
  #regionPlacementTop(): number | undefined {
    const region = this.#region;
    if (region === undefined) {
      return undefined;
    }
    const top = region.topRow();
    if (top === undefined) {
      return undefined;
    }
    const lines = this.#bufferService.buffer.lines;
    if (top < 0 || top > lines.length) {
      region.reset();
      return undefined;
    }
    for (const entry of this.#entries) {
      const range = this.range(entry.id);
      if (range !== undefined && range.start + range.lineCount > top) {
        region.reset();
        return undefined;
      }
    }
    return top;
  }

  /**
   * Materializes an accepted Block immediately above the app region: the
   * region's rows shift down as a whole, the viewport follows only as far as
   * the pushed cursor requires, and the cursor is compensated by the
   * inserted row count so the application's next relative cursor movement
   * still lands on its own rows. Validated only by the region-ownership
   * tests in the xterm protocol endpoint prototype.
   */
  #insertAboveRegion(
    block: Block,
    lines: PrivateBufferLine[],
    regionTop: number,
  ): void {
    const buffer = this.#bufferService.buffer;
    const delta = lines.length;
    const trimLineCount = Math.max(
      0,
      buffer.lines.length + delta - buffer.lines.maxLength,
    );
    const trimPlan =
      trimLineCount === 0
        ? undefined
        : this.#capacityTrimPlan(
            trimLineCount,
            block.id,
            Number.POSITIVE_INFINITY,
          );
    if (trimLineCount > 0 && trimPlan === undefined) {
      throw new Error(
        "This spike cannot safely trim the required scrollback rows.",
      );
    }

    // A Block ending exactly at the region top would absorb the inserted
    // rows through xterm's insert-index marker rule; its end marker is
    // recreated at the true boundary below. Ranges are disjoint, so at most
    // one entry can end at the insertion row.
    const boundaryEntry = this.#entries.find(
      (entry) => !entry.endMarker.isDisposed && entry.endMarker.line === regionTop,
    );

    const oldYbase = buffer.ybase;
    const oldYdisp = buffer.ydisp;
    const wasFollowingTail = oldYdisp === oldYbase;
    const cursorLine = oldYbase + buffer.y;
    const slack = trailingBlankViewportRows(
      buffer,
      cursorLine,
      this.#terminal.rows,
    );

    buffer.lines.splice(regionTop, 0, ...lines);

    // Net growth first consumes blank viewport rows below the cursor; only
    // the excess scrolls the viewport so the pushed region stays on screen.
    buffer.ybase = oldYbase + Math.max(0, delta - trimLineCount - slack);
    buffer.y = Math.max(0, Math.min(
      this.#terminal.rows - 1,
      cursorLine + delta - trimLineCount - buffer.ybase,
    ));
    // xterm requires a complete active screen even when retained content is short.
    while (buffer.lines.length < buffer.ybase + this.#terminal.rows) {
      buffer.lines.splice(buffer.lines.length, 0, buffer.getBlankLine());
    }

    if (wasFollowingTail) {
      buffer.ydisp = buffer.ybase;
    } else if (oldYdisp >= regionTop) {
      buffer.ydisp = Math.min(
        buffer.ybase,
        Math.max(0, oldYdisp + delta - trimLineCount),
      );
    } else {
      // Rows above the region did not move; only leading capacity trimming
      // shifts a reading position that survives above the insertion.
      buffer.ydisp = Math.max(0, oldYdisp - trimLineCount);
    }

    if (trimPlan !== undefined) {
      this.#dropLeadingEntries(trimPlan.entryCount);
    }
    if (boundaryEntry !== undefined && this.#entryIndexes.has(boundaryEntry.id)) {
      boundaryEntry.endMarker.dispose();
      boundaryEntry.endMarker = buffer.addMarker(regionTop - trimLineCount);
    }
    const start = regionTop - trimLineCount;
    if (start < 0) {
      throw new Error("The appended Block was trimmed before it could be indexed.");
    }
    const startMarker = buffer.addMarker(start);
    const endMarker = buffer.addMarker(start + delta);
    this.#entryIndexes.set(block.id, this.#entries.length);
    this.#entries.push({ id: block.id, startMarker, endMarker });

    this.#region?.shift(delta - trimLineCount);
    this.#bufferService._onScroll.fire(buffer.ydisp);
  }

  #appendWouldExceedCapacity(block: Block): boolean {
    const layout = conservativeTextLineCount(
      block.content, this.#terminal.cols, this.#terminal.options.tabStopWidth,
    );
    if (layout === undefined) {
      return true;
    }

    const buffer = this.#bufferService.buffer;
    const lines = buffer.lines;
    const cursorLine = buffer.ybase + buffer.y;

    if (this.#region?.topRow() !== undefined) {
      // Region mode inserts above the region top rather than at the cursor,
      // so the projection starts from the physical row count, not the cursor
      // line. No trim is scheduled: an over-capacity region Append rejects
      // conservatively with resource_exhausted.
      if (this.#acceptedRenderCount === 0) {
        return (
          Math.max(this.#terminal.rows, lines.length + layout.count) >
          lines.maxLength
        );
      }
      let plannedRegionLineCount = layout.count;
      for (const candidate of this.#plannedModel.blocks()) {
        if (this.#plannedTrimmedBlockIds.has(candidate.id)) {
          continue;
        }
        const candidateLayout = conservativeTextLineCount(
          candidate.content,
          this.#terminal.cols,
          this.#terminal.options.tabStopWidth,
        );
        if (candidateLayout === undefined) {
          return true;
        }
        plannedRegionLineCount += candidateLayout.count;
      }
      let renderedRegionLineCount = 0;
      for (const entry of this.#entries) {
        const range = this.range(entry.id);
        if (range === undefined) {
          return true;
        }
        renderedRegionLineCount += range.lineCount;
      }
      return (
        Math.max(
          this.#terminal.rows,
          lines.length + plannedRegionLineCount - renderedRegionLineCount,
        ) > lines.maxLength
      );
    }

    const boundaryLineCount =
      (lines.get(cursorLine)?.translateToString(true).length ?? 0) > 0 ? 1 : 0;
    if (this.#acceptedRenderCount > 0) {
      let plannedLineCount = layout.count;
      for (const candidate of this.#plannedModel.blocks()) {
        if (this.#plannedTrimmedBlockIds.has(candidate.id)) {
          continue;
        }
        const candidateLayout = conservativeTextLineCount(
          candidate.content,
          this.#terminal.cols,
          this.#terminal.options.tabStopWidth,
        );
        if (candidateLayout === undefined) {
          return true;
        }
        plannedLineCount += candidateLayout.count;
      }
      let renderedLineCount = 0;
      for (const entry of this.#entries) {
        const range = this.range(entry.id);
        if (range === undefined) {
          return true;
        }
        renderedLineCount += range.lineCount;
      }
      const projectedLineCount = Math.max(
        this.#terminal.rows,
        lines.length,
        cursorLine +
          boundaryLineCount +
          plannedLineCount -
          renderedLineCount +
          1,
      );
      return projectedLineCount > lines.maxLength;
    }

    const projectedLineCount = Math.max(
      this.#terminal.rows,
      cursorLine + boundaryLineCount + layout.count + 1,
    );
    const excess = projectedLineCount - lines.maxLength;
    if (excess <= 0) {
      return false;
    }
    if (!layout.exact || !this.#hasDedicatedManagedAppendLayout(cursorLine)) {
      return true;
    }

    const trimPlan = this.#capacityTrimPlan(excess, block.id);
    if (trimPlan === undefined) {
      return true;
    }
    for (const id of trimPlan.blockIds) {
      this.#plannedTrimmedBlockIds.add(id);
    }
    this.#plannedAppendTrims.set(block.id, trimPlan);
    return false;
  }

  #hasDedicatedManagedAppendLayout(cursorLine: number): boolean {
    let expectedStart = 0;
    for (const entry of this.#entries) {
      const range = this.range(entry.id);
      if (range === undefined || range.start !== expectedStart) {
        return false;
      }
      expectedStart = range.start + range.lineCount;
    }

    const cursor = this.#bufferService.buffer.lines.get(cursorLine);
    return (
      expectedStart === cursorLine &&
      this.#bufferService.buffer.x === 0 &&
      cursor?.translateToString(true).length === 0
    );
  }

  async #update(
    id: BlockId,
    content: string,
    targetAnchorMapping: TargetAnchorMapping = "replacementStart",
  ): Promise<void> {
    const replacement = await this.#materialize(content);
    const entryIndex = this.#entryIndexes.get(id);
    if (entryIndex === undefined) {
      throw new Error(`Block ${JSON.stringify(id)} has no xterm.js line range.`);
    }
    const entry = this.#entries[entryIndex];
    const range = this.#rangeAt(entryIndex);
    const previousEntry = this.#entries[entryIndex - 1];
    const previousEndSharesStart =
      previousEntry !== undefined &&
      !previousEntry.endMarker.isDisposed &&
      previousEntry.endMarker.line === range.start;

    const buffer = this.#bufferService.buffer;
    const oldEnd = range.start + range.lineCount;
    const oldYbase = buffer.ybase;
    const oldYdisp = buffer.ydisp;
    const wasFollowingTail = oldYdisp === oldYbase;
    const regionTop = this.#region?.topRow();
    const editAboveRegion = regionTop !== undefined && oldEnd <= regionTop;
    if (regionTop !== undefined && !editAboveRegion) {
      // The estimate contradicts a managed Block range; drop it rather than
      // compensate the cursor against rows the application may not own.
      this.#region?.reset();
    }
    const targetAnchorOffset =
      !wasFollowingTail && oldYdisp >= range.start && oldYdisp < oldEnd
        ? oldYdisp - range.start
        : undefined;
    const mappedTargetAnchorOffset =
      targetAnchorOffset === undefined
        ? undefined
        : mapTargetAnchor(targetAnchorOffset, targetAnchorMapping);

    const delta = replacement.length - range.lineCount;
    const trimLineCount = Math.max(
      0,
      buffer.lines.length + delta - buffer.lines.maxLength,
    );
    const trimPlan =
      trimLineCount === 0
        ? undefined
        : this.#capacityTrimPlan(
            trimLineCount,
            id,
            Number.POSITIVE_INFINITY,
          );
    if (trimLineCount > 0 && trimPlan === undefined) {
      throw new Error(
        "This spike cannot safely trim the required scrollback rows.",
      );
    }

    this.#model.apply({ type: "update", id, content });

    buffer.lines.splice(range.start, range.lineCount, ...replacement);
    if (editAboveRegion && delta > trimLineCount) {
      // Region mode: growth above the app region first consumes the blank
      // viewport rows below the cursor; only the excess scrolls the
      // viewport, so the region keeps its screen rows while it can.
      buffer.ybase =
        oldYbase +
        Math.max(
          0,
          delta -
            trimLineCount -
            trailingBlankViewportRows(
              buffer,
              oldYbase + buffer.y,
              this.#terminal.rows,
            ),
        );
    } else {
      buffer.ybase = Math.max(0, oldYbase + delta - trimLineCount);
    }
    // When shrinking consumes all scrollback, the native cursor must move
    // upward with the following content rather than retain its old screen row.
    buffer.y = Math.max(0, Math.min(
      this.#terminal.rows - 1,
      buffer.y + oldYbase + delta - trimLineCount - buffer.ybase,
    ));
    // xterm requires a complete active screen even when retained content is short.
    while (buffer.lines.length < this.#terminal.rows) {
      buffer.lines.splice(buffer.lines.length, 0, buffer.getBlankLine());
    }

    if (wasFollowingTail) {
      buffer.ydisp = buffer.ybase;
    } else if (mappedTargetAnchorOffset !== undefined) {
      buffer.ydisp = Math.min(
        buffer.ybase,
        Math.max(0, range.start + mappedTargetAnchorOffset - trimLineCount),
      );
    } else if (oldYdisp >= oldEnd) {
      buffer.ydisp = Math.max(0, oldYdisp + delta - trimLineCount);
    } else {
      // If capacity trimming removes this reading position, zero is the
      // nearest later retained row. Otherwise the same subtraction preserves
      // the surviving position after leading rows move out of history.
      buffer.ydisp = Math.max(0, oldYdisp - trimLineCount);
    }

    entry.startMarker.dispose();
    entry.endMarker.dispose();
    if (previousEndSharesStart) {
      previousEntry.endMarker.dispose();
    }
    const updatedStart = range.start - trimLineCount;
    entry.startMarker = buffer.addMarker(updatedStart);
    entry.endMarker = buffer.addMarker(updatedStart + replacement.length);
    const trimmedEntryCount = trimPlan?.entryCount ?? 0;
    if (previousEndSharesStart && entryIndex - 1 >= trimmedEntryCount) {
      previousEntry.endMarker = buffer.addMarker(updatedStart);
    }
    if (trimPlan !== undefined) {
      this.#dropLeadingEntries(trimPlan.entryCount);
    }
    if (editAboveRegion) {
      this.#region?.shift(delta - trimLineCount);
    }

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
    const retainedBoundaryRow = Math.max(
      0,
      retainedLines.length - (endsWithLogicalNewline(retainedPrefix) ? 0 : 1),
    );
    await this.#update(
      id,
      `${retainedPrefix}${replacement}`,
      { retainedBoundaryRow },
    );
  }

  #capacityTrimPlan(
    lineCount: number,
    targetId: BlockId,
    acceptedRenderLimit = 0,
  ): CapacityTrimPlan | undefined {
    if (this.#acceptedRenderCount > acceptedRenderLimit || lineCount <= 0) {
      return undefined;
    }

    let accumulated = 0;
    let expectedStart = 0;
    for (const [index, entry] of this.#entries.entries()) {
      if (entry.id === targetId) {
        return undefined;
      }
      const range = this.range(entry.id);
      if (range === undefined) {
        return undefined;
      }
      if (range.start !== expectedStart) {
        return undefined;
      }
      accumulated += range.lineCount;
      expectedStart = range.start + range.lineCount;
      if (accumulated === lineCount) {
        return {
          entryCount: index + 1,
          blockIds: this.#entries
            .slice(0, index + 1)
            .map((candidate) => candidate.id),
        };
      }
      if (accumulated > lineCount) {
        return undefined;
      }
    }
    return undefined;
  }

  #dropLeadingEntries(count: number): void {
    const removed = this.#entries.splice(0, count);
    for (const entry of removed) {
      entry.startMarker.dispose();
      entry.endMarker.dispose();
      this.#plannedTrimmedBlockIds.add(entry.id);
      this.#damagedBlockIds.delete(entry.id);
    }
    this.#rebuildEntryIndexes();
  }

  #rebuildEntryIndexes(): void {
    this.#entryIndexes.clear();
    for (const [index, entry] of this.#entries.entries()) {
      this.#entryIndexes.set(entry.id, index);
    }
  }

  #rangeAt(index: number): BlockRange {
    const entry = this.#entries[index];
    if (entry.startMarker.isDisposed || entry.endMarker.isDisposed) {
      throw new Error(`Block ${JSON.stringify(entry.id)} was trimmed from xterm.js.`);
    }
    if (entry.endMarker.line <= entry.startMarker.line) {
      throw new Error(`Block ${JSON.stringify(entry.id)} has an invalid xterm.js range.`);
    }
    return {
      start: entry.startMarker.line,
      lineCount: entry.endMarker.line - entry.startMarker.line,
    };
  }

  async #materialize(content: string): Promise<PrivateBufferLine[]> {
    const scratch = new HeadlessTerminal({
      cols: this.#terminal.cols,
      rows: 1,
      scrollback: 10_000,
    });
    try {
      await write(scratch, toTerminalText(content, this.#terminal.options.tabStopWidth));
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

function toTerminalText(content: string, tabWidth?: number): string {
  const normalized = projectPlainText(content, tabWidth).text;
  const projected = normalized.replaceAll("\n", "\r\n");
  return normalized.endsWith("\n") ? projected : `${projected}\r\n`;
}

function appendBoundary(buffer: PrivateBuffer): string {
  const cursorLine = buffer.lines.get(buffer.ybase + buffer.y);
  const currentLineHasText =
    (cursorLine?.translateToString(true).length ?? 0) > 0;
  if (currentLineHasText) {
    return "\r\n";
  }
  return buffer.x === 0 ? "" : "\r";
}

/**
 * Counts blank rows between the cursor row and the viewport bottom. Growth
 * above the app region consumes these rows before any viewport row scrolls
 * into scrollback. Scanning is required because the region may not reach the
 * last screen row (blank tail) and may extend below the cursor (a footer).
 */
function trailingBlankViewportRows(
  buffer: PrivateBuffer,
  cursorLine: number,
  rows: number,
): number {
  let blank = 0;
  const viewportBottom = Math.min(buffer.ybase + rows, buffer.lines.length);
  for (let index = viewportBottom - 1; index > cursorLine; index -= 1) {
    const text = buffer.lines.get(index)?.translateToString(true);
    if (text !== undefined && text.length > 0) {
      break;
    }
    blank += 1;
  }
  return blank;
}

function endsWithLogicalNewline(content: string): boolean {
  return content.endsWith("\n") || content.endsWith("\r");
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

/**
 * Uses the pinned fixture's ASCII/basic-CJK widths for exact row estimates.
 * Other printable scalars retain the experimental two-cell upper estimate;
 * an inexact estimate cannot authorize capacity eviction.
 */
function conservativeTextLineCount(
  content: string,
  width: number,
  tabWidth?: number,
): TextLineCount | undefined {
  const projection = projectPlainText(content, tabWidth);
  if (!projection.mappable && projection.tabs.length > 0) return undefined;
  const normalized = projection.text;
  const logicalLines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    logicalLines.pop();
  }

  let total = 0;
  let exact = true;

  for (const line of logicalLines) {
    let rows = 1;
    let column = 0;
    for (const character of line) {
      const codePoint = character.codePointAt(0);
      if (
        codePoint === undefined ||
        codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return undefined;
      }
      const knownWidth = fixtureCellWidth(character);
      const cellWidth = knownWidth ?? 2;
      exact &&= knownWidth !== undefined;
      if (cellWidth > width) {
        return undefined;
      }
      if (column + cellWidth > width) {
        rows += 1;
        column = 0;
      }
      column += cellWidth;
    }
    total += rows;
  }

  return { count: total, exact };
}

function mapTargetAnchor(
  rowOffset: number,
  mapping: TargetAnchorMapping,
): number {
  if (mapping === "replacementStart") {
    // Complete Update has no old-to-new position mapping. This is a local
    // viewport policy, not a protocol requirement to jump to the Block start.
    return 0;
  }
  if (mapping === "preserve") {
    return rowOffset;
  }
  return Math.min(rowOffset, mapping.retainedBoundaryRow);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Operation: ${JSON.stringify(value)}`);
}
