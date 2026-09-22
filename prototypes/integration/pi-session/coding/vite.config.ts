import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createPtyHost } from "../../pty-demo/vite.config.ts";

export default defineConfig(({ command, mode }) => {
  const live = mode === "live";
  const host = command === "serve" ? createPtyHost(fileURLToPath(new URL(live ? "./main-live.ts" : "./main.ts", import.meta.url))) : {};
  return { ...host, root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [...(host.plugins ?? []), { name: "coding-source-label", transformIndexHtml(html) {
      if (!live) return html;
      if (!html.includes('data-source="fixture"') || !html.includes("LOCAL_SOURCE_LABEL")) throw new Error("Missing coding source markers");
      return html.replace('data-source="fixture"', 'data-source="live"').replace("LOCAL_SOURCE_LABEL",
        "LIVE: Pi OpenAI Codex subscription, SSE. Sending a prompt uses plan allowance and sends generated sample code, test output, and the conversation to OpenAI. Do not enter secrets.");
    } }, { name: "coding-fixture-label", transformIndexHtml(html) {
      return html.replace("LOCAL_SOURCE_LABEL", "Local scripted provider, actual Pi session, file edits, and Node tests. No model calls or credentials.");
    } }],
  };
});
