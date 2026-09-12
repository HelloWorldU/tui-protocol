import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createPtyHost } from "../../prototypes/integration/pty-demo/vite.config.ts";
import { prepareExample } from "../streaming-text/prepare.ts";

// Development transport only: the browser receives bytes from a fixed child.
export default defineConfig(({ command }) => ({
  ...(command === "serve" ? createPtyHost(prepareExample(), true) : {}),
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: { rolldownOptions: { input: {
    example: fileURLToPath(new URL("./index.html", import.meta.url)),
    checks: fileURLToPath(new URL("./checks.html", import.meta.url)),
  } } },
}));
