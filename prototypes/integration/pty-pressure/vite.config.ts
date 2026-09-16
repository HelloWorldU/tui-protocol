import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { buildSdk } from "../../../sdk/build.ts";
import { createPtyHost } from "../pty-demo/vite.config.ts";

export default defineConfig(({ command }) => {
  let host = {};
  if (command === "serve") {
    const output = buildSdk();
    const producer = join(output, "pressure-producer.mjs");
    copyFileSync(fileURLToPath(new URL("./producer.mjs", import.meta.url)), producer);
    host = createPtyHost(producer, true, { high: 16_384, low: 4096 });
  }
  return { ...host, root: fileURLToPath(new URL(".", import.meta.url)) };
});
