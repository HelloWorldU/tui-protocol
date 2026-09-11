import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Build into a fresh directory so previous output cannot mask missing files. */
export function buildSdk(): string {
  const scratch = join(root, ".tmp");
  mkdirSync(scratch, { recursive: true });
  const output = mkdtempSync(join(scratch, "sdk-build-"));
  const require = createRequire(import.meta.url);
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  execFileSync(process.execPath, [compiler, "-p", join(root, "sdk", "tsconfig.build.json"), "--outDir", output],
    { cwd: root, stdio: "inherit", windowsHide: true });
  writeFileSync(join(output, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    exports: {
      ".": { types: "./sdk/src/index.d.ts", import: "./sdk/src/index.js" },
      "./protocol": { types: "./protocol/src/index.d.ts", import: "./protocol/src/index.js" },
    },
  }, null, 2) + "\n");
  copyFileSync(join(root, "LICENSE"), join(output, "LICENSE"));
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildSdk());
}
