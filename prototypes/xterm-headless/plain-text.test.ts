import assert from "node:assert/strict";
import test from "node:test";
import headless from "@xterm/headless";

import {
  fixtureCellWidth, projectPlainText, retainedPlainTextLength, textOffset, textPosition,
} from "./plain-text.ts";

test("every C0, DEL, and C1 control except Tab, LF, and CR projects to its visible label", () => {
  for (let code = 0; code <= 0x9f; code++) {
    if (code >= 0x20 && code < 0x7f) continue;
    if (code === 9 || code === 10 || code === 13) continue;
    const label = `<U+${code.toString(16).toUpperCase().padStart(4, "0")}>`;
    const projection = projectPlainText(String.fromCodePoint(code));
    assert.equal(projection.text, label, `control ${code}`);
    assert.equal(projection.ascii, true);
    assert.deepEqual(projection.tabs, []);
  }
});

test("the basic-CJK fixture widths agree with the pinned xterm default provider", () => {
  const terminal = new headless.Terminal();
  try {
    const provider = (terminal as unknown as {
      _core: { unicodeService: { activeVersion: string; wcwidth(code: number): number } };
    })._core.unicodeService;
    assert.equal(provider.activeVersion, "6");
    for (let code = 0x4e00; code <= 0x9fff; code++) {
      assert.equal(fixtureCellWidth(String.fromCodePoint(code)), provider.wcwidth(code), String(code));
    }
    assert.equal(projectPlainText("中文\t结果").text, "中文    结果");
    assert.equal(projectPlainText("中\t文", 4).text, "中  文");
    assert.equal(projectPlainText("中文\t结果").mappable, true);
    assert.equal(projectPlainText("😀\t").mappable, false);
    assert.equal(projectPlainText("e\u0301\t").mappable, false);
  } finally { terminal.dispose(); }
});

test("Chinese and Tab offsets match actual xterm cells, including the gap before a wrapped wide glyph", async () => {
  for (const raw of ["中文\t结果", "abc中\t文", "中\t文\t尾", "abcde中", "中中中"]) {
    const { text } = projectPlainText(raw);
    for (const cols of [2, 3, 5, 6, 9, 20]) {
      const terminal = new headless.Terminal({ cols, rows: 2, scrollback: 100, allowProposedApi: true });
      try {
        await new Promise<void>(resolve => terminal.write(text, resolve));
        const cells: { row: number; column: number; char: string; width: number }[] = [];
        for (let row = 0; row < terminal.buffer.active.length; row++) {
          const line = terminal.buffer.active.getLine(row)!;
          for (let column = 0; column < cols; column++) {
            const cell = line.getCell(column)!;
            if (cell.getChars() !== "") cells.push({ row, column, char: cell.getChars(), width: cell.getWidth() });
          }
        }
        assert.equal(cells.map(cell => cell.char).join(""), text);
        for (const [offset, cell] of cells.entries()) {
          const label = JSON.stringify({ raw, cols, offset });
          assert.deepEqual(textPosition(text, offset, cols), { row: cell.row, column: cell.column }, label);
          assert.deepEqual(textPosition(text, offset + 1, cols, "end"),
            { row: cell.row, column: cell.column + cell.width }, label);
          assert.equal(textOffset(text, cell.row, cell.column, cols), offset, label);
          if (cell.width === 2) {
            assert.equal(textOffset(text, cell.row, cell.column + 1, cols, "start"), offset, label);
            assert.equal(textOffset(text, cell.row, cell.column + 1, cols, "end"), offset + 1, label);
          }
        }
      } finally { terminal.dispose(); }
    }
  }
});

test("text projection normalizes newlines, expands logical-line Tabs, and leaves Unicode text unchanged", () => {
  assert.equal(projectPlainText("a\rb\r\nc\nd").text, "a\nb\nc\nd");
  assert.equal(projectPlainText("a\tb\n\tc", 4).text, "a   b\n    c");
  assert.equal(projectPlainText("中文😀e\u0301").text, "中文😀e\u0301");
  assert.equal(projectPlainText("中文😀e\u0301").ascii, false);
});

test("tested projected offsets round-trip through wrapped rows including LF and exact-width boundaries", () => {
  for (const content of ["", "abcd", "abcde", "abcd\ne", "a\r\nb\t\x1b\n\nc"]) {
    const { text } = projectPlainText(content);
    for (const cols of [1, 4, 8, 20]) {
      for (let offset = 0; offset <= text.length; offset++) {
        const position = textPosition(text, offset, cols);
        assert.equal(textOffset(text, position.row, position.column, cols), offset,
          `${JSON.stringify(content)}, columns ${cols}, offset ${offset}`);
      }
    }
  }
  assert.deepEqual(textPosition("abcde", 4, 4), { row: 1, column: 0 });
  assert.deepEqual(textPosition("abcd", 4, 4), { row: 0, column: 4 });
  assert.equal(textOffset("a\nb", 0, 3, 20), undefined);
});

test("the retained display prefix excludes a CRLF break when its LF scalar is removed", () => {
  assert.equal(retainedPlainTextLength("a\r\nb", 2), 1);
  assert.equal(retainedPlainTextLength("a\r\nb", 3), 2);
  assert.equal(retainedPlainTextLength("a\rb", 2), 2);
  assert.equal(retainedPlainTextLength("a\t\x1bX", 3), 16);
});
