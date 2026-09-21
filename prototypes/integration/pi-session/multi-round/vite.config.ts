import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createPtyHost } from "../../pty-demo/vite.config.ts";
import { livePage } from "./page-mode.ts";

export default defineConfig(({ command, mode }) => {
  const live = mode === "live";
  const host = command === "serve" ? createPtyHost(fileURLToPath(new URL(live ? "./main-live.ts" : "./main.ts", import.meta.url))) : {};
  return { ...host, root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [...(host.plugins ?? []), { name: "multi-round-source-label", transformIndexHtml(html, context) {
      return live ? livePage(html, context.path) : html;
    } }],
    build: { rolldownOptions: { input: { trial: fileURLToPath(new URL("./index.html", import.meta.url)),
      checks: fileURLToPath(new URL("./checks.html", import.meta.url)) } } },
  };
});
