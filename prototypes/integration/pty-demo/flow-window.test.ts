import assert from "node:assert/strict";
import test from "node:test";
import { FlowWindow } from "./flow-window.ts";

test("host pauses at the high byte watermark, resumes at the low watermark, and permits the final chunk to overshoot", () => {
  const window = new FlowWindow(16, 4);
  assert.equal(window.add(10), false);
  assert.equal(window.add(10), true);
  assert.equal(window.peak, 20);
  assert.equal(window.add(2), false);
  assert.equal(window.acknowledge(17), false);
  assert.equal(window.acknowledge(18), true);
  assert.equal(window.acknowledge(18), false);
  assert.equal(window.acknowledge(22), false);
  assert.equal(window.outstanding, 0);
  assert.equal(window.pauses, 1); assert.equal(window.resumes, 1);
});

test("invalid or regressing consumed offsets do not grant host flow credit", () => {
  const window = new FlowWindow(16, 4);
  window.add(20); window.acknowledge(8);
  for (const value of [-1, 7, 21, 8.5, NaN, Infinity]) {
    assert.throws(() => window.acknowledge(value), /Invalid consumed offset/);
    assert.equal(window.consumed, 8);
    assert.equal(window.paused, true);
  }
  for (const [high, low] of [[0, 0], [4, 4], [4, -1], [4.5, 1]]) {
    assert.throws(() => new FlowWindow(high!, low!), /Invalid flow watermarks/);
  }
});
