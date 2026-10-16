import assert from "node:assert/strict";
import test from "node:test";

import { projectPlainText } from "./plain-text.ts";
import { projectStyledSpans, spansToSgr } from "./styled-render.ts";

test("unstyled span lists produce exactly their concatenated text without any SGR", () => {
  assert.equal(spansToSgr([]), "");
  assert.equal(spansToSgr([{ text: "a" }, { text: "b" }]), "ab");
  assert.equal(spansToSgr([{ text: "x", style: {} }]), "x");
});

test("a style change resets before setting the new style and styled text ends with a reset", () => {
  assert.equal(
    spansToSgr([
      { text: "a", style: { bold: true } },
      { text: "b", style: { italic: true } },
      { text: "c" },
    ]),
    "\x1b[1ma\x1b[0m\x1b[3mb\x1b[0mc",
  );
});

test("adjacent spans with the same style share one SGR run", () => {
  assert.equal(
    spansToSgr([
      { text: "a", style: { bold: true } },
      { text: "b", style: { bold: true } },
    ]),
    "\x1b[1mab\x1b[0m",
  );
});

test("palette, RGB, and default colors map to their SGR parameters", () => {
  assert.equal(
    spansToSgr([
      {
        text: "x",
        style: {
          foreground: { palette: 196 },
          background: { rgb: [1, 2, 3] },
        },
      },
    ]),
    "\x1b[38;5;196;48;2;1;2;3mx\x1b[0m",
  );
  assert.equal(
    spansToSgr([
      {
        text: "y",
        style: {
          foreground: { rgb: [255, 100, 0] },
          background: { palette: 11 },
        },
      },
    ]),
    "\x1b[38;2;255;100;0;48;5;11my\x1b[0m",
  );
  assert.equal(
    spansToSgr([
      { text: "z", style: { foreground: "default", background: "default" } },
    ]),
    "\x1b[39;49mz\x1b[0m",
  );
});

test("bold, faint, italic, underline, inverse, and strikethrough map to SGR 1, 2, 3, 4, 7, 9", () => {
  assert.equal(
    spansToSgr([
      {
        text: "x",
        style: {
          bold: true,
          faint: true,
          italic: true,
          underline: true,
          inverse: true,
          strikethrough: true,
        },
      },
    ]),
    "\x1b[1;2;3;4;7;9mx\x1b[0m",
  );
});

test("a Tab stop carries its column across span boundaries and keeps its span's style", () => {
  assert.deepEqual(
    projectStyledSpans(
      [{ text: "ab" }, { text: "\tX", style: { bold: true } }],
      4,
    ),
    [{ text: "ab" }, { text: "  X", style: { bold: true } }],
  );
  assert.deepEqual(
    projectStyledSpans([{ text: "中" }, { text: "\t", style: { italic: true } }], 4),
    [{ text: "中" }, { text: "  ", style: { italic: true } }],
  );
});

test("a control character's visible label keeps its span's style", () => {
  assert.deepEqual(
    projectStyledSpans([{ text: "a\x1b", style: { underline: true } }]),
    [{ text: "a<U+001B>", style: { underline: true } }],
  );
});

test("a CRLF pair split across two spans projects to a single newline", () => {
  assert.deepEqual(
    projectStyledSpans([{ text: "a\r" }, { text: "\nb", style: { bold: true } }]),
    [{ text: "a" }, { text: "\nb", style: { bold: true } }],
  );
  assert.deepEqual(
    projectStyledSpans([{ text: "a\r" }, { text: "b" }]),
    [{ text: "a\nb" }],
  );
});

test("unstyled styled-span projection matches the plain-text projection of the logical text", () => {
  for (const content of ["a\tb\n\tc", "中\t文", "a\x1b\x07b\r\nc", "x\ry"]) {
    const spans = projectStyledSpans([{ text: content }], 4);
    assert.deepEqual(
      spans.map((span) => ({ ...span, style: undefined })),
      [{ text: projectPlainText(content, 4).text, style: undefined }],
    );
  }
});
