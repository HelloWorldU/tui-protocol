import assert from "node:assert/strict";
import test from "node:test";
import { measurePressure } from "./probe.ts";

for (const extensions of [16, 64, 256]) {
  test(`${extensions} SDK Extends accumulate behind a stalled renderer; waiting every eight or one limits local outstanding pushes and preserves final text`, { timeout: 30_000 }, async () => {
    const burst = await measurePressure(extensions, extensions);
    const batches = await measurePressure(extensions, 8);
    const single = await measurePressure(extensions, 1);
    assert.equal(burst.peakUnsettledPushes, extensions);
    assert.equal(batches.peakUnsettledPushes, 8);
    assert.equal(single.peakUnsettledPushes, 1);
    assert.equal(burst.submittedBytes, batches.submittedBytes);
    assert.equal(burst.submittedBytes, single.submittedBytes);
    assert.equal(burst.peakUnsettledBytes, burst.submittedBytes);
    assert.ok(burst.peakUnsettledBytes > batches.peakUnsettledBytes);
    assert.ok(batches.peakUnsettledBytes > single.peakUnsettledBytes);
    for (const result of [burst, batches, single]) {
      assert.equal(result.completed, extensions);
      assert.equal(result.remainingPushes, 0);
      assert.equal(result.remainingBytes, 0);
    }
  });
}
