import { pathToFileURL } from "node:url";
import { buildPackage } from "../scripts/build-package.ts";

export function buildTerminal(): string {
  return buildPackage("terminal");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildTerminal());
}
