import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildSdk } from "../build.ts";

test("built JavaScript negotiates and sends an Operation outside the checkout without TypeScript or prototypes", t => {
  const output = buildSdk();
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const isolated = mkdtempSync(join(tmpdir(), "tui-sdk-artifact-"));
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  const artifact = join(isolated, "node_modules", "@tui-protocol/sdk");
  cpSync(output, artifact, { recursive: true });
  const entries = readdirSync(artifact, { recursive: true, withFileTypes: true });
  assert(entries.every(entry => !entry.isSymbolicLink()));
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
  assert.equal(files.filter(name => name.endsWith(".js")).length, 7);
  assert.equal(files.filter(name => name.endsWith(".d.ts")).length, 7);
  assert(files.every(name => name.endsWith(".js") || name.endsWith(".d.ts") || name === "package.json" || name === "LICENSE"));
  const manifest = JSON.parse(readFileSync(join(artifact, "package.json"), "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.name, "@tui-protocol/sdk");
  const result = execFileSync(process.execPath, ["--input-type=module", "--no-experimental-strip-types", "-e", `
    import assert from 'node:assert/strict';
    import { TuiClient } from '@tui-protocol/sdk';
    import { ProtocolStreamDecoder, encodeMessageFrames } from '@tui-protocol/sdk/protocol';
    const decoder = new ProtocolStreamDecoder();
    const sent = [];
    const client = new TuiClient({write(bytes) {
      for (const event of decoder.push(bytes)) {
        assert.equal(event.type, 'message');
        sent.push(event.message);
      }
    }});
    let frame = 0;
    function response(message) {
      for (const bytes of encodeMessageFrames(message, ++frame)) client.receive(bytes);
    }
    try {
      const support = client.negotiate();
      response({version:1, kind:'capability.response', request_id:sent.at(-1).request_id,
        body:{outcome:'supported',optional_content_types:[]}});
      assert.equal(await support, true);
      const opening = client.openContext();
      response({version:1, kind:'context.open.response', request_id:sent.at(-1).request_id,
        context_id:'artifact-context',body:{outcome:'opened'}});
      const context = await opening;
      const id = context.append('greeting','hello','sealed');
      assert.deepEqual(sent.at(-1), {version:1,kind:'block.append',context_id:'artifact-context',operation_id:id,
        body:{block_id:'greeting',lifecycle:'sealed',content:{type:'text/plain',data:'hello'}}});
      const closing = context.close();
      response({version:1,kind:'context.close.response',request_id:sent.at(-1).request_id,
        context_id:'artifact-context',body:{outcome:'closed'}});
      await closing;
      console.log('isolated SDK JavaScript passed');
    } finally { client.dispose(); }
  `], { cwd: isolated, encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" } });
  assert.equal(result.trim(), "isolated SDK JavaScript passed");
});

test("an external TypeScript consumer resolves built declarations and rejects invalid lifecycle arguments", t => {
  const output = buildSdk();
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const isolated = mkdtempSync(join(tmpdir(), "tui-sdk-types-"));
  t.after(() => rmSync(isolated, { recursive: true, force: true }));
  cpSync(output, join(isolated, "node_modules", "@tui-protocol/sdk"), { recursive: true });
  writeFileSync(join(isolated, "consumer.mts"), `
    import { TuiClient, type TuiContext } from '@tui-protocol/sdk';
    import { type Message } from '@tui-protocol/sdk/protocol';
    const client = new TuiClient({write(bytes) { const accepted: Uint8Array = bytes; }});
    const support: Promise<boolean> = client.negotiate();
    function use(context: TuiContext): string {
      // @ts-expect-error lifecycle is not an arbitrary string
      context.append('b', 'text', 'invalid');
      return context.append('b', 'text', 'sealed');
    }
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
