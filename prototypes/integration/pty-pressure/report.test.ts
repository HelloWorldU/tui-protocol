import assert from "node:assert/strict";
import test from "node:test";
import { readProducerReport, intervalOverlap } from "./report.ts";

const report = { updates: 128, drainWaits: 0,
  longestWrite: { index: 6, durationMs: 1998.2, startedAt: 1000, endedAt: 2998 } };

test("producer timing JSON survives terminal soft wraps, including its nested write record", () => {
  const text = `PRODUCER:${JSON.stringify(report)}`;
  for (const width of [10, 40, 80]) {
    const rows = ["prior content"];
    for (let index = 0; index < text.length; index += width) rows.push(text.slice(index, index + width));
    rows.push("");
    assert.deepEqual(readProducerReport(rows, 128), report);
  }
});

test("missing, duplicated, truncated, and mismatched producer reports fail instead of yielding timing evidence", () => {
  const text = `PRODUCER:${JSON.stringify(report)}`;
  for (const rows of [["no report"], [text, text], [text.slice(0, -1)]]) {
    assert.throws(() => readProducerReport(rows, 128));
  }
  assert.throws(() => readProducerReport([text], 256));
  assert.throws(() => readProducerReport([`PRODUCER:${JSON.stringify({ ...report, longestWrite: { ...report.longestWrite, durationMs: -1 } })}`], 128));
});

test("write and hold intervals report their shared time without turning a non-overlap into evidence", () => {
  assert.equal(intervalOverlap(1000, 2998, 1010, 3010), 1988);
  assert.equal(intervalOverlap(1, 10, 11, 20), 0);
  assert.equal(intervalOverlap(1, 10, 10, 20), 0);
  assert.throws(() => intervalOverlap(10, 1, 0, 20));
});
