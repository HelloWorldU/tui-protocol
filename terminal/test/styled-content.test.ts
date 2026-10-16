import assert from "node:assert/strict";
import test from "node:test";

import type {
  BlockAppend,
  BlockExtend,
  BlockReplaceSuffix,
  BlockUpdate,
  ContentSnapshot,
  Message,
  OperationErrorCode,
  PlainTextSnapshot,
  StyledTextSnapshot,
  StyledTextSpan,
  StyledTextStyle,
} from "@tui-protocol/protocol";
import { TerminalProtocolSession } from "../src/session.ts";
import { spanDrop, spanPrefix } from "../src/content.ts";
import {
  trialSessionLimits,
  type SessionResourceLimits,
} from "../src/resource-limits.ts";

test("a Session advertises text/styled in its capability response only when configured to support it", () => {
  const query: Message = {
    version: 1,
    kind: "capability.query",
    request_id: "capabilities",
    body: {},
  };

  assert.deepEqual(openSession().handle(query), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capabilities",
      body: { outcome: "supported", optional_content_types: ["text/styled"] },
    },
  ]);
  assert.deepEqual(openSession([]).handle(query), [
    {
      version: 1,
      kind: "capability.response",
      request_id: "capabilities",
      body: { outcome: "supported", optional_content_types: [] },
    },
  ]);
});

test("styled Append and Update store span content that reads back equal", () => {
  const session = openSession();
  const greeting = styled(
    { text: "Hello, ", style: { foreground: { palette: 2 } } },
    { text: "world", style: { bold: true, underline: true } },
  );
  const farewell = styled({
    text: "goodbye",
    style: { foreground: { rgb: [200, 30, 30] }, strikethrough: true },
  });

  assert.deepEqual(session.handle(append("1", "answer", greeting)), []);
  assert.deepEqual(session.context("context-1"), {
    id: "context-1",
    state: "open",
    blocks: [{ id: "answer", lifecycle: "mutable", content: greeting }],
  });

  assert.deepEqual(session.handle(update("2", "answer", farewell)), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, farewell);
});

test("mutating the caller's spans or a returned snapshot never changes the stored styled content", () => {
  const session = openSession();
  const spans: StyledTextSpan[] = [{ text: "kept", style: { bold: true } }];
  assert.deepEqual(session.handle(append("1", "b", styled(...spans))), []);

  spans.push({ text: "caller injection" });
  (spans[0] as { text: string }).text = "caller rewrite";
  (spans[0]!.style as { bold: boolean }).bold = false;
  const expected = styled({ text: "kept", style: { bold: true } });
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, expected);

  const read = session.context("context-1")?.blocks[0]?.content;
  assert(read?.type === "text/styled");
  (read.data as StyledTextSpan[]).push({ text: "reader injection" });
  (read.data[0] as { text: string }).text = "reader rewrite";
  (read.data[0]!.style as { bold: boolean }).bold = false;
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, expected);
});

test("styled Append and Update report unsupported_content_type when text/styled is not configured, while text/plain is unaffected", () => {
  const session = openSession([]);

  assertOperationError(
    session.handle(append("1", "styled", styled({ text: "hi" }))),
    "1",
    "unsupported_content_type",
  );
  assert.deepEqual(session.handle(append("2", "plain", plain("hi"))), []);
  assertOperationError(
    session.handle(update("3", "plain", styled({ text: "restyled" }))),
    "3",
    "unsupported_content_type",
  );
  assert.deepEqual(session.context("context-1"), {
    id: "context-1",
    state: "open",
    blocks: [
      { id: "plain", lifecycle: "mutable", content: plain("hi") },
    ],
  });
});

test("styled content with an empty span text, an unknown or mistyped style attribute, or a malformed color reports invalid_content", () => {
  const session = openSession();
  const invalidStyles: Record<string, unknown>[] = [
    { blink: true },
    { bold: "yes" },
    { foreground: { palette: 256 } },
    { foreground: { palette: -1 } },
    { background: { rgb: [0, 0, 256] } },
    { foreground: "red" },
    { foreground: { palette: 1, rgb: [0, 0, 0] } },
  ];

  assertOperationError(
    session.handle(append("1", "b", styled({ text: "" }))),
    "1",
    "invalid_content",
  );
  invalidStyles.forEach((style, index) => {
    assertOperationError(
      session.handle(append(String(index + 2), "b", styledWithStyle(style))),
      String(index + 2),
      "invalid_content",
    );
  });
  assert.deepEqual(session.context("context-1")?.blocks, []);

  assert.deepEqual(
    session.handle(
      append(
        "9",
        "b",
        styled({
          text: "valid",
          style: { inverse: true, faint: false, background: "default" },
        }),
      ),
    ),
    [],
  );
});

test("Extend appends a styled fragment at the Block's current content base and rejects a stale base", () => {
  const session = openSession();
  assert.deepEqual(
    session.handle(append("1", "stream", styled({ text: "alpha", style: { bold: true } }))),
    [],
  );

  assertOperationError(
    session.handle(extend("2", "stream", "stale", [{ text: " lost" }])),
    "2",
    "content_state_mismatch",
  );
  assert.deepEqual(
    session.handle(
      extend("3", "stream", "1", [
        { text: " " },
        { text: "omega", style: { foreground: { rgb: [0, 128, 255] } } },
      ]),
    ),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled(
      { text: "alpha", style: { bold: true } },
      { text: " " },
      { text: "omega", style: { foreground: { rgb: [0, 128, 255] } } },
    ),
  );
});

test("Extend requires the fragment shape to match the Block's content type and leaves both bases usable", () => {
  const session = openSession();
  session.handle(append("1", "styled-block", styled({ text: "s" })));
  session.handle(append("2", "plain-block", plain("p")));

  assertOperationError(
    session.handle(extend("3", "styled-block", "1", " string fragment")),
    "3",
    "invalid_content",
  );
  assertOperationError(
    session.handle(extend("4", "plain-block", "2", [{ text: " spans" }])),
    "4",
    "invalid_content",
  );

  assert.deepEqual(
    session.handle(extend("5", "styled-block", "1", [{ text: "+ok" }])),
    [],
  );
  assert.deepEqual(session.handle(extend("6", "plain-block", "2", "+ok")), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, styled({ text: "s" }, { text: "+ok" }));
  assert.deepEqual(session.context("context-1")?.blocks[1]?.content, plain("p+ok"));
});

test("Extend rejects an invalid styled fragment and leaves the Block's content and base unchanged", () => {
  const session = openSession();
  session.handle(append("1", "stream", styled({ text: "base" })));

  assertOperationError(
    session.handle(extend("2", "stream", "1", invalidStyledSpans({ bold: 1 }))),
    "2",
    "invalid_content",
  );
  assertOperationError(
    session.handle(extend("3", "stream", "1", [{ text: "" }])),
    "3",
    "invalid_content",
  );

  assert.deepEqual(
    session.handle(extend("4", "stream", "1", [{ text: " again" }])),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled({ text: "base" }, { text: " again" }),
  );
});

test("ReplaceSuffix counts logical scalars across span boundaries, and a span truncated by the boundary keeps its style", () => {
  const session = openSession();
  session.handle(
    append(
      "1",
      "doc",
      styled(
        { text: "AB", style: { bold: true } },
        { text: "C🙂D", style: { foreground: { palette: 1 } } },
      ),
    ),
  );

  // The logical text is A B C 🙂 D: 🙂 is one scalar although it is two
  // UTF-16 code units, so retain 4 keeps C🙂 from the second span.
  assert.deepEqual(
    session.handle(replaceSuffix("2", "doc", "1", 4, [{ text: "!", style: { italic: true } }])),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled(
      { text: "AB", style: { bold: true } },
      { text: "C🙂", style: { foreground: { palette: 1 } } },
      { text: "!", style: { italic: true } },
    ),
  );
});

test("ReplaceSuffix with an empty span list deletes the styled suffix", () => {
  const session = openSession();
  session.handle(
    append(
      "1",
      "doc",
      styled({ text: "keep", style: { underline: true } }, { text: " drop" }),
    ),
  );

  assert.deepEqual(session.handle(replaceSuffix("2", "doc", "1", 4, [])), []);
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled({ text: "keep", style: { underline: true } }),
  );
});

test("ReplaceSuffix rejects a retain at or beyond the styled logical scalar length and leaves the prior base usable", () => {
  const session = openSession();
  session.handle(append("1", "doc", styled({ text: "ab" }, { text: "cd" })));

  assertOperationError(
    session.handle(replaceSuffix("2", "doc", "1", 4, [])),
    "2",
    "invalid_content_boundary",
  );
  assertOperationError(
    session.handle(replaceSuffix("3", "doc", "1", 9, [{ text: "x" }])),
    "3",
    "invalid_content_boundary",
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled({ text: "ab" }, { text: "cd" }),
  );

  assert.deepEqual(
    session.handle(replaceSuffix("4", "doc", "1", 3, [{ text: "!" }])),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled({ text: "ab" }, { text: "c" }, { text: "!" }),
  );
});

test("ReplaceSuffix requires the replacement shape to match the Block's content type and to be valid styled content", () => {
  const session = openSession();
  session.handle(append("1", "styled-block", styled({ text: "seed" })));
  session.handle(append("2", "plain-block", plain("seed")));

  assertOperationError(
    session.handle(replaceSuffix("3", "styled-block", "1", 2, " string")),
    "3",
    "invalid_content",
  );
  assertOperationError(
    session.handle(replaceSuffix("4", "plain-block", "2", 2, [{ text: " spans" }])),
    "4",
    "invalid_content",
  );
  assertOperationError(
    session.handle(replaceSuffix("5", "styled-block", "1", 2, invalidStyledSpans({ foreground: { palette: 300 } }))),
    "5",
    "invalid_content",
  );

  assert.deepEqual(
    session.handle(replaceSuffix("6", "styled-block", "1", 2, [{ text: "ed" }])),
    [],
  );
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, styled({ text: "se" }, { text: "ed" }));
  assert.deepEqual(session.context("context-1")?.blocks[1]?.content, plain("seed"));
});

test("styled content charges logical-text code units to the Block budget, styles aside, and a rejected edit leaves room for a smaller one", () => {
  const session = openSession(["text/styled"], { maxBlockCodeUnits: 5 });
  const heading = {
    text: "abc",
    style: {
      bold: true,
      foreground: { rgb: [10, 20, 30] as [number, number, number] },
      background: { palette: 4 },
    },
  };
  assert.deepEqual(session.handle(append("1", "b", styled(heading))), []);
  assert.deepEqual(
    session.handle(extend("2", "b", "1", [{ text: "de", style: { italic: true } }])),
    [],
  );

  assertOperationError(
    session.handle(extend("3", "b", "2", [{ text: "f" }])),
    "3",
    "resource_exhausted",
  );

  assert.deepEqual(
    session.handle(replaceSuffix("4", "b", "2", 4, [{ text: "!" }])),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled(heading, { text: "d", style: { italic: true } }, { text: "!" }),
  );
});

test("styled content charges the total content budget across Blocks, and shrinking an Update frees allowance", () => {
  const session = openSession(["text/styled"], { maxTotalContentCodeUnits: 6 });
  assert.deepEqual(
    session.handle(append("1", "first", styled({ text: "abcd", style: { bold: true } }))),
    [],
  );
  assertOperationError(
    session.handle(append("2", "second", styled({ text: "xyz" }))),
    "2",
    "resource_exhausted",
  );

  assert.deepEqual(session.handle(update("3", "first", styled({ text: "a" }))), []);
  assert.deepEqual(
    session.handle(append("4", "second", styled({ text: "xyz", style: { faint: true } }))),
    [],
  );
});

test("styled budgets count UTF-16 code units while suffix positions count scalars", () => {
  const session = openSession(["text/styled"], { maxBlockCodeUnits: 4 });
  // 😀 is two UTF-16 code units but one scalar: "😀ab" fills the budget.
  assert.deepEqual(
    session.handle(append("1", "b", styled({ text: "😀ab", style: { inverse: true } }))),
    [],
  );
  assertOperationError(
    session.handle(extend("2", "b", "1", [{ text: "c" }])),
    "2",
    "resource_exhausted",
  );

  assert.deepEqual(
    session.handle(replaceSuffix("3", "b", "1", 1, [{ text: "中", style: { bold: true } }])),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled({ text: "😀", style: { inverse: true } }, { text: "中", style: { bold: true } }),
  );
});

test("Update atomically switches a Block between text/plain and text/styled, and fragment shape follows the current type", () => {
  const session = openSession();
  session.handle(append("1", "b", plain("draft")));

  assert.deepEqual(
    session.handle(update("2", "b", styled({ text: "mid", style: { bold: true } }))),
    [],
  );
  assert.deepEqual(
    session.context("context-1")?.blocks[0]?.content,
    styled({ text: "mid", style: { bold: true } }),
  );
  assert.deepEqual(
    session.handle(extend("3", "b", "2", [{ text: "+", style: { italic: true } }])),
    [],
  );

  assert.deepEqual(session.handle(update("4", "b", plain("final"))), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, plain("final"));
  assertOperationError(
    session.handle(extend("5", "b", "4", [{ text: " spans" }])),
    "5",
    "invalid_content",
  );
  assert.deepEqual(session.handle(extend("6", "b", "4", " done")), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, plain("final done"));
});

test("spanDrop discards a logical-scalar prefix, truncating a boundary span and keeping its style", () => {
  const spans: StyledTextSpan[] = [
    { text: "AB", style: { bold: true } },
    { text: "C🙂D", style: { foreground: { palette: 1 } } },
    { text: "EF" },
  ];

  // The logical text is A B C 🙂 D E F: 🙂 is one scalar although it is two
  // UTF-16 code units, so dropping 4 scalars leaves D from the second span.
  assert.deepEqual(spanDrop(spans, 4), [
    { text: "D", style: { foreground: { palette: 1 } } },
    { text: "EF" },
  ]);
  assert.deepEqual(spanDrop(spans, 0), spans);
  assert.deepEqual(spanDrop(spans, 2), [
    { text: "C🙂D", style: { foreground: { palette: 1 } } },
    { text: "EF" },
  ]);
});

test("spanDrop at or beyond the total scalar count leaves an empty list, and prefix plus drop round-trips", () => {
  const spans: StyledTextSpan[] = [
    { text: "keep", style: { underline: true } },
    { text: " drop" },
  ];

  assert.deepEqual(spanDrop(spans, 9), []);
  assert.deepEqual(spanDrop(spans, 12), []);
  assert.deepEqual(spanDrop([], 3), []);

  // Recombination is exact at span boundaries; mid-span boundaries keep the
  // logical text and the boundary span's style with a split segmentation.
  for (const retain of [0, 4, 9]) {
    assert.deepEqual(
      [...spanPrefix(spans, retain), ...spanDrop(spans, retain)],
      spans,
      `prefix and suffix recombine at span boundary ${retain}`,
    );
  }
  const split = [...spanPrefix(spans, 1), ...spanDrop(spans, 1)];
  assert.equal(split.map(span => span.text).join(""), "keep drop");
  assert(split.every(span => span.style?.underline === true || span.text === " drop"));
});

function openSession(
  optionalContentTypes: readonly "text/styled"[] = ["text/styled"],
  limits: Partial<SessionResourceLimits> = {},
): TerminalProtocolSession {
  const session = new TerminalProtocolSession({
    completeBaselineSupported: true,
    optionalContentTypes,
    resourceLimits: { ...trialSessionLimits, ...limits },
  });
  session.handle({
    version: 1,
    kind: "context.open",
    request_id: "open-1",
    body: {},
  });
  return session;
}

function styled(...spans: StyledTextSpan[]): StyledTextSnapshot {
  return { type: "text/styled", data: spans };
}

function plain(data: string): PlainTextSnapshot {
  return { type: "text/plain", data };
}

function styledWithStyle(style: Record<string, unknown>): StyledTextSnapshot {
  return styled(...invalidStyledSpans(style));
}

function invalidStyledSpans(style: Record<string, unknown>): StyledTextSpan[] {
  return [{ text: "x", style: style as StyledTextStyle }];
}

function append(
  operationId: string,
  blockId: string,
  content: ContentSnapshot,
): BlockAppend {
  return {
    version: 1,
    kind: "block.append",
    operation_id: operationId,
    context_id: "context-1",
    body: { block_id: blockId, lifecycle: "mutable", content },
  };
}

function update(
  operationId: string,
  blockId: string,
  content: ContentSnapshot,
): BlockUpdate {
  return {
    version: 1,
    kind: "block.update",
    operation_id: operationId,
    context_id: "context-1",
    body: { block_id: blockId, content },
  };
}

function extend(
  operationId: string,
  blockId: string,
  baseOperationId: string,
  fragment: string | readonly StyledTextSpan[],
): BlockExtend {
  return {
    version: 1,
    kind: "block.extend",
    operation_id: operationId,
    context_id: "context-1",
    body: { block_id: blockId, base_operation_id: baseOperationId, fragment },
  };
}

function replaceSuffix(
  operationId: string,
  blockId: string,
  baseOperationId: string,
  retain: number,
  replacement: string | readonly StyledTextSpan[],
): BlockReplaceSuffix {
  return {
    version: 1,
    kind: "block.replace_suffix",
    operation_id: operationId,
    context_id: "context-1",
    body: { block_id: blockId, base_operation_id: baseOperationId, retain, replacement },
  };
}

function assertOperationError(
  messages: readonly Message[],
  operationId: string,
  code: OperationErrorCode,
): void {
  assert.deepEqual(messages, [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: operationId,
      context_id: "context-1",
      body: { code },
    },
  ]);
}
