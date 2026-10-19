import assert from "node:assert/strict";
import test from "node:test";

import { MessageCodecError, deserializeMessage, serializeMessage, type Message } from "../src/index.ts";

// Experimental text/lines content (RFC 0003): codec structure only; content
// rules such as wrap values and fill graphemes are the terminal's to enforce.

test("text/lines snapshots, line fragments, and line replacements round-trip through serialization", () => {
  const messages: Message[] = [
    {
      version: 1, kind: "block.append", operation_id: "1", context_id: "ctx",
      body: {
        block_id: "b", lifecycle: "mutable",
        content: {
          type: "text/lines",
          data: [
            { spans: [{ text: "- item" }], continuation: [{ text: "  " }] },
            { spans: [{ text: "│ ", style: { faint: true } }, { text: "quote" }], continuation: [{ text: "│ ", style: { faint: true } }] },
            { spans: [{ text: "code" }], wrap: "char" },
            { spans: [{ text: "─" }], fill: true },
            { spans: [] },
          ],
        },
      },
    },
    {
      version: 1, kind: "block.extend", operation_id: "2", context_id: "ctx",
      body: { block_id: "b", base_operation_id: "1", fragment: [{ spans: [{ text: " more" }] }, { spans: [{ text: "next" }], wrap: "word" }] },
    },
    {
      version: 1, kind: "block.replace_suffix", operation_id: "3", context_id: "ctx",
      body: { block_id: "b", base_operation_id: "2", retain: 3, replacement: [{ spans: [{ text: "x" }] }] },
    },
  ];
  for (const message of messages) {
    assert.deepEqual(deserializeMessage(serializeMessage(message)), message);
  }
});

test("text/lines content with structural violations is rejected with its Operation identity", () => {
  const cases = [
    '{"type":"text/lines","data":"x"}',
    '{"type":"text/lines","data":[{}]}',
    '{"type":"text/lines","data":[{"spans":"x"}]}',
    '{"type":"text/lines","data":[{"spans":[],"extra":1}]}',
    '{"type":"text/lines","data":[{"spans":[],"wrap":1}]}',
    '{"type":"text/lines","data":[{"spans":[],"continuation":"  "}]}',
    '{"type":"text/lines","data":[{"spans":[],"fill":"yes"}]}',
    '{"type":"text/lines","data":[{"spans":[{"text":"x","extra":1}]}]}',
  ];
  for (const content of cases) {
    const error = capture(
      `{"version":1,"kind":"block.append","operation_id":"lines-invalid","context_id":"ctx","body":{"block_id":"b","lifecycle":"mutable","content":${content}}}`,
    );
    assert.equal(error.code, "invalid_schema", content);
    assert.deepEqual(error.identity, { category: "operation", kind: "block.append", operation_id: "lines-invalid", context_id: "ctx" });
  }
});

test("a fragment whose first element is a line is validated as lines, so mixing lines and spans is a schema error", () => {
  const mixed = capture(
    '{"version":1,"kind":"block.extend","operation_id":"op","context_id":"ctx","body":{"block_id":"b","base_operation_id":"1","fragment":[{"spans":[]},{"text":"x"}]}}',
  );
  assert.equal(mixed.code, "invalid_schema");
  const empty = capture(
    '{"version":1,"kind":"block.extend","operation_id":"op","context_id":"ctx","body":{"block_id":"b","base_operation_id":"1","fragment":[]}}',
  );
  assert.equal(empty.code, "invalid_schema", "an Extend fragment stays non-empty");
});

function capture(source: string): MessageCodecError {
  try {
    deserializeMessage(new TextEncoder().encode(source));
  } catch (error: unknown) {
    assert.ok(error instanceof MessageCodecError);
    return error;
  }
  throw new Error("Expected Message decoding to fail.");
}
