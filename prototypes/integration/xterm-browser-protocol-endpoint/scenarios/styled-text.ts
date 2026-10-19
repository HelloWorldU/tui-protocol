import type { Terminal } from "@xterm/xterm";

import type { StyledTextSpan } from "@tui-protocol/protocol";
import {
  append,
  assertEqual,
  assertTrue,
  copySelection,
  createFixture,
  extend,
  pushMessages,
  replaceSuffix,
  requiredRange,
  seal,
  selectAcrossRows,
  update,
  type Fixture,
} from "../scenario-harness.ts";
import type { ScenarioResult } from "../scenario-harness.ts";

const styled = { optionalContentTypes: ["text/styled"] } as const;

export async function runStyledAppendPaintsAttributesInDomScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 60, rows: 4, ...styled });
  try {
    const spans: StyledTextSpan[] = [
      { text: "plain " },
      { text: "bold ", style: { bold: true } },
      { text: "faint ", style: { faint: true } },
      { text: "ital ", style: { italic: true } },
      { text: "und ", style: { underline: true } },
      { text: "strike ", style: { strikethrough: true } },
      { text: "pal ", style: { foreground: { palette: 196 } } },
      { text: "bg ", style: { background: { palette: 4 } } },
      { text: "rgb ", style: { foreground: { rgb: [12, 34, 56] } } },
      { text: "inv", style: { foreground: { palette: 2 }, inverse: true } },
    ];
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", spans, "mutable")]);
    await fixture.endpoint.drain();
    await painted();
    const row = requiredRange(fixture, "text").start;
    const at = columns(spans);

    assertEqual(classesAt(fixture.terminal, row, at("plain ")).filter(isStyleClass).join(" "), "", "unstyled cells carry no style class");
    assertClass(fixture.terminal, row, at("bold "), "xterm-bold", "bold");
    assertClass(fixture.terminal, row, at("faint "), "xterm-dim", "faint");
    assertClass(fixture.terminal, row, at("ital "), "xterm-italic", "italic");
    assertTrue(classesAt(fixture.terminal, row, at("und ")).some(name => name.startsWith("xterm-underline-")), "underline class");
    assertClass(fixture.terminal, row, at("strike "), "xterm-strikethrough", "strikethrough");
    assertClass(fixture.terminal, row, at("pal "), "xterm-fg-196", "palette foreground");
    assertClass(fixture.terminal, row, at("bg "), "xterm-bg-4", "palette background");
    assertEqual(getComputedStyle(cellElement(fixture.terminal, row, at("rgb "))).color, "rgb(12, 34, 56)", "RGB foreground paint");
    // Inverse swaps the palette foreground into the painted background.
    assertClass(fixture.terminal, row, at("inv"), "xterm-bg-2", "inverse");
    assertEqual(fixture.terminal.buffer.active.getLine(row)?.translateToString(true), logical(spans), "native row text is the logical text");
    return {
      name: "Styled Append Paints Attributes in the DOM Renderer",
      detail: "every emphasis, palette, RGB, and inverse span painted with its xterm DOM class or color; unstyled text stayed default",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runStyledCopyAndSearchUseLogicalTextScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 40, rows: 6, ...styled });
  try {
    const spans: StyledTextSpan[] = [
      { text: "Result: ", style: { bold: true } },
      { text: "mutable ", style: { italic: true } },
      { text: "his", style: { foreground: { palette: 3 } } },
      { text: "tory\n", style: { underline: true } },
      { text: "keeps\told output" },
    ];
    pushMessages(fixture.endpoint, [append(fixture.contextId, "1", "text", spans, "sealed")]);
    await fixture.endpoint.drain();
    const range = requiredRange(fixture, "text");
    selectAcrossRows(fixture.terminal, 0, range.start, 18, range.start + 1);
    assertEqual(copySelection(fixture.terminal), logical(spans), "copy yields the logical text with LF and Tab, no styling");
    // Search continues after the current selection; start from the top.
    fixture.terminal.clearSelection();
    assertEqual(fixture.endpoint.findNext("t: mut"), true, "search matches across bold and italic spans");
    assertEqual(fixture.endpoint.findNext("history"), true, "search matches across a color and underline span boundary");
    assertEqual(fixture.terminal.getSelection(), "history", "the match covers both spans");
    assertEqual(fixture.endpoint.findNext("\x1b[1m"), false, "no styling sequence is searchable text");
    return {
      name: "Styled Copy and Search Use the Logical Text",
      detail: "copy produced the unstyled logical text including LF and Tab, and search matched across span boundaries",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runStyledIncrementalEditsKeepSelectionAndStylesScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 40, rows: 6, ...styled });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "text", [
        { text: "keep ", style: { bold: true } },
        { text: "draft", style: { foreground: { palette: 5 } } },
      ], "mutable"),
    ]);
    await fixture.endpoint.drain();
    const row = requiredRange(fixture, "text").start;
    fixture.terminal.select(0, row, 4);
    assertEqual(copySelection(fixture.terminal), "keep", "initial bold prefix copy");

    pushMessages(fixture.endpoint, [extend(fixture.contextId, "2", "text", "1", [{ text: " more", style: { italic: true } }])]);
    await fixture.endpoint.drain();
    await painted();
    assertEqual(copySelection(fixture.terminal), "keep", "Extend keeps the selected bold prefix");
    assertClass(fixture.terminal, row, 11, "xterm-italic", "extended fragment style");

    // Retain 7 scalars: "keep " plus "dr", cutting the palette span mid-way.
    pushMessages(fixture.endpoint, [replaceSuffix(fixture.contextId, "3", "text", "2", 7, [{ text: "aft!", style: { underline: true } }])]);
    await fixture.endpoint.drain();
    await painted();
    assertEqual(fixture.terminal.buffer.active.getLine(row)?.translateToString(true), "keep draft!", "native row after mid-span ReplaceSuffix");
    assertEqual(copySelection(fixture.terminal), "keep", "ReplaceSuffix keeps the selected retained prefix");
    assertClass(fixture.terminal, row, 6, "xterm-fg-5", "the truncated span keeps its color");
    assertTrue(!classesAt(fixture.terminal, row, 7).includes("xterm-fg-5"), "the replacement does not inherit the truncated color");
    assertTrue(classesAt(fixture.terminal, row, 7).some(name => name.startsWith("xterm-underline-")), "the replacement carries its own style");
    assertTrue(!classesAt(fixture.terminal, row, 10).includes("xterm-italic"), "the removed italic suffix left no paint");
    assertEqual(fixture.endpoint.findNext("draft!"), true, "the edited text is searchable across retained and replacement spans");

    pushMessages(fixture.endpoint, [seal(fixture.contextId, "4", "text")]);
    await fixture.endpoint.drain();
    await painted();
    assertClass(fixture.terminal, row, 0, "xterm-bold", "Seal leaves the painted styles");
    return {
      name: "Styled Extend and Mid-Span ReplaceSuffix Keep Selection and Paint",
      detail: "a selected bold prefix survived Extend and ReplaceSuffix; the truncated span kept its color and the replacement painted its own style",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runStyledUpdateToPlainClearsPaintScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 30, rows: 4, ...styled });
  try {
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "text", [{ text: "styled text", style: { bold: true, foreground: { palette: 1 } } }], "mutable"),
    ]);
    await fixture.endpoint.drain();
    await painted();
    const row = requiredRange(fixture, "text").start;
    assertClass(fixture.terminal, row, 0, "xterm-bold", "styled before Update");
    pushMessages(fixture.endpoint, [update(fixture.contextId, "2", "text", "plain text")]);
    await fixture.endpoint.drain();
    await painted();
    assertEqual(classesAt(fixture.terminal, row, 0).filter(isStyleClass).join(" "), "", "Update to text/plain removes every painted style");
    assertEqual(blockType(fixture, "text"), "text/plain", "the Block switched content type");
    return {
      name: "Styled Update to Plain Text Clears the Paint",
      detail: "a full Update from text/styled to text/plain repainted the same rows with default attributes",
    };
  } finally {
    fixture.dispose();
  }
}

export async function runStyledResizeMovesStylesWithCharactersScenario(): Promise<ScenarioResult> {
  const fixture = createFixture({ cols: 20, rows: 4, ...styled });
  try {
    const earlier: StyledTextSpan[] = [
      { text: "0123456789", style: { foreground: { palette: 6 } } },
      { text: "BOLDTAIL", style: { bold: true } },
    ];
    pushMessages(fixture.endpoint, [
      append(fixture.contextId, "1", "earlier", earlier, "mutable"),
      append(fixture.contextId, "2", "reader", [{ text: "later", style: { italic: true } }], "sealed"),
      append(fixture.contextId, "3", "tail", "tail-1\ntail-2\ntail-3\ntail-4", "sealed"),
    ]);
    await fixture.endpoint.drain();
    const readerBefore = requiredRange(fixture, "reader");
    fixture.terminal.scrollToLine(readerBefore.start);
    fixture.terminal.select(0, readerBefore.start, 5);

    fixture.endpoint.resize(10, 4);
    await fixture.endpoint.drain();
    const earlierRow = requiredRange(fixture, "earlier").start;
    const readerAfter = requiredRange(fixture, "reader");
    assertTrue(readerAfter.start > readerBefore.start, "reader Block moved below the reflowed styled Block");
    assertEqual(fixture.terminal.buffer.active.viewportY, readerAfter.start, "reading row follows its Block");
    assertEqual(copySelection(fixture.terminal), "later", "styled selection survives reflow");
    fixture.terminal.scrollToLine(earlierRow);
    await painted();
    assertClass(fixture.terminal, earlierRow, 9, "xterm-fg-6", "palette span end stays on the first row");
    assertClass(fixture.terminal, earlierRow + 1, 0, "xterm-bold", "bold span moved to the wrapped row with its characters");
    assertTrue(!classesAt(fixture.terminal, earlierRow + 1, 0).includes("xterm-fg-6"), "the wrapped row does not inherit the palette color");

    fixture.endpoint.resize(20, 4);
    await fixture.endpoint.drain();
    fixture.terminal.scrollToLine(requiredRange(fixture, "earlier").start);
    await painted();
    const restored = requiredRange(fixture, "earlier").start;
    assertClass(fixture.terminal, restored, 10, "xterm-bold", "bold span returns beside the palette span after widening");
    assertEqual(fixture.terminal.buffer.active.getLine(restored)?.translateToString(true), "0123456789BOLDTAIL", "rows rejoin after widening");
    return {
      name: "Styled Resize Moves Styles With Their Characters",
      detail: "a 20/10/20 column round trip moved bold cells to and from the wrapped row while a styled reading anchor and selection stayed bound",
    };
  } finally {
    fixture.dispose();
  }
}

function painted(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function columns(spans: readonly StyledTextSpan[]): (text: string) => number {
  return (text: string) => {
    let column = 0;
    for (const span of spans) {
      if (span.text === text) return column;
      column += span.text.length;
    }
    throw new Error(`No span ${JSON.stringify(text)}.`);
  };
}

function logical(spans: readonly StyledTextSpan[]): string {
  return spans.map(span => span.text).join("");
}

function blockType(fixture: Fixture, blockId: string): string | undefined {
  return fixture.endpoint.context(fixture.contextId)?.blocks.find(block => block.id === blockId)?.content.type;
}

/** The DOM renderer element painting one cell of a visible buffer row (ASCII cells only). */
function cellElement(terminal: Terminal, bufferRow: number, column: number): HTMLElement {
  const viewportRow = bufferRow - terminal.buffer.active.viewportY;
  const rowElement = terminal.element?.querySelector(".xterm-rows")?.children[viewportRow];
  if (rowElement === undefined) throw new Error(`Buffer row ${bufferRow} is not in the viewport.`);
  let start = 0;
  for (const child of Array.from(rowElement.children) as HTMLElement[]) {
    const length = child.textContent?.length ?? 0;
    if (column < start + length) return child;
    start += length;
  }
  throw new Error(`No rendered element at row ${bufferRow}, column ${column}.`);
}

function classesAt(terminal: Terminal, bufferRow: number, column: number): string[] {
  return Array.from(cellElement(terminal, bufferRow, column).classList);
}

function assertClass(terminal: Terminal, bufferRow: number, column: number, name: string, label: string): void {
  const classes = classesAt(terminal, bufferRow, column);
  assertTrue(classes.includes(name), `${label}: expected ${name}, painted ${classes.join(" ") || "(none)"}`);
}

function isStyleClass(name: string): boolean {
  return /^xterm-(bold|dim|italic|strikethrough|underline-|fg-|bg-)/.test(name);
}
