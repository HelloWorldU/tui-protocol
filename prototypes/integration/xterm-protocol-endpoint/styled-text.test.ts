import assert from "node:assert/strict";
import test from "node:test";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

import type { Message, StyledTextSpan } from "@tui-protocol/protocol";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import {
  append,
  bufferRows,
  createTerminal,
  decodeResponses,
  emptyResult,
  encodeInput,
  negotiateAndOpen,
} from "./test-support.ts";

test("a styled Append renders every emphasis and color attribute on its characters' cells", async () => {
  const terminal = createTerminal({ cols: 80, rows: 5 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled"],
  });
  try {
    const context = negotiateStyledAndOpen(endpoint);
    const spans: StyledTextSpan[] = [
      { text: "default " },
      { text: "pal ", style: { foreground: { palette: 196 } } },
      { text: "rgb ", style: { foreground: { rgb: [12, 34, 56] } } },
      { text: "bg ", style: { background: { palette: 11 } } },
      { text: "bgrgb ", style: { background: { rgb: [200, 100, 50] } } },
      { text: "bold ", style: { bold: true } },
      { text: "faint ", style: { faint: true } },
      { text: "ital ", style: { italic: true } },
      { text: "und ", style: { underline: true } },
      { text: "inv ", style: { inverse: true } },
      { text: "strike", style: { strikethrough: true } },
    ];
    assert.deepEqual(
      endpoint.push(encodeInput(styledAppend(context, "1", "text", spans), 3)),
      emptyResult(),
    );
    await endpoint.drain();

    assert.equal(
      bufferRows(terminal)[0],
      "default pal rgb bg bgrgb bold faint ital und inv strike",
    );
    assert.deepEqual(
      endpoint.context(context)?.blocks[0]?.content,
      { type: "text/styled", data: spans },
    );

    let column = 0;
    const at = (text: string) => {
      const start = column;
      column += text.length;
      return start;
    };
    const cell = (start: number) => requiredCell(terminal, 0, start);

    const unstyled = cell(at("default "));
    assert.equal(unstyled.isAttributeDefault(), true, "unstyled span cells");

    const palette = cell(at("pal "));
    assert.equal(palette.isFgPalette(), true, "palette foreground mode");
    assert.equal(palette.getFgColor(), 196, "palette foreground index");

    const rgb = cell(at("rgb "));
    assert.equal(rgb.isFgRGB(), true, "RGB foreground mode");
    assert.equal(rgb.getFgColor(), 0x0c2238, "RGB foreground value");

    const background = cell(at("bg "));
    assert.equal(background.isBgPalette(), true, "palette background mode");
    assert.equal(background.getBgColor(), 11, "palette background index");

    const rgbBackground = cell(at("bgrgb "));
    assert.equal(rgbBackground.isBgRGB(), true, "RGB background mode");
    assert.equal(rgbBackground.getBgColor(), 0xc86432, "RGB background value");

    assert.equal(Boolean(cell(at("bold ")).isBold()), true, "bold");
    assert.equal(Boolean(cell(at("faint ")).isDim()), true, "faint");
    assert.equal(Boolean(cell(at("ital ")).isItalic()), true, "italic");
    assert.equal(
      Boolean(cell(at("und ")).isUnderline()),
      true,
      "underline",
    );
    assert.equal(Boolean(cell(at("inv ")).isInverse()), true, "inverse");
    assert.equal(
      Boolean(cell(at("strike")).isStrikethrough()),
      true,
      "strikethrough",
    );
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("a styled Extend appends its fragment's styles and leaves unstyled text at the terminal default", async () => {
  const terminal = createTerminal({ cols: 20, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled"],
  });
  try {
    const context = negotiateStyledAndOpen(endpoint);
    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledAppend(context, "1", "thinking", [
            { text: "start ", style: { bold: true } },
          ]),
          3,
        ),
      ),
      emptyResult(),
    );
    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledExtend(context, "2", "thinking", "1", [
            { text: "mid ", style: { italic: true } },
            { text: "plain" },
          ]),
          4,
        ),
      ),
      emptyResult(),
    );
    await endpoint.drain();

    assert.equal(bufferRows(terminal)[0], "start mid plain");
    assert.equal(Boolean(requiredCell(terminal, 0, 0).isBold()), true);
    assert.equal(Boolean(requiredCell(terminal, 0, 6).isItalic()), true);
    assert.equal(
      requiredCell(terminal, 0, 10).isAttributeDefault(),
      true,
      "the unstyled extended span renders at the terminal default",
    );
    assert.deepEqual(
      endpoint.context(context)?.blocks[0]?.content,
      {
        type: "text/styled",
        data: [
          { text: "start ", style: { bold: true } },
          { text: "mid ", style: { italic: true } },
          { text: "plain" },
        ],
      },
    );
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("a styled ReplaceSuffix keeps the truncated prefix span's style and renders the replacement's style", async () => {
  const terminal = createTerminal({ cols: 20, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled"],
  });
  try {
    const context = negotiateStyledAndOpen(endpoint);
    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledAppend(context, "1", "text", [
            { text: "aa", style: { foreground: { palette: 2 } } },
            { text: "bbbb", style: { underline: true } },
            { text: "cc" },
          ]),
          3,
        ),
      ),
      emptyResult(),
    );
    await endpoint.drain();
    assert.equal(bufferRows(terminal)[0], "aabbbbcc");

    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledReplaceSuffix(context, "2", "text", "1", 3, [
            { text: "XY", style: { inverse: true } },
          ]),
          4,
        ),
      ),
      emptyResult(),
    );
    await endpoint.drain();

    assert.equal(bufferRows(terminal)[0], "aabXY");
    const retainedColor = requiredCell(terminal, 0, 0);
    assert.equal(retainedColor.isFgPalette(), true);
    assert.equal(retainedColor.getFgColor(), 2, "the retained prefix color");
    assert.equal(
      Boolean(requiredCell(terminal, 0, 2).isUnderline()),
      true,
      "the span truncated at the retain boundary keeps its style",
    );
    assert.equal(
      Boolean(requiredCell(terminal, 0, 3).isInverse()),
      true,
      "the replacement span's style",
    );
    assert.equal(
      requiredCell(terminal, 0, 5).isAttributeDefault(),
      true,
      "the removed suffix leaves no styled cells",
    );
    assert.deepEqual(
      endpoint.context(context)?.blocks[0]?.content,
      {
        type: "text/styled",
        data: [
          { text: "aa", style: { foreground: { palette: 2 } } },
          { text: "b", style: { underline: true } },
          { text: "XY", style: { inverse: true } },
        ],
      },
    );
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("a resize reflows styled content with each character's attributes following it", async () => {
  const terminal = createTerminal({ cols: 10, rows: 6 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled"],
  });
  try {
    const context = negotiateStyledAndOpen(endpoint);
    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledAppend(context, "1", "text", [
            { text: "01234567", style: { bold: true } },
            { text: "89ABCDEF", style: { foreground: { palette: 33 } } },
          ]),
          3,
        ),
      ),
      emptyResult(),
    );
    await endpoint.drain();
    assert.deepEqual(bufferRows(terminal).slice(0, 3), [
      "0123456789",
      "ABCDEF",
      "",
    ]);
    assert.equal(Boolean(requiredCell(terminal, 0, 7).isBold()), true);
    assert.equal(requiredCell(terminal, 0, 8).getFgColor(), 33);
    assert.equal(requiredCell(terminal, 1, 0).getFgColor(), 33);

    terminal.resize(5, 6);
    await endpoint.drain();

    assert.deepEqual(bufferRows(terminal).slice(0, 5), [
      "01234",
      "56789",
      "ABCDE",
      "F",
      "",
    ]);
    const movedBold = requiredCell(terminal, 1, 2);
    assert.equal(movedBold.getChars(), "7");
    assert.equal(Boolean(movedBold.isBold()), true, "bold follows its character");
    const wrappedPalette = requiredCell(terminal, 1, 3);
    assert.equal(wrappedPalette.getChars(), "8");
    assert.equal(
      wrappedPalette.getFgColor(),
      33,
      "the palette color follows its character across the wrap",
    );
    const tail = requiredCell(terminal, 3, 0);
    assert.equal(tail.getChars(), "F");
    assert.equal(tail.getFgColor(), 33);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("control labels and Tab spaces inside a styled span keep that span's style", async () => {
  const terminal = createTerminal({ cols: 40, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
    optionalContentTypes: ["text/styled"],
  });
  try {
    const context = negotiateStyledAndOpen(endpoint);
    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledAppend(context, "1", "text", [
            { text: "a\x1bb", style: { foreground: { palette: 9 } } },
          ]),
          3,
        ),
      ),
      emptyResult(),
    );
    assert.deepEqual(
      endpoint.push(
        encodeInput(
          styledAppend(context, "2", "wide", [
            { text: "中", style: { bold: true } },
            { text: "\tX", style: { italic: true } },
          ]),
          4,
        ),
      ),
      emptyResult(),
    );
    await endpoint.drain();

    assert.equal(bufferRows(terminal)[0], "a<U+001B>b");
    const labelCell = requiredCell(terminal, 0, 1);
    assert.equal(labelCell.getChars(), "<");
    assert.equal(labelCell.getFgColor(), 9, "the ESC label keeps the span color");

    assert.equal(bufferRows(terminal)[1], "中      X");
    assert.equal(Boolean(requiredCell(terminal, 1, 0).isBold()), true);
    assert.equal(
      Boolean(requiredCell(terminal, 1, 2).isItalic()),
      true,
      "the Tab's spaces keep the Tab span's style",
    );
    assert.equal(Boolean(requiredCell(terminal, 1, 8).isItalic()), true);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

test("styled content is rejected as unsupported_content_type when the terminal did not advertise it", async () => {
  const terminal = createTerminal({ cols: 20, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, {
    completeBaselineSupported: true,
  });
  try {
    const context = negotiateAndOpen(endpoint);
    const result = endpoint.push(
      encodeInput(
        styledAppend(context, "1", "text", [
          { text: "styled", style: { bold: true } },
        ]),
        3,
      ),
    );
    assert.deepEqual(decodeResponses(result), [
      {
        version: 1,
        kind: "protocol.error",
        context_id: context,
        operation_id: "1",
        body: { code: "unsupported_content_type" },
      },
    ]);
    assert.deepEqual(endpoint.context(context)?.blocks, []);
    assert.deepEqual(bufferRows(terminal), ["", "", ""]);
  } finally {
    endpoint.dispose();
    terminal.dispose();
  }
});

function styledAppend(
  contextId: string,
  operationId: string,
  blockId: string,
  spans: readonly StyledTextSpan[],
): Message {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      lifecycle: "mutable",
      content: { type: "text/styled", data: spans },
    },
  };
}

function styledExtend(
  contextId: string,
  operationId: string,
  blockId: string,
  baseOperationId: string,
  spans: readonly StyledTextSpan[],
): Message {
  return {
    version: 1,
    kind: "block.extend",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      fragment: spans,
    },
  };
}

function styledReplaceSuffix(
  contextId: string,
  operationId: string,
  blockId: string,
  baseOperationId: string,
  retain: number,
  spans: readonly StyledTextSpan[],
): Message {
  return {
    version: 1,
    kind: "block.replace_suffix",
    operation_id: operationId,
    context_id: contextId,
    body: {
      block_id: blockId,
      base_operation_id: baseOperationId,
      retain,
      replacement: spans,
    },
  };
}

function negotiateStyledAndOpen(endpoint: XtermProtocolEndpoint): string {
  const capability = endpoint.push(
    encodeInput(
      {
        version: 1,
        kind: "capability.query",
        request_id: "capability-1",
        body: {},
      },
      1,
    ),
  );
  assert.deepEqual(decodeResponses(capability), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capability-1",
      body: { outcome: "supported", optional_content_types: ["text/styled"] },
    },
  ]);

  const opened = endpoint.push(
    encodeInput(
      { version: 1, kind: "context.open", request_id: "open-1", body: {} },
      2,
    ),
  );
  const [response] = decodeResponses(opened);
  if (
    response?.kind !== "context.open.response" ||
    !("context_id" in response)
  ) {
    throw new Error("Expected a successful Context open response.");
  }
  return response.context_id;
}

function requiredCell(terminal: HeadlessTerminal, row: number, column: number) {
  const cell = terminal.buffer.active.getLine(row)?.getCell(column);
  assert.ok(cell, `cell ${column},${row}`);
  return cell;
}
