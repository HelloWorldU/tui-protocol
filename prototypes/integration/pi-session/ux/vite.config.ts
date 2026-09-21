import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { comparisonServer } from "./server.ts";

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
  plugins: command === "serve" ? [comparisonServer()] : [],
}));
