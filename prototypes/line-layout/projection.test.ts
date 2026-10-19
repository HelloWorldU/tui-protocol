import assert from "node:assert/strict";
import test from "node:test";
import { layoutLines, rowText, type LayoutLine } from "./layout.ts";
import { LinesProjection } from "./projection.ts";

const lines: LayoutLine[] = [
  { spans: [{ text: "- one two three" }], continuation: [{ text: "  " }] },
  { spans: [{ text: "│ quoted words here" }], continuation: [{ text: "│ " }] },
  { spans: [{ text: "─" }], fill: true },
];
const rows = layoutLines(lines, 10);
const projection = new LinesProjection(lines, rows);

test("the fixture lays out with prefixes on every soft-wrapped row", () => {
  assert.deepEqual(rows.map(rowText), ["- one two", "  three", "│ quoted", "│ words", "│ here", "──────────"]);
});

test("copy across a soft break yields the logical text with the dropped space and without the prefix", () => {
  // From "two" on row 0 to the end of "three" on row 1.
  assert.equal(projection.copy({ row: 0, col: 6 }, { row: 1, col: 7 }), "two three");
  assert.equal(projection.copy({ row: 2, col: 0 }, { row: 4, col: 6 }), "│ quoted words here", "the first marker is content");
  assert.equal(projection.copy({ row: 3, col: 0 }, { row: 3, col: 7 }), "words", "a selection starting in the prefix copies no prefix");
});

test("copy across lines inserts one LF per line boundary, and a fill row copies its grapheme once", () => {
  assert.equal(projection.copy({ row: 1, col: 2 }, { row: 2, col: 3 }), "three\n│ q");
  assert.equal(projection.copy({ row: 5, col: 0 }, { row: 5, col: 10 }), "─");
});

test("search matches the logical text across soft breaks, never prefixes, and maps back to cells", () => {
  assert.deepEqual(projection.find("two three"), [6]);
  assert.deepEqual(projection.find("│ words"), [], "a continuation marker is not searchable text");
  const match = projection.find("words")[0]!;
  assert.deepEqual(projection.positionOf(match), { row: 3, col: 2 });
  assert.deepEqual(projection.positionOf(9), { row: 1, col: 2 }, "an offset in a dropped space shows at the next row's text");
});

test("wide characters map both of their cells to one logical offset", () => {
  const wide: LayoutLine[] = [{ spans: [{ text: "终端协议" }] }];
  const wideRows = layoutLines(wide, 5);
  const wideProjection = new LinesProjection(wide, wideRows);
  assert.deepEqual(wideRows.map(row => row.columns), [[0, 0, 1, 1], [2, 2, 3, 3]]);
  assert.equal(wideProjection.copy({ row: 0, col: 2 }, { row: 1, col: 2 }), "端协");
  assert.deepEqual(wideProjection.positionOf(2), { row: 1, col: 0 });
});
