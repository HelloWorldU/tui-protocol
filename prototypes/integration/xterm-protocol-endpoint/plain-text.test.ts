import assert from "node:assert/strict";
import test from "node:test";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import {
  append, bufferRows, createTerminal, emptyResult, encodeInput,
  extend, negotiateAndOpen, replaceSuffix, update,
} from "./test-support.ts";

test("Block CR, LF, and CRLF render as line breaks while Session keeps the original text", async () => {
  const terminal = createTerminal({ cols: 40, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    const content = "one\rtwo\r\nthree\nfour";
    assert.deepEqual(endpoint.push(encodeInput(append(context, "1", "text", content, "mutable"), 3)), emptyResult());
    await endpoint.drain();
    assert.deepEqual(bufferRows(terminal), ["one", "two", "three", "four", ""]);
    assert.equal(endpoint.context(context)?.blocks[0]?.content.data, content);
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("Block escape, bell, backspace, DEL, and C1 bytes render visible labels without executing controls", async () => {
  const terminal = createTerminal({ cols: 120, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  const responses: string[] = [];
  const registration = terminal.onData(value => responses.push(value));
  try {
    const context = negotiateAndOpen(endpoint);
    const content = "a\x1b[2J\x1b[6n\x07\x08\x7f\x9b2Jz";
    assert.deepEqual(endpoint.push(encodeInput(append(context, "1", "text", content, "mutable"), 3)), emptyResult());
    await endpoint.drain();
    assert.equal(bufferRows(terminal)[0], "a<U+001B>[2J<U+001B>[6n<U+0007><U+0008><U+007F><U+009B>2Jz");
    assert.deepEqual(responses, []);
    assert.equal(endpoint.context(context)?.state, "open");
  } finally { registration.dispose(); endpoint.dispose(); terminal.dispose(); }
});

test("Append, Extend, ReplaceSuffix, and Update all project text without changing raw scalar positions", async () => {
  const terminal = createTerminal({ cols: 40, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    const messages = [
      append(context, "1", "text", "a\x1bX", "mutable"),
      extend(context, "2", "text", "1", "\tY"),
      replaceSuffix(context, "3", "text", "2", 2, "\rZ"),
      update(context, "4", "text", "p\tq"),
    ];
    const expected = ["a<U+001B>X", "a<U+001B>X      Y", "a<U+001B>", "p       q"];
    for (const [index, message] of messages.entries()) {
      assert.deepEqual(endpoint.push(encodeInput(message, index + 3)), emptyResult());
      await endpoint.drain();
      assert.equal(bufferRows(terminal)[0], expected[index]);
      if (index === 2) {
        assert.equal(bufferRows(terminal)[1], "Z");
        assert.equal(endpoint.context(context)?.blocks[0]?.content.data, "a\x1b\rZ");
      }
    }
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("a CRLF split between Append and Extend remains one line break after projection", async () => {
  const terminal = createTerminal({ cols: 20, rows: 3 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    endpoint.push(encodeInput(append(context, "1", "text", "a\r", "mutable"), 3));
    await endpoint.drain();
    assert.deepEqual(endpoint.push(encodeInput(extend(context, "2", "text", "1", "\nb"), 4)), emptyResult());
    await endpoint.drain();
    assert.deepEqual(bufferRows(terminal).slice(0, 3), ["a", "b", ""]);
    assert.equal(endpoint.context(context)?.blocks[0]?.content.data, "a\r\nb");
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("the host tab width is used consistently by Append and Update", async () => {
  const terminal = createTerminal({ cols: 20, rows: 3 });
  terminal.options.tabStopWidth = 4;
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    endpoint.push(encodeInput(append(context, "1", "text", "a\tb", "mutable"), 3));
    await endpoint.drain();
    assert.equal(bufferRows(terminal)[0], "a   b");
    assert.deepEqual(endpoint.push(encodeInput(update(context, "2", "text", "xy\tz"), 4)), emptyResult());
    await endpoint.drain();
    assert.equal(bufferRows(terminal)[0], "xy  z");
  } finally { endpoint.dispose(); terminal.dispose(); }
});

test("Chinese plus Tab renders through all content Operations and ReplaceSuffix still counts raw scalars", async () => {
  const terminal = createTerminal({ cols: 9, rows: 4 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    const messages = [
      append(context, "1", "text", "中文\t结果"),
      extend(context, "2", "text", "1", "好"),
      replaceSuffix(context, "3", "text", "2", 3, "新"),
      update(context, "4", "text", "中\t文"),
    ];
    const raw = ["中文\t结果", "中文\t结果好", "中文\t新", "中\t文"];
    const rows = [["中文    ", "结果"], ["中文    ", "结果好"], ["中文    ", "新"], ["中      ", "文"]];
    for (const [index, message] of messages.entries()) {
      assert.deepEqual(endpoint.push(encodeInput(message, index + 3)), emptyResult());
      await endpoint.drain();
      assert.deepEqual(bufferRows(terminal).slice(0, 2), rows[index]);
      assert.equal(endpoint.context(context)?.blocks[0]?.content.data, raw[index]);
    }
  } finally { endpoint.dispose(); terminal.dispose(); }
});
