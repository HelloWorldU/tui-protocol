import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createPtyHost } from "../pty-demo/vite.config.ts";

export default defineConfig(({ command }) => ({
  ...(command === "serve" ? createPtyHost(fileURLToPath(new URL("./main.ts", import.meta.url))) : {}),
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { rolldownOptions: { input: {
    trial: fileURLToPath(new URL("./index.html", import.meta.url)),
    checks: fileURLToPath(new URL("./checks.html", import.meta.url)),
  } } },
}));
