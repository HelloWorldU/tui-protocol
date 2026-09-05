import assert from "node:assert/strict";
import test from "node:test";

import {
  projectPlainText, retainedPlainTextLength, textOffset, textPosition,
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
