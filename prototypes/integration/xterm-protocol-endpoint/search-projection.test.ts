import assert from "node:assert/strict";
import test from "node:test";
import { searchCellOffset } from "../xterm-browser-search/search-cell-offset.ts";
import { createTerminal, write } from "./test-support.ts";

test("search offsets count real spaces but omit the unused cell before a wrapped Chinese glyph", async () => {
  const terminal = createTerminal({ cols: 9, rows: 4 });
  try {
    await write(terminal, "中文    结果结果");
    assert.equal(terminal.buffer.active.getLine(0)?.getCell(8)?.getCode(), 0);
    assert.equal(terminal.buffer.active.getLine(1)?.isWrapped, true);
    assert.equal(terminal.buffer.active.getLine(1)?.getCell(0)?.getChars(), "结");
    assert.equal(searchCellOffset(terminal, 0, 8), 6, "two Chinese characters plus four real spaces");
    assert.equal(searchCellOffset(terminal, 0, 9), 6, "padding does not advance the string index");
    assert.equal(searchCellOffset(terminal, 0, 13), 8, "the second identical match starts after two more characters");
    assert.equal(searchCellOffset(terminal, 0, 17), 10, "the second match ends at the logical text tail");
  } finally { terminal.dispose(); }
});

test("search offsets keep an actual trailing space and stop at a hard line boundary", async () => {
  const terminal = createTerminal({ cols: 5, rows: 4 });
  try {
    await write(terminal, "中文 结果\r\n新行");
    assert.equal(terminal.buffer.active.getLine(0)?.getCell(4)?.getCode(), 0x20);
    assert.equal(searchCellOffset(terminal, 0, 5), 3, "a stored space is not wide-wrap padding");
    assert.equal(searchCellOffset(terminal, 0, 9), 5, "both Chinese characters after the wrap are counted");
    assert.equal(searchCellOffset(terminal, 0, 99), 6, "conversion stops before the next hard line; the final unused cell follows native space handling");
  } finally { terminal.dispose(); }
});
