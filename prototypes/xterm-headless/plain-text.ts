/** Terminal-side projection fixture, not a prescribed protocol spelling. */
export interface TabSpan {
  readonly start: number;
  readonly end: number;
}

export interface PlainTextProjection {
  readonly text: string;
  readonly tabs: readonly TabSpan[];
  readonly ascii: boolean;
}

/**
 * This host uses ASCII <U+XXXX> labels and logical-line tab stops. Keeping
 * expansion independent of viewport width lets xterm reflow the same text.
 * Tabs alongside non-ASCII glyphs need a real width provider and are not
 * supported by this fixture's preflight or coordinate mapping.
 */
export function projectPlainText(content: string, tabWidth = 8): PlainTextProjection {
  if (!Number.isSafeInteger(tabWidth) || tabWidth <= 0) {
    throw new Error("Tab width must be a positive safe integer.");
  }
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let text = "";
  let column = 0;
  let ascii = true;
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
      column += visible.length;
      ascii &&= /^[\x20-\x7e]+$/.test(visible);
    }
  }
  return { text, tabs, ascii };
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

/** ASCII projection offsets include logical LF but exclude soft wraps. */
export function textPosition(text: string, offset: number, cols: number): {
  row: number; column: number;
} {
  let row = 0;
  let column = 0;
  for (const char of text.slice(0, offset)) {
    if (char === "\n") {
      row++;
      column = 0;
    } else {
      if (column === cols) {
        row++;
        column = 0;
      }
      column++;
    }
  }
  // A boundary before another printable cell belongs to the continued row.
  // At the actual tail (or before LF), keep xterm's delayed-wrap position.
  if (column === cols && offset < text.length && text[offset] !== "\n") {
    return { row: row + 1, column: 0 };
  }
  return { row, column };
}

export function textOffset(
  text: string, row: number, column: number, cols: number,
): number | undefined {
  let currentRow = 0;
  let currentColumn = 0;
  for (let offset = 0; offset <= text.length; offset++) {
    if (currentRow === row && currentColumn === column) return offset;
    const char = text[offset];
    if (char === undefined) break;
    if (char !== "\n" && currentColumn === cols) {
      currentRow++;
      currentColumn = 0;
      if (currentRow === row && column === 0) return offset;
    }
    if (char === "\n") {
      currentRow++;
      currentColumn = 0;
    } else {
      currentColumn++;
    }
  }
  return undefined;
}
