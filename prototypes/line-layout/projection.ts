import type { LayoutLine, LayoutRow } from "./layout.ts";

/** A display position: row index within the Block's rows, and cell column. */
export interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/**
 * Maps between a Block's display rows and its logical text: line texts joined
 * by LF, counted in Unicode scalars. Continuation prefixes have no logical
 * position, and spaces dropped at a soft break lie between two rows.
 */
export class LinesProjection {
  readonly #rows: readonly LayoutRow[];
  readonly #bases: number[] = [];
  readonly #text: string[];

  constructor(lines: readonly LayoutLine[], rows: readonly LayoutRow[]) {
    this.#rows = rows;
    let base = 0;
    const scalars: string[] = [];
    for (const [index, line] of lines.entries()) {
      if (index > 0) { scalars.push("\n"); base += 1; }
      this.#bases.push(base);
      const text = Array.from(line.spans.map(span => span.text).join(""));
      scalars.push(...text);
      base += text.length;
    }
    this.#text = scalars;
  }

  /** The logical offset a cell boundary stands for: prefix cells map to the row's text start. */
  offsetAt(position: CellPosition): number {
    const row = this.#rows[position.row];
    if (row === undefined) return this.#text.length;
    const base = this.#bases[row.line]!;
    const index = position.col - row.prefixCells;
    if (index <= 0) return base + row.start;
    if (index >= row.columns.length) return base + row.end;
    return base + row.columns[index]!;
  }

  /** Copy of the cells from `from` (inclusive) to `to` (exclusive): the logical text between them. */
  copy(from: CellPosition, to: CellPosition): string {
    return this.#text.slice(this.offsetAt(from), this.offsetAt(to)).join("");
  }

  /** The cell where a logical offset is displayed, for selecting a search match. */
  positionOf(offset: number): CellPosition {
    for (const [index, row] of this.#rows.entries()) {
      const base = this.#bases[row.line]!;
      if (offset < base + row.start) continue;
      const column = row.columns.findIndex(value => base + value >= offset);
      if (column >= 0 && base + row.columns[column]! === offset) return { row: index, col: row.prefixCells + column };
      if (offset < base + row.end) continue;
      const next = this.#rows[index + 1];
      // An offset in spaces dropped at a soft break shows at the next row's text start.
      if (next !== undefined && next.line === row.line && offset < base + next.start) {
        return { row: index + 1, col: next.prefixCells };
      }
      if (offset === base + row.end && (next === undefined || next.line !== row.line)) {
        return { row: index, col: row.prefixCells + row.columns.length };
      }
    }
    return { row: this.#rows.length, col: 0 };
  }

  /** Logical offsets of every occurrence of `term`, which may cross soft breaks but never prefixes. */
  find(term: string): number[] {
    const text = this.#text.join("");
    const matches: number[] = [];
    for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + 1)) {
      matches.push(Array.from(text.slice(0, index)).length);
    }
    return matches;
  }
}
