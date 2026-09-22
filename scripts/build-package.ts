import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Emit a self-contained local distribution; never rely on workspace symlinks. */
export function buildPackage(module: "sdk" | "terminal"): string {
  const scratch = join(root, ".tmp");
  mkdirSync(scratch, { recursive: true });
  const output = mkdtempSync(join(scratch, `${module}-build-`));
  const require = createRequire(import.meta.url);
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  execFileSync(process.execPath, [compiler, "-p", join(root, module, "tsconfig.build.json"), "--outDir", output],
    { cwd: root, stdio: "inherit", windowsHide: true });
  const dependency = join(output, "node_modules", "@tui-protocol", "protocol");
  mkdirSync(dirname(dependency), { recursive: true });
  renameSync(join(output, "protocol"), dependency);
  writeFileSync(join(dependency, "package.json"), JSON.stringify({
    name: "@tui-protocol/protocol", version: "0.0.0", private: true, type: "module", license: "Apache-2.0",
    exports: { ".": { types: "./src/index.d.ts", import: "./src/index.js" } },
  }, null, 2) + "\n");
  copyFileSync(join(root, "LICENSE"), join(dependency, "LICENSE"));
  // Retain the existing distribution's ./protocol export through a package import.
  for (const extension of ["js", "d.ts"]) {
    writeFileSync(join(output, `protocol.${extension}`), 'export * from "@tui-protocol/protocol";\n');
  }
  writeFileSync(join(output, "package.json"), JSON.stringify({
    name: `@tui-protocol/${module}`, version: "0.0.0", private: true, type: "module", license: "Apache-2.0",
    exports: {
      ".": { types: `./${module}/src/index.d.ts`, import: `./${module}/src/index.js` },
      "./protocol": { types: "./protocol.d.ts", import: "./protocol.js" },
    },
    dependencies: { "@tui-protocol/protocol": "0.0.0" },
    bundledDependencies: ["@tui-protocol/protocol"],
  }, null, 2) + "\n");
  copyFileSync(join(root, "LICENSE"), join(output, "LICENSE"));
  return output;
}
