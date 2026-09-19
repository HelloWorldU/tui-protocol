import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildTerminal } from "../build.ts";
import { buildSdk } from "../../sdk/build.ts";

test("built terminal and TUI modules exchange all five Operations outside the checkout, and external adapter types resolve", t => {
  const output = buildTerminal();
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const sdk = buildSdk();
  t.after(() => rmSync(sdk, { recursive: true, force: true }));
  const isolated = mkdtempSync(join(tmpdir(), "tui-terminal-artifact-"));
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  const artifact = join(isolated, "node_modules", "@tui-protocol/terminal");
  cpSync(output, artifact, { recursive: true });
  cpSync(sdk, join(isolated, "node_modules", "@tui-protocol/sdk"), { recursive: true });
  const entries = readdirSync(artifact, { recursive: true, withFileTypes: true });
  assert(entries.every(entry => !entry.isSymbolicLink()));
  const files = entries.filter(entry => entry.isFile());
  assert.equal(files.filter(entry => entry.name.endsWith(".js")).length, 10);
  assert.equal(files.filter(entry => entry.name.endsWith(".d.ts")).length, 10);
  assert(files.every(entry => /\.(js|d\.ts)$/.test(entry.name) || ["package.json", "LICENSE"].includes(entry.name)));
  const result = execFileSync(process.execPath, ["--no-experimental-strip-types", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { TuiClient } from '@tui-protocol/sdk';
    import { TerminalProtocolEndpoint, trialSessionLimits, PendingInputBudget } from '@tui-protocol/terminal';
    const budget = new PendingInputBudget(16, 2); budget.acquire(16)();
    const accepted = [];
    const errors = [];
    // Host assertion for an in-memory test adapter, not real terminal support.
    const endpoint = new TerminalProtocolEndpoint({completeBaselineSupported:true, resourceLimits:trialSessionLimits, operationAdapter:{
      prepare(operation) { return operation.kind === 'block.update' && operation.body.content.data === 'too large'
        ? 'resource_exhausted' : undefined; },
      accept(operation) { accepted.push(operation.kind); }
    }});
    const client = new TuiClient({write(bytes) {
      for (const byte of bytes) {
        const result = endpoint.push(Uint8Array.of(byte));
        assert.equal(result.diagnostics.length, 0);
        for (const frame of result.responseFrames) {
          for (const event of client.receive(frame)) {
            if (event.type === 'message' && event.message.kind === 'protocol.error') errors.push(event.message.body.code);
          }
        }
      }
    }});
    try {
      assert.equal(await client.negotiate(), true);
      const context = await client.openContext();
      let base = context.append('b', 'a', 'mutable');
      base = context.extend('b', base, 'bc');
      context.replaceSuffix('b', base, 1, 'Z');
      assert.equal(endpoint.context(context.id).blocks[0].content.data, 'aZ');
      context.update('b', 'too large');
      assert.equal(endpoint.context(context.id).blocks[0].content.data, 'aZ');
      context.update('b', 'done');
      context.seal('b');
      context.update('b', 'forbidden');
      assert.deepEqual(errors, ['resource_exhausted', 'block_sealed']);
      assert.deepEqual(accepted, ['block.append','block.extend','block.replace_suffix','block.update','block.seal']);
      await context.close();
      assert.equal(endpoint.context(context.id).state, 'closed');
      assert.equal(endpoint.context(context.id).blocks[0].content.data, 'done');
      endpoint.finish();
      console.log('isolated terminal and TUI exchange passed');
    } finally { client.dispose(); }
  `], { cwd: isolated, encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" } });
  assert.equal(result.trim(), "isolated terminal and TUI exchange passed");
  writeFileSync(join(isolated, "consumer.mts"), `
    import { TerminalProtocolEndpoint, type TerminalOperationAdapter } from '@tui-protocol/terminal';
    import { type Message } from '@tui-protocol/terminal/protocol';
    const adapter: TerminalOperationAdapter = {prepare() {return undefined;}, accept(operation) {}};
    const endpoint = new TerminalProtocolEndpoint({completeBaselineSupported: false, operationAdapter:adapter});
    const invalid: TerminalOperationAdapter = {
      // @ts-expect-error adapter rejection codes are not arbitrary strings
      prepare() { return 'not_an_error_code'; }, accept() {}
    };
    const query: Message = {version:1,kind:'capability.query',request_id:'1',body:{}};
  `);
  writeFileSync(join(isolated, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "NodeNext", target: "ES2022", strict: true, noEmit: true, types: [] },
    files: ["consumer.mts"],
  }));
  const require = createRequire(import.meta.url);
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  execFileSync(process.execPath, [compiler, "-p", join(isolated, "tsconfig.json")],
    { cwd: isolated, stdio: "pipe", windowsHide: true, timeout: 15_000 });
});
