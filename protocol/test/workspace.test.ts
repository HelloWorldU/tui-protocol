import assert from "node:assert/strict";
import test from "node:test";

test("workspace package names resolve their public entry points and reject private source subpaths", async () => {
  for (const [name, entry] of [
    ["@tui-protocol/protocol", "encodeMessageFrames"],
    ["@tui-protocol/sdk", "TuiClient"],
    ["@tui-protocol/terminal", "TerminalProtocolEndpoint"],
  ]) {
    const module = await import(name);
    assert.equal(typeof module[entry], "function");
    const privatePath = `${name}/src/index.ts`;
    await assert.rejects(import(privatePath), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  }
});
