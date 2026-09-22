import { existsSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const python = resolve(root, ".tmp/docs-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("Set up the documentation environment first: see docs/site.md.");
  process.exit(1);
}
const mode = process.argv[2];
if (mode === "check") {
  for (const args of [["scripts/docs/test_site.py"], ["scripts/docs/check_site.py"]]) {
    const result = spawnSync(python, args, { cwd: root, stdio: "inherit", windowsHide: true });
    if (result.error || result.status !== 0) {
      if (result.error) console.error(result.error.message);
      process.exit(result.status ?? 1);
    }
  }
  process.exit(0);
}
const args = mode === "build"
  ? ["-m", "sphinx", "-b", "html", "-W", "--keep-going", "-n", "-c", "docs", "-d", ".tmp/docs-cache", ".", ".tmp/docs-site"]
  : mode === "serve"
    ? ["-m", "http.server", "4179", "--bind", "127.0.0.1", "--directory", ".tmp/docs-site"]
    : undefined;
if (!args) throw new Error("Use build, check, or serve");
if (mode === "build") {
  // A fresh output avoids retaining removed pages or old downloadable files.
  const output = resolve(root, ".tmp/docs-site");
  if (existsSync(output)) {
    if (realpathSync(output) !== resolve(realpathSync(root), ".tmp/docs-site")) {
      throw new Error("Refusing to clear redirected documentation output");
    }
    rmSync(output, { recursive: true });
  }
  args.splice(2, 0, "-a", "-E");
}
if (mode === "serve" && !existsSync(resolve(root, ".tmp/docs-site/index.html"))) {
  console.error("Build the documentation first: pnpm docs:build");
  process.exit(1);
}
const result = spawnSync(python, args, { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
