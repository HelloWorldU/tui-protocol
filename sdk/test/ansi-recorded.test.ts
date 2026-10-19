import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spansFromAnsi, type StyledTextSpan } from "../src/index.ts";

// Raw ConPTY output of one stock Pi 0.87.1 turn at 60x24, with markdown fixture
// text; recorded by prototypes/integration/pi-stock-ui/record-ansi.ts. Besides
// SGR it carries cursor movement, erase, mode, OSC 0/8/11/133, and synchronized
// output sequences, all of which the converter must discard.
const recording = readFileSync(new URL("./fixtures/pi-0.87.1-stock-turn.ansi", import.meta.url), "utf8");
const spans = spansFromAnsi(recording);

test("a recorded Pi turn converts without escape or control-sequence residue in any span", () => {
  assert.ok(recording.split("\x1b[").length > 500, "the recording is SGR-heavy real output");
  for (const span of spans) {
    assert.doesNotMatch(span.text, /[\x1b\x07\x9b]/, `control residue in ${JSON.stringify(span.text)}`);
    assert.doesNotMatch(span.text, /\]8;;|\]133;|\[\?2026[hl]|38;2;/, `sequence body leaked into ${JSON.stringify(span.text)}`);
  }
});

test("the converted logical text equals the recording with every escape sequence removed", () => {
  assert.equal(spans.map(span => span.text).join(""), stripEscapes(recording));
});

test("converted spans are never empty and adjacent spans never share one style", () => {
  for (const [index, span] of spans.entries()) {
    assert.notEqual(span.text, "", `empty span at ${index}`);
    if (index > 0) assert.notDeepEqual(span.style, spans[index - 1]!.style, `unmerged equal styles at ${index}`);
  }
});

test("Pi's markdown heading, bold phrase, and inline code become spans carrying Pi's theme styling", () => {
  const styleOf = (text: string) => spans.find(span => span.text.includes(text) && span.style !== undefined)?.style;
  assert.deepEqual(styleOf("Trial answer"), { foreground: { rgb: [240, 198, 116] }, bold: true }, "heading");
  assert.deepEqual(styleOf("text/styled"), { foreground: { rgb: [138, 190, 183] } }, "`code` color");
  // The tool Block repeats the phrase in its own colors; take the answer's occurrence.
  const prose = spans.findIndex((span: StyledTextSpan) => span.text.endsWith("The sample reports: "));
  assert.ok(prose >= 0, "answer prose present");
  assert.equal(spans[prose]!.style, undefined, "surrounding prose stays unstyled");
  assert.match(spans[prose + 1]!.text, /^mutable history keeps old output/, "the bold phrase follows the prose");
  assert.deepEqual(spans[prose + 1]!.style, { bold: true }, "**bold** phrase");
});

/**
 * Independent reference stripper for the sequence families in the recording:
 * CSI (ESC [ ... final byte), OSC (ESC ] ... BEL or ST), and two-byte ESC sequences.
 */
function stripEscapes(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "\x1b") {
      result += text[index];
      continue;
    }
    const kind = text[index + 1];
    if (kind === "[") {
      index += 2;
      while (index < text.length && !/[@-~]/.test(text[index]!)) index++;
    } else if (kind === "]") {
      index += 2;
      while (index < text.length && text[index] !== "\x07" && !(text[index] === "\x1b" && text[index + 1] === "\\")) index++;
      if (text[index] === "\x1b") index++;
    } else {
      index++;
    }
  }
  return result;
}
