import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { prepareExample } from "./prepare.ts";

test("the prepared example runs outside the checkout and emits only readable fallback when output is redirected", t => {
  const prepared = dirname(prepareExample());
  t.after(() => rmSync(prepared, { recursive: true, force: true }));
  const isolated = mkdtempSync(join(tmpdir(), "tui-streaming-example-"));
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  cpSync(prepared, isolated, { recursive: true });
  const output = execFileSync(process.execPath, ["--no-experimental-strip-types", join(isolated, "streaming-text.mjs")], {
    cwd: isolated, encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
  });
  assert.equal(output, "[fallback] Thinking\r\nReading input\r\nChecking details\r\nPreparing answer\r\nResult: the example completed.\r\n");
  assert(!output.includes("\x1b"));
});
