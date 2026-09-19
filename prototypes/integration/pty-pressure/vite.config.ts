import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { buildSdk } from "../../../sdk/build.ts";
import { createPtyHost } from "../pty-demo/vite.config.ts";
import { workloads } from "./workload.ts";

export default defineConfig(({ command, mode }) => {
  const workload = mode === "stalled" ? workloads.stalled : mode === "composed" ? workloads.composed : workloads.small;
  let host = {};
  if (command === "serve") {
    const output = buildSdk();
    const producer = join(output, "pressure-producer.mjs");
    copyFileSync(fileURLToPath(new URL("./producer.mjs", import.meta.url)), producer);
    writeFileSync(join(output, "workload.json"), JSON.stringify(workload));
    host = createPtyHost(producer, true, { high: 16_384, low: 4096, stallMs: 5000 });
  }
  return { ...host, root: fileURLToPath(new URL(".", import.meta.url)),
    define: { __WORKLOAD__: JSON.stringify(workload) } };
});
