import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourcePackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as Record<string, unknown>;
const output = new URL("../../../.tmp/tabby-demo-plugin/", import.meta.url);
const {
  dependencies: _dependencies,
  devDependencies: _devDependencies,
  ...metadata
} = sourcePackage;
writeFileSync(new URL("package.json", output), JSON.stringify({
  ...metadata,
  type: "commonjs",
  main: "index.js",
}, null, 2) + "\n");
copyFileSync(fileURLToPath(new URL("./README.md", import.meta.url)), fileURLToPath(new URL("README.md", output)));
copyFileSync(fileURLToPath(new URL("../../../LICENSE", import.meta.url)), fileURLToPath(new URL("LICENSE", output)));
console.log(fileURLToPath(output));
