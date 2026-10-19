import type { StyledTextSpan, StyledTextStyle } from "@tui-protocol/protocol";

/** One `text/lines` line as proposed by RFC 0003; experimental, not a wire type yet. */
export interface LayoutLine {
  /** The line's styled text; span text contains no line break characters. */
  readonly spans: readonly StyledTextSpan[];
  /** Break at spaces and between wide characters (default), or between cells. */
  readonly wrap?: "word" | "char";
  /** Shown at the start of every soft-wrapped row; presentation, not logical text. */
  readonly continuation?: readonly StyledTextSpan[];
  /** When set, `spans` is one span of one grapheme repeated across the width. */
  readonly fill?: true;
}

/** One display row produced by laying out a line at a width. */
export interface LayoutRow {
  /** Index of the source line. */
  readonly line: number;
  /** True for a row created by soft wrapping; its prefix is the continuation. */
  readonly soft: boolean;
  /** Displayed cells, prefix first, merged into styled spans; trailing spaces trimmed. */
  readonly spans: readonly StyledTextSpan[];
  /** Cells occupied by the continuation prefix at the row start. */
  readonly prefixCells: number;
  /** Logical scalar offsets within the line of the first and past-the-last displayed text unit. */
  readonly start: number;
  readonly end: number;
}

interface Unit {
  readonly text: string;
  readonly cells: number;
  readonly style?: StyledTextStyle;
  /** Logical scalar offset within the line. */
  readonly offset: number;
  readonly space: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Lays out every line at `cols`; a pure function of the content and the width. */
export function layoutLines(lines: readonly LayoutLine[], cols: number): LayoutRow[] {
  if (!Number.isInteger(cols) || cols < 1) throw new Error("cols must be a positive integer.");
  return lines.flatMap((line, index) => layoutLine(line, index, cols));
}

/** Plain text of one row, as a terminal would show it. */
export function rowText(row: LayoutRow): string {
  return row.spans.map(span => span.text).join("");
}

function layoutLine(line: LayoutLine, index: number, cols: number): LayoutRow[] {
  const units = unitsOf(line.spans);
  if (line.fill) {
    const unit = units[0];
    if (unit === undefined || units.length !== 1) throw new Error("A fill line carries exactly one grapheme.");
    const count = Math.max(1, Math.floor(cols / unit.cells));
    return [{ line: index, soft: false, spans: merge(Array(count).fill(unit)), prefixCells: 0, start: 0, end: 1 }];
  }
  const prefix = unitsOf(line.continuation ?? []);
  const prefixCells = cellsOf(prefix);
  // A prefix that leaves no width is omitted for the row.
  const continuationFits = prefixCells > 0 && prefixCells < cols;
  const rowsUnits: Unit[][] = [];
  let row: Unit[] = [];
  const available = () => (rowsUnits.length > 0 && continuationFits ? cols - prefixCells : cols);
  const flush = () => {
    while (row.length > 0 && row.at(-1)!.space) row.pop();
    rowsUnits.push(row);
    row = [];
  };
  for (const token of tokens(units, line.wrap ?? "word")) {
    const width = cellsOf(token);
    const space = token[0]!.space;
    if (cellsOf(row) + width <= available()) {
      row.push(...token);
      continue;
    }
    if (space) {
      // Whitespace at a break is dropped: it stays logical text but is not displayed.
      if (row.length > 0) flush();
      continue;
    }
    if (row.length > 0) flush();
    if (width <= available()) {
      row.push(...token);
      continue;
    }
    // A word wider than a row breaks between cells.
    for (const unit of token) {
      if (cellsOf(row) + unit.cells > available() && row.length > 0) flush();
      row.push(unit);
    }
  }
  if (row.length > 0 || rowsUnits.length === 0) flush();
  return rowsUnits.map((units, rowIndex) => {
    const soft = rowIndex > 0;
    const shownPrefix = soft && continuationFits ? prefix : [];
    const start = units[0]?.offset ?? (rowsUnits[rowIndex - 1]?.at(-1)?.offset ?? 0);
    const last = units.at(-1);
    const end = last === undefined ? start : last.offset + [...last.text].length;
    return { line: index, soft, spans: merge([...shownPrefix, ...units]), prefixCells: cellsOf(shownPrefix), start, end };
  });
}

/** Word mode: runs of spaces, and words split between adjacent wide characters. Char mode: single units. */
function tokens(units: readonly Unit[], wrap: "word" | "char"): Unit[][] {
  if (wrap === "char") return units.map(unit => [unit]);
  const result: Unit[][] = [];
  for (const unit of units) {
    const current = result.at(-1);
    const previous = current?.at(-1);
    const joins = previous !== undefined && previous.space === unit.space &&
      (unit.space || !(previous.cells === 2 && unit.cells === 2));
    if (joins) current!.push(unit);
    else result.push([unit]);
  }
  return result;
}

function unitsOf(spans: readonly StyledTextSpan[]): Unit[] {
  const units: Unit[] = [];
  let offset = 0;
  for (const span of spans) {
    for (const { segment } of graphemes.segment(span.text)) {
      units.push({ text: segment, cells: cellWidth(segment), style: span.style, offset, space: segment === " " });
      offset += [...segment].length;
    }
  }
  return units;
}

function cellsOf(units: readonly Unit[]): number {
  return units.reduce((total, unit) => total + unit.cells, 0);
}

function merge(units: readonly Unit[]): StyledTextSpan[] {
  const spans: { text: string; style?: StyledTextStyle }[] = [];
  for (const unit of units) {
    const last = spans.at(-1);
    if (last !== undefined && JSON.stringify(last.style) === JSON.stringify(unit.style)) last.text += unit.text;
    else spans.push(unit.style === undefined ? { text: unit.text } : { text: unit.text, style: unit.style });
  }
  return spans;
}

/**
 * Experimental cell width: two cells for East Asian wide and fullwidth ranges
 * and common emoji, one otherwise. Not a complete Unicode width table.
 */
export function cellWidth(grapheme: string): number {
  const code = grapheme.codePointAt(0)!;
  const wide =
    (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd);
  return wide ? 2 : 1;
}
