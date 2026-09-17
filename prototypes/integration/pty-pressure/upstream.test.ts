import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Explicit integration command, not part of the portable default Node suite.
test("normal and paused ConPTY reads preserve all 128 SDK Updates and report producer progress on an independent channel", { skip: process.platform !== "win32" }, () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("./upstream-probe.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    encoding: "utf8", windowsHide: true, timeout: 50_000, maxBuffer: 1024 * 1024,
  });
  const { results } = JSON.parse(output);
  assert.deepEqual(results.map((result: { pauseMs: number }) => result.pauseMs), [0, 2000]);
  for (const result of results) {
    assert.equal(result.exitCode, 0);
    assert.equal(result.validatedUpdates, 128);
    assert.equal(result.progress.index, 128);
    assert.ok(result.receivedBytes <= 8 * 1024 * 1024);
  }
  assert.equal(results[0].samples.length, 0);
  assert.equal(results[1].samples.length, 2);
  assert.ok(results[1].samples[1].atMs >= results[1].samples[0].atMs);
  assert.ok(results[1].resumeAtMs >= results[1].samples[1].atMs);
  assert.equal(results[0].progress.wireBytes, results[1].progress.wireBytes);
  // Blocking duration and which write stalls depend on the environment. They
  // are reported observations, not portable timing thresholds or pass criteria.
});
