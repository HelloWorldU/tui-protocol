import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const modules = ["protocol", "sdk", "terminal"] as const;
type Module = typeof modules[number];

function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function allowed(module: Module, file: string, specifier: string): boolean {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return inside(path.join(root, module, "src"), path.resolve(path.dirname(file), specifier));
  }
  return module !== "protocol" && specifier === "@tui-protocol/protocol";
}

test("compiler-resolved source imports stay inside their module or use the permitted public protocol package", () => {
  const require = createRequire(import.meta.url);
  const compiler = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const trace = execFileSync(process.execPath,
    [compiler, "-p", "tsconfig.json", "--noEmit", "--traceResolution", "--listFilesOnly"],
    { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  // This matches the pinned compiler's resolution trace, not source-code text.
  const counts = new Map<Module, number>(modules.map(module => [module, 0]));
  for (const match of trace.matchAll(/^======== Resolving module '(.+)' from '(.+)'\. ========\r?$/gm)) {
    const [, specifier, file] = match;
    const module = modules.find(candidate => inside(path.join(root, candidate, "src"), file));
    if (!module) continue;
    counts.set(module, counts.get(module)! + 1);
    assert.ok(allowed(module, file, specifier), `${path.relative(root, file)} imports ${specifier}`);
  }
  // Fail rather than silently skip the check if compiler output changes.
  for (const module of modules) assert.ok(counts.get(module)! > 0, `resolution trace includes ${module}/src`);
});

test("dependency rules reject cross-directory source paths, private package paths, and renderer or transport dependencies", () => {
  const file = path.join(root, "sdk/src/client.ts");
  for (const specifier of [
    "../../protocol/src/index.ts",
    "../../prototypes/example.ts",
    "@tui-protocol/terminal",
    "@tui-protocol/protocol/src/message.ts",
    "node:fs",
    "@xterm/xterm",
    "node-pty",
  ]) assert.equal(allowed("sdk", file, specifier), false, specifier);
  assert.equal(allowed("sdk", file, "./internal.ts"), true);
  assert.equal(allowed("sdk", file, "@tui-protocol/protocol"), true);
  assert.equal(allowed("terminal", path.join(root, "terminal/src/index.ts"), "@tui-protocol/protocol"), true);
  assert.equal(allowed("protocol", path.join(root, "protocol/src/index.ts"), "@tui-protocol/sdk"), false);
});
