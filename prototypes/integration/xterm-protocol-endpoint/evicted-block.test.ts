import assert from "node:assert/strict";
import test from "node:test";
import { XtermProtocolEndpoint } from "./endpoint.ts";
import {
  append, bufferRows, concatenate, createTerminal, decodeResponses, emptyResult,
  encodeInput, extend, negotiateAndOpen, replaceSuffix, update,
} from "./test-support.ts";

test("fully evicted mutable content rejects Update, Extend, and ReplaceSuffix; old identity cannot be appended again but a new Block can", async () => {
  const terminal = createTerminal({ rows: 3, scrollback: 6 });
  const endpoint = new XtermProtocolEndpoint(terminal, { completeBaselineSupported: true });
  try {
    const context = negotiateAndOpen(endpoint);
    endpoint.push(concatenate([
      encodeInput(append(context, "1", "old", "old-1\nold-2"), 1),
      encodeInput(append(context, "2", "grow", "a\nb\nc"), 2),
      encodeInput(append(context, "3", "tail", "t1\nt2\nt3", "sealed"), 3),
    ]));
    await endpoint.drain();
    endpoint.push(encodeInput(update(context, "4", "grow", "a\nb\nc\nd\ne"), 4));
    await endpoint.drain();
    assert.equal(endpoint.range(context, "old"), undefined);
    const rows = bufferRows(terminal);
    const old = endpoint.context(context)?.blocks[0];
    for (const message of [
      update(context, "5", "old", "revive"),
      extend(context, "6", "old", "1", "!"),
      replaceSuffix(context, "7", "old", "1", 1, "replacement"),
    ]) {
      assert.deepEqual(decodeResponses(endpoint.push(encodeInput(message, 5))), [{
        version: 1, kind: "protocol.error", context_id: context,
        operation_id: "operation_id" in message ? message.operation_id : "",
        body: { code: "resource_exhausted" },
      }]);
      await endpoint.drain();
      assert.deepEqual(bufferRows(terminal), rows);
      assert.deepEqual(endpoint.context(context)?.blocks[0], old);
    }
    assert.equal(old?.lifecycle, "mutable");
    const reused = decodeResponses(endpoint.push(encodeInput(append(context, "8", "old", "revive"), 8)))[0];
    assert.ok(reused?.kind === "protocol.error");
    assert.equal(reused.body.code, "block_id_reused");
    const replay = decodeResponses(endpoint.push(encodeInput(update(context, "5", "old", "revive"), 9)))[0];
    assert.ok(replay?.kind === "protocol.error");
    assert.equal(replay.body.code, "operation_id_reused");
    assert.deepEqual(endpoint.push(encodeInput(update(context, "9", "grow", "small"), 10)), emptyResult());
    await endpoint.drain();
    assert.deepEqual(endpoint.push(encodeInput(append(context, "10", "fresh", "old-1\nold-2"), 11)), emptyResult());
    await endpoint.drain();
    assert.equal(endpoint.range(context, "old"), undefined);
    assert.ok(endpoint.range(context, "fresh"));
    const stillEvicted = decodeResponses(endpoint.push(encodeInput(update(context, "11", "old", "small"), 12)))[0];
    assert.ok(stillEvicted?.kind === "protocol.error");
    assert.equal(stillEvicted.body.code, "resource_exhausted");
    assert.deepEqual(bufferRows(terminal), ["small", "t1", "t2", "t3", "old-1", "old-2", ""]);
  } finally { endpoint.dispose(); terminal.dispose(); }
});
