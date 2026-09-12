import { pathToFileURL } from "node:url";
import { buildPackage } from "../scripts/build-package.ts";

export function buildSdk(): string {
  return buildPackage("sdk");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildSdk());
}
