import assert from "node:assert/strict";
import test from "node:test";

import type {
  ContentFragment,
  LinesTextLine,
  LinesTextSnapshot,
  Message,
  OperationErrorCode,
} from "@tui-protocol/protocol";
import { contentCodeUnits, contentText } from "../src/content.ts";
import { TerminalProtocolSession, type OptionalContentType } from "../src/session.ts";

// Experimental text/lines content (RFC 0003) in the transport-independent Session.

const bullet: LinesTextLine = {
  spans: [{ text: "- item " }, { text: "bold", style: { bold: true } }],
  continuation: [{ text: "  " }],
};
const rule: LinesTextLine = { spans: [{ text: "─", style: { faint: true } }], fill: true };
const code: LinesTextLine = { spans: [{ text: "const x = 1;" }], wrap: "char" };

test("a Session advertises text/lines alongside text/styled only when configured", () => {
  const query: Message = { version: 1, kind: "capability.query", request_id: "c", body: {} };
  const response = (types: readonly OptionalContentType[]) =>
    new TerminalProtocolSession({ completeBaselineSupported: true, optionalContentTypes: types }).handle(query);
  assert.deepEqual(response(["text/styled", "text/lines"]), [{
    version: 1, kind: "capability.response", request_id: "c",
    body: { outcome: "supported", optional_content_types: ["text/styled", "text/lines"] },
  }]);
  assertOperationError(openSession(["text/styled"]).handle(append("1", "b", lines(bullet))), "1", "unsupported_content_type");
});

test("lines Append stores the lines, and the logical text joins line texts with LF, fill lines contributing one grapheme", () => {
  const session = openSession();
  const content = lines(bullet, rule, code);
  assert.deepEqual(session.handle(append("1", "b", content)), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, content);
  assert.equal(contentText(content), "- item bold\n─\nconst x = 1;");
  assert.equal(contentCodeUnits(content), 11 + 1 + 1 + 1 + 12 + 2, "separators and the continuation prefix count");
});

test("invalid lines report invalid_content: a line break in spans or continuation, an unknown wrap, or a malformed fill line", () => {
  const cases: LinesTextLine[] = [
    { spans: [{ text: "a\nb" }] },
    { spans: [{ text: "a" }], continuation: [{ text: "\r" }] },
    { spans: [{ text: "a" }], wrap: "justify" as "word" },
    { spans: [{ text: "--" }], fill: true },
    { spans: [{ text: "-" }, { text: "-" }], fill: true },
    { spans: [{ text: "-" }], fill: true, wrap: "char" },
    { spans: [{ text: "" }] },
  ];
  for (const [index, line] of cases.entries()) {
    const session = openSession();
    assertOperationError(session.handle(append(String(index + 1), "b", lines(line))), String(index + 1), "invalid_content");
    assert.deepEqual(session.context("context-1")?.blocks, [], `case ${index} created no Block`);
  }
  assert.deepEqual(openSession().handle(append("1", "b", lines({ spans: [] }))), [], "an empty line is valid");
});

test("Extend appends the first fragment line to the last line, keeping its attributes, and adds further lines", () => {
  const session = openSession();
  session.handle(append("1", "b", lines(bullet)));
  assert.deepEqual(session.handle(extend("2", "b", "1", [{ spans: [{ text: " more" }] }, code])), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, lines(
    { ...bullet, spans: [...bullet.spans, { text: " more" }] },
    code,
  ));
});

test("Extend rejects a first fragment line with attributes, text after a fill line, and a span-shaped fragment", () => {
  for (const [fragment, base] of [
    [[{ spans: [{ text: "x" }], wrap: "char" }], bullet],
    [[{ spans: [{ text: "x" }] }], rule],
    [[{ text: "x" }], bullet],
  ] as const) {
    const session = openSession();
    session.handle(append("1", "b", lines(base)));
    assertOperationError(session.handle(extend("2", "b", "1", fragment as ContentFragment)), "2", "invalid_content");
    assert.deepEqual(session.context("context-1")?.blocks[0]?.content, lines(base), "content unchanged");
  }
  const session = openSession();
  session.handle(append("1", "b", lines(rule)));
  assert.deepEqual(session.handle(extend("2", "b", "1", [{ spans: [] }, code])), [], "new lines may follow a fill line");
});

test("ReplaceSuffix counts LF separators, truncates the boundary line keeping its attributes, and continues it", () => {
  const session = openSession();
  session.handle(append("1", "b", lines(bullet, code)));
  // "- item bold\n" is 12 scalars; retain 14 keeps "co" of the code line.
  assert.deepEqual(session.handle(replaceSuffix("2", "b", "1", 14, [{ spans: [{ text: "nst y" }] }])), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, lines(bullet, { ...code, spans: [{ text: "co" }, { text: "nst y" }] }));
  // Retain exactly before the separator removes the following lines.
  assert.deepEqual(session.handle(replaceSuffix("3", "b", "2", 11, [])), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, lines(bullet));
  // Retain inside the bold span truncates it with its style.
  assert.deepEqual(session.handle(replaceSuffix("4", "b", "3", 9, [{ spans: [{ text: "!" }] }])), []);
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, lines({
    ...bullet, spans: [{ text: "- item " }, { text: "bo", style: { bold: true } }, { text: "!" }],
  }));
});

test("ReplaceSuffix rejects attributes on the continuing line and keeps the boundary rules", () => {
  const session = openSession();
  session.handle(append("1", "b", lines(bullet, code)));
  assertOperationError(session.handle(replaceSuffix("2", "b", "1", 3, [{ spans: [{ text: "x" }], fill: true }])), "2", "invalid_content");
  assertOperationError(session.handle(replaceSuffix("3", "b", "1", 24, [])), "3", "invalid_content_boundary");
  assert.deepEqual(session.context("context-1")?.blocks[0]?.content, lines(bullet, code));
});

test("Update switches a Block between text/lines and text/styled", () => {
  const session = openSession();
  session.handle(append("1", "b", { type: "text/styled", data: [{ text: "a" }] }));
  assert.deepEqual(session.handle(update("2", "b", lines(code))), []);
  assert.deepEqual(session.handle(update("3", "b", { type: "text/styled", data: [{ text: "b" }] })), []);
  assert.equal(session.context("context-1")?.blocks[0]?.content.type, "text/styled");
});

function openSession(types: readonly OptionalContentType[] = ["text/styled", "text/lines"]): TerminalProtocolSession {
  const session = new TerminalProtocolSession({ completeBaselineSupported: true, optionalContentTypes: types });
  session.handle({ version: 1, kind: "context.open", request_id: "open-1", body: {} });
  return session;
}

function lines(...data: LinesTextLine[]): LinesTextSnapshot {
  return { type: "text/lines", data };
}

function append(operationId: string, blockId: string, content: Extract<Message, { kind: "block.append" }>["body"]["content"]): Message {
  return {
    version: 1, kind: "block.append", operation_id: operationId, context_id: "context-1",
    body: { block_id: blockId, lifecycle: "mutable", content },
  };
}

function update(operationId: string, blockId: string, content: Extract<Message, { kind: "block.update" }>["body"]["content"]): Message {
  return { version: 1, kind: "block.update", operation_id: operationId, context_id: "context-1", body: { block_id: blockId, content } };
}

function extend(operationId: string, blockId: string, base: string, fragment: ContentFragment): Message {
  return {
    version: 1, kind: "block.extend", operation_id: operationId, context_id: "context-1",
    body: { block_id: blockId, base_operation_id: base, fragment },
  };
}

function replaceSuffix(operationId: string, blockId: string, base: string, retain: number, replacement: ContentFragment): Message {
  return {
    version: 1, kind: "block.replace_suffix", operation_id: operationId, context_id: "context-1",
    body: { block_id: blockId, base_operation_id: base, retain, replacement },
  };
}

function assertOperationError(messages: readonly Message[], operationId: string, code: OperationErrorCode): void {
  assert.deepEqual(messages, [{
    version: 1, kind: "protocol.error", operation_id: operationId, context_id: "context-1", body: { code },
  }]);
}
