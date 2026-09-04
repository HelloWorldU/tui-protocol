import assert from "node:assert/strict";
import test from "node:test";

import { XtermProtocolEndpoint } from "./endpoint.ts";
import {
  append,
  bufferRows,
  concatenate,
  createTerminal,
  decodeResponses,
  emptyResult,
  encodeInput,
  negotiateAndOpen,
  openEndpointContext as openContext,
  requiredRange,
  update,
} from "./test-support.ts";

test("the same Block ID in two Contexts produces separate rendered ranges, and updating one leaves the other unchanged", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const firstContextId = negotiateAndOpen(endpoint);
  const secondContextId = openContext(endpoint, "open-2", 3);

  assert.deepEqual(
    endpoint.push(
      concatenate([
        encodeInput(
          append(firstContextId, "1", "shared", "first", "mutable"),
          4,
        ),
        encodeInput(
          append(secondContextId, "1", "shared", "second", "mutable"),
          5,
        ),
      ]),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.deepEqual(requiredRange(endpoint, firstContextId, "shared"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(requiredRange(endpoint, secondContextId, "shared"), {
    start: 1,
    lineCount: 1,
  });

  assert.deepEqual(
    endpoint.push(
      encodeInput(update(firstContextId, "2", "shared", "changed"), 6),
    ),
    emptyResult(),
  );
  await endpoint.drain();

  assert.equal(
    endpoint.context(firstContextId)?.blocks[0]?.content.data,
    "changed",
  );
  assert.equal(
    endpoint.context(secondContextId)?.blocks[0]?.content.data,
    "second",
  );
  assert.deepEqual(bufferRows(xterm), ["changed", "second", ""]);

  endpoint.dispose();
  xterm.dispose();
});

test("Append and Update bytes in one input chunk are planned in order and render the updated Block", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  const result = endpoint.push(
    concatenate([
      encodeInput(append(contextId, "1", "thinking", "draft", "mutable"), 3),
      encodeInput(
        append(
          contextId,
          "2",
          "tail",
          "tail-1\ntail-2\ntail-3",
          "sealed",
        ),
        4,
      ),
      encodeInput(update(contextId, "3", "thinking", "complete"), 5),
    ]),
  );

  assert.deepEqual(result, emptyResult());
  await endpoint.drain();
  assert.equal(
    endpoint.context(contextId)?.blocks[0]?.content.data,
    "complete",
  );
  assert.deepEqual(bufferRows(xterm), [
    "complete",
    "tail-1",
    "tail-2",
    "tail-3",
    "",
  ]);

  endpoint.dispose();
  xterm.dispose();
});

test("a sealed-Block Update returns protocol.error bytes and leaves rendered xterm history unchanged", async () => {
  const xterm = createTerminal();
  const endpoint = new XtermProtocolEndpoint(xterm, {
    completeBaselineSupported: true,
  });
  const contextId = negotiateAndOpen(endpoint);

  endpoint.push(
    encodeInput(append(contextId, "1", "answer", "complete", "sealed"), 3),
  );
  await endpoint.drain();
  const before = bufferRows(xterm);

  const rejected = endpoint.push(
    encodeInput(update(contextId, "2", "answer", "too late"), 4),
  );
  await endpoint.drain();

  assert.deepEqual(decodeResponses(rejected), [
    {
      version: 1,
      kind: "protocol.error",
      operation_id: "2",
      context_id: contextId,
      body: { code: "block_sealed" },
    },
  ]);
  assert.deepEqual(bufferRows(xterm), before);
  assert.equal(endpoint.context(contextId)?.blocks[0]?.content.data, "complete");

  endpoint.dispose();
  xterm.dispose();
});
