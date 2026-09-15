import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSdk } from "../../sdk/build.ts";

export function prepareExample(): string {
  const output = buildSdk();
  for (const file of ["application.mjs", "commands.mjs", "rounds.mjs"]) {
    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(output, file));
  }
  return join(output, "application.mjs");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(prepareExample());
}
