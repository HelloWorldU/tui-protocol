/** Terminal-side projection fixture, not a prescribed protocol spelling. */
export interface TabSpan {
  readonly start: number;
  readonly end: number;
}

export interface PlainTextProjection {
  readonly text: string;
  readonly tabs: readonly TabSpan[];
  readonly ascii: boolean;
  readonly mappable: boolean;
}

/** Narrow fixture matching the pinned xterm default provider, not a Unicode width table. */
export function fixtureCellWidth(char: string): 1 | 2 | undefined {
  if (char.length !== 1) return undefined;
  const code = char.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) return 1;
  if (code >= 0x4e00 && code <= 0x9fff) return 2;
  return undefined;
}

/**
 * This host uses ASCII <U+XXXX> labels and logical-line tab stops. Keeping
 * expansion independent of viewport width lets xterm reflow the same text.
 * Width mapping is restricted to ASCII and basic CJK ideographs U+4E00..9FFF.
 * Other Unicode is passed through, but cannot be mapped or combined with Tabs.
 */
export function projectPlainText(content: string, tabWidth = 8): PlainTextProjection {
  if (!Number.isSafeInteger(tabWidth) || tabWidth <= 0) {
    throw new Error("Tab width must be a positive safe integer.");
  }
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let text = "";
  let column = 0;
  let ascii = true;
  let mappable = true;
  const tabs: TabSpan[] = [];
  for (const char of normalized) {
    const code = char.codePointAt(0)!;
    if (char === "\n") {
      text += "\n";
      column = 0;
    } else if (char === "\t") {
      const start = text.length;
      const spaces = tabWidth - column % tabWidth;
      text += " ".repeat(spaces);
      column += spaces;
      tabs.push({ start, end: text.length });
    } else {
      const visible = code < 0x20 || (code >= 0x7f && code <= 0x9f)
        ? `<U+${code.toString(16).toUpperCase().padStart(4, "0")}>`
        : char;
      text += visible;
      const width = visible === char ? fixtureCellWidth(char) : visible.length;
      column += width ?? visible.length;
      mappable &&= width !== undefined;
      ascii &&= /^[\x20-\x7e]+$/.test(visible);
    }
  }
  return { text, tabs, ascii, mappable };
}

/** Length of the displayed prefix whose source scalars are all retained. */
export function retainedPlainTextLength(
  content: string, retain: number, tabWidth = 8,
): number {
  const scalars = Array.from(content);
  // A displayed CRLF spans two raw scalars. Retaining only CR does not retain
  // the entire source of that displayed break, even if CR still displays LF.
  const completeRetain = scalars[retain - 1] === "\r" && scalars[retain] === "\n"
    ? retain - 1
    : retain;
  return projectPlainText(scalars.slice(0, completeRetain).join(""), tabWidth).text.length;
}

/** Projected string offsets include LF, but exclude soft wraps and wide-wrap padding. */
export function textPosition(
  text: string, offset: number, cols: number, edge: "start" | "end" = "start",
): {
  row: number; column: number;
} {
  let row = 0;
  let column = 0;
  for (const char of text.slice(0, offset)) {
    if (char === "\n") {
      row++;
      column = 0;
    } else {
      const width = requiredCellWidth(char);
      if (column + width > cols) {
        row++;
        column = 0;
      }
      column += width;
    }
  }
  // Starts attach to the next glyph; ends stay after the previous glyph.
  // They differ when xterm leaves a padding cell before a wrapped wide glyph.
  if (edge === "start" && offset < text.length && text[offset] !== "\n" &&
      column + requiredCellWidth(text[offset]) > cols) {
    return { row: row + 1, column: 0 };
  }
  return { row, column };
}

export function textOffset(
  text: string, row: number, column: number, cols: number,
  edge: "start" | "end" = "start",
): number | undefined {
  let currentRow = 0;
  let currentColumn = 0;
  for (let offset = 0; offset <= text.length; offset++) {
    if (currentRow === row && currentColumn === column) return offset;
    const char = text[offset];
    if (char === undefined) break;
    const width = char === "\n" ? 0 : requiredCellWidth(char);
    if (char !== "\n" && currentColumn + width > cols) {
      // The unused last cell before a wide glyph is not content.
      if (currentRow === row && column >= currentColumn && column <= cols) return offset;
      currentRow++;
      currentColumn = 0;
      if (currentRow === row && column === 0) return offset;
    }
    if (char === "\n") {
      currentRow++;
      currentColumn = 0;
    } else {
      if (currentRow === row && column > currentColumn && column < currentColumn + width) {
        return edge === "start" ? offset : offset + 1;
      }
      currentColumn += width;
    }
  }
  return undefined;
}

function requiredCellWidth(char: string): number {
  const width = fixtureCellWidth(char);
  if (width === undefined) throw new Error("Text is outside the fixture's mapped character range.");
  return width;
}
