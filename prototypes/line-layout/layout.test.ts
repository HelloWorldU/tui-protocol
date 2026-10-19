import assert from "node:assert/strict";
import test from "node:test";
import { layoutLines, rowText, type LayoutLine } from "./layout.ts";

const plain = (text: string, extra: Omit<LayoutLine, "spans"> = {}): LayoutLine => ({ spans: [{ text }], ...extra });
const texts = (lines: readonly LayoutLine[], cols: number) => layoutLines(lines, cols).map(rowText);

test("word wrap breaks at spaces and drops the space at each break", () => {
  assert.deepEqual(texts([plain("alpha beta gamma delta")], 11), ["alpha beta", "gamma delta"]);
  const rows = layoutLines([plain("alpha beta gamma delta")], 11);
  assert.deepEqual(rows.map(row => [row.start, row.end]), [[0, 10], [11, 22]], "the dropped space stays a logical offset between rows");
});

test("a word wider than the row starts a new row and then breaks between cells", () => {
  assert.deepEqual(texts([plain("ab abcdefghij k")], 6), ["ab", "abcdef", "ghij k"]);
});

test("a line that fits stays one row and trailing spaces are not displayed", () => {
  assert.deepEqual(texts([plain("short   ")], 20), ["short"]);
  assert.deepEqual(texts([plain("")], 20), [""], "an empty line is one empty row");
});

test("continuation prefixes appear only on soft-wrapped rows and narrow the available width", () => {
  const bullet = plain("- one two three four", { continuation: [{ text: "  " }] });
  assert.deepEqual(texts([bullet], 10), ["- one two", "  three", "  four"]);
  const rows = layoutLines([bullet], 10);
  assert.deepEqual(rows.map(row => [row.soft, row.prefixCells]), [[false, 0], [true, 2], [true, 2]]);
  const quote: LayoutLine = {
    spans: [{ text: "│ ", style: { foreground: { palette: 8 } } }, { text: "quoted words wrap here" }],
    continuation: [{ text: "│ ", style: { foreground: { palette: 8 } } }],
  };
  assert.deepEqual(layoutLines([quote], 12).map(row => row.spans), [
    [{ text: "│ ", style: { foreground: { palette: 8 } } }, { text: "quoted" }],
    [{ text: "│ ", style: { foreground: { palette: 8 } } }, { text: "words wrap" }],
    [{ text: "│ ", style: { foreground: { palette: 8 } } }, { text: "here" }],
  ], "the marker keeps its style on every row");
});

test("a continuation prefix that leaves no width is omitted rather than failing", () => {
  assert.deepEqual(texts([plain("ab cd", { continuation: [{ text: ">>>" }] })], 3), ["ab", "cd"]);
});

test("char wrap breaks between cells regardless of spaces", () => {
  assert.deepEqual(texts([plain("ab cdef gh", { wrap: "char" })], 4), ["ab c", "def", "gh"]);
});

test("wide characters break between each other and count two cells", () => {
  assert.deepEqual(texts([plain("终端协议历史内容")], 6), ["终端协", "议历史", "内容"]);
  assert.deepEqual(texts([plain("abc 终端协议")], 7), ["abc 终", "端协议"], "a narrow word next to wide characters");
});

test("a fill line repeats its grapheme across the full width at every width", () => {
  const rule = plain("─", { fill: true });
  assert.deepEqual(texts([rule], 36), ["─".repeat(36)]);
  assert.deepEqual(texts([rule], 100), ["─".repeat(100)]);
  assert.deepEqual(texts([plain("终", { fill: true })], 5), ["终终"], "a wide fill grapheme uses whole cells only");
});

test("each source line starts new rows, and row offsets are per line", () => {
  const rows = layoutLines([plain("one two"), plain(""), plain("three")], 4);
  assert.deepEqual(rows.map(row => [row.line, rowText(row), row.start, row.end]), [
    [0, "one", 0, 3], [0, "two", 4, 7], [1, "", 0, 0], [2, "thre", 0, 4], [2, "e", 4, 5],
  ]);
});
