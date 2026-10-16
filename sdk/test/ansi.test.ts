import assert from "node:assert/strict";
import test from "node:test";
import { spansFromAnsi } from "../src/index.ts";

test("text without escape sequences parses to a single unstyled span", () => {
  assert.deepEqual(spansFromAnsi("plain 中文 🙂"), [{ text: "plain 中文 🙂" }]);
  assert.deepEqual(spansFromAnsi(""), []);
  assert.deepEqual(spansFromAnsi("\x1b[31m"), [], "styling without text produces no span");
});

test("every emphasis attribute is set and cleared by its own code", () => {
  assert.deepEqual(
    spansFromAnsi(
      "\x1b[1;2;3;4;9;7mall" +
      "\x1b[22mno-heavy" + // clears bold and faint together
      "\x1b[23;24;29;27mclean",
    ),
    [
      {
        text: "all",
        style: {
          bold: true, faint: true, italic: true,
          underline: true, strikethrough: true, inverse: true,
        },
      },
      { text: "no-heavy", style: { italic: true, underline: true, strikethrough: true, inverse: true } },
      { text: "clean" },
    ],
  );
});

test("SGR 0 and an empty parameter list reset all attributes", () => {
  assert.deepEqual(spansFromAnsi("\x1b[1;31mred\x1b[0mplain"), [
    { text: "red", style: { bold: true, foreground: { palette: 1 } } },
    { text: "plain" },
  ]);
  assert.deepEqual(spansFromAnsi("\x1b[3mitalic\x1b[mplain"), [
    { text: "italic", style: { italic: true } },
    { text: "plain" },
  ]);
});

test("the 16-color codes map to palette indices, preserving terminal theme semantics", () => {
  assert.deepEqual(spansFromAnsi("\x1b[30mzero"), [{ text: "zero", style: { foreground: { palette: 0 } } }]);
  assert.deepEqual(spansFromAnsi("\x1b[31mred"), [{ text: "red", style: { foreground: { palette: 1 } } }]);
  assert.deepEqual(spansFromAnsi("\x1b[97mbright"), [{ text: "bright", style: { foreground: { palette: 15 } } }]);
  assert.deepEqual(spansFromAnsi("\x1b[44mblue-bg"), [{ text: "blue-bg", style: { background: { palette: 4 } } }]);
  assert.deepEqual(spansFromAnsi("\x1b[102mbright-bg"), [{ text: "bright-bg", style: { background: { palette: 10 } } }]);
  assert.deepEqual(spansFromAnsi("\x1b[107mfifteen"), [{ text: "fifteen", style: { background: { palette: 15 } } }]);
});

test("256-palette and true-color sequences parse, while out-of-range parameters are ignored", () => {
  assert.deepEqual(spansFromAnsi("\x1b[38;5;196mhot\x1b[48;5;0mbg"), [
    { text: "hot", style: { foreground: { palette: 196 } } },
    { text: "bg", style: { foreground: { palette: 196 }, background: { palette: 0 } } },
  ]);
  assert.deepEqual(spansFromAnsi("\x1b[38;2;10;20;30mrgb\x1b[48;2;0;128;255mboth"), [
    { text: "rgb", style: { foreground: { rgb: [10, 20, 30] } } },
    { text: "both", style: { foreground: { rgb: [10, 20, 30] }, background: { rgb: [0, 128, 255] } } },
  ]);
  assert.deepEqual(spansFromAnsi("\x1b[38;5;300mplain"), [{ text: "plain" }]);
  assert.deepEqual(spansFromAnsi("\x1b[38;2;1;2;300mplain"), [{ text: "plain" }]);
});

test("SGR 39 and 49 restore the default colors by dropping the attributes", () => {
  assert.deepEqual(spansFromAnsi("\x1b[31;42mcolored\x1b[39mfg-gone\x1b[49mplain"), [
    { text: "colored", style: { foreground: { palette: 1 }, background: { palette: 2 } } },
    { text: "fg-gone", style: { background: { palette: 2 } } },
    { text: "plain" },
  ]);
});

test("adjacent runs with equal styles merge into one span while style changes split", () => {
  assert.deepEqual(spansFromAnsi("a\x1b[31mred\x1b[31mstill-red\x1b[32mgreen\x1b[39mtail"), [
    { text: "a" },
    { text: "redstill-red", style: { foreground: { palette: 1 } } },
    { text: "green", style: { foreground: { palette: 2 } } },
    { text: "tail" },
  ]);
});

test("non-SGR escape sequences are silently discarded and ordinary text is kept", () => {
  assert.deepEqual(spansFromAnsi("\x1b[2J\x1b[1;1Htext"), [{ text: "text" }]);
  assert.deepEqual(spansFromAnsi("\x1b]0;window title\x07after-osc"), [{ text: "after-osc" }]);
  assert.deepEqual(spansFromAnsi("\x1b]8;;https://example.com\x1b\\link"), [{ text: "link" }]);
  assert.deepEqual(spansFromAnsi("\x1b(Bascii"), [{ text: "ascii" }]);
  assert.deepEqual(spansFromAnsi("trailing\x1b"), [{ text: "trailing" }]);
  assert.deepEqual(spansFromAnsi("line\none\ttab"), [{ text: "line\none\ttab" }]);
});

test("unknown SGR attributes are ignored without dropping the text", () => {
  assert.deepEqual(spansFromAnsi("\x1b[5mblink"), [{ text: "blink" }]);
  assert.deepEqual(spansFromAnsi("\x1b[5;31mred-blink"), [
    { text: "red-blink", style: { foreground: { palette: 1 } } },
  ]);
});
