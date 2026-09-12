import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSdk } from "../../sdk/build.ts";

export function prepareExample(): string {
  const output = buildSdk();
  const entry = join(output, "streaming-text.mjs");
  copyFileSync(fileURLToPath(new URL("./main.mjs", import.meta.url)), entry);
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(prepareExample());
}
