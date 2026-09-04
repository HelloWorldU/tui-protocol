import assert from "node:assert/strict";
import test from "node:test";

import {
  append,
  bufferRows,
  concatenate,
  createMixedFixture as createFixture,
  encodeInput,
  openMixedContext as openContext,
  text,
  update,
} from "./test-support.ts";

test("one mixed chunk renders Block A, ordinary output, and Block B in order, and a later Update moves only the later history", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);

  await fixture.ingress.push(
    concatenate([
      encodeInput(append(contextId, "1", "a", "A"), 3),
      text("ordinary"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "ordinary",
    "B",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 2,
    lineCount: 1,
  });

  await fixture.ingress.push(
    encodeInput(update(contextId, "3", "a", "A1\nA2"), 5),
  );

  assert.deepEqual(bufferRows(fixture.terminal).slice(0, 5), [
    "A1",
    "A2",
    "ordinary",
    "B",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 2,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 3,
    lineCount: 1,
  });
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});

test("a second mixed-stream push cannot overtake an earlier push that is still rendering", async () => {
  const fixture = createFixture();
  const contextId = await openContext(fixture);

  const first = fixture.ingress.push(
    encodeInput(append(contextId, "1", "a", "A"), 3),
  );
  const second = fixture.ingress.push(
    concatenate([
      text("ordinary"),
      encodeInput(append(contextId, "2", "b", "B"), 4),
    ]),
  );
  await Promise.all([first, second]);

  assert.deepEqual(bufferRows(fixture.terminal), [
    "A",
    "ordinary",
    "B",
    "",
    "",
  ]);
  assert.deepEqual(fixture.endpoint.range(contextId, "a"), {
    start: 0,
    lineCount: 1,
  });
  assert.deepEqual(fixture.endpoint.range(contextId, "b"), {
    start: 2,
    lineCount: 1,
  });
  assert.deepEqual(fixture.responseFrames, []);
  assert.deepEqual(fixture.diagnostics, []);
  fixture.dispose();
});
