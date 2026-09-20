import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createPtyHost } from "../pty-demo/vite.config.ts";

export default defineConfig(({ command, mode }) => {
  const live = mode === "live";
  const host = command === "serve" ? createPtyHost(fileURLToPath(new URL(live ? "./main-live.ts" : "./main.ts", import.meta.url))) : {};
  return {
    ...host,
    plugins: [...(host.plugins ?? []), {
      name: "pi-trial-source-label",
      transformIndexHtml(html, context) {
        if (!live) return html;
        if (/\/checks\.html$/i.test(context.path)) return "<!doctype html><title>Live checks disabled</title><p>Automatic fixture checks are disabled in live mode. Use the trial page to start one subscription interaction deliberately.</p>";
        const fixtureLabel = "Real Pi SDK 0.86.1, local deterministic provider, one read-only sample tool. No model network requests or user credentials.";
        const fixtureChecks = '<p><a href="/checks.html">Run local browser checks</a></p>';
        if (!html.includes(fixtureLabel) || !html.includes(fixtureChecks)) throw new Error("Pi trial page changed; update its live-mode labels before serving");
        return html.replace(fixtureLabel,
          "Live OpenAI Codex subscription via Pi 0.86.1. Starting a turn consumes your plan allowance and sends the fixed trial prompt, tool definition, and sample result to OpenAI; no project files.")
          .replace(fixtureChecks,
            '<p>Live mode: one read-only sample tool, no shell access. Automatic fixture checks are disabled.</p><label><input type="checkbox" id="cancel-on-text"> Cancel once assistant text appears (one-shot live check)</label><p id="cancel-check-result">Not armed unless checked before starting a turn.</p>');
      },
    }],
    root: fileURLToPath(new URL(".", import.meta.url)),
    build: { rolldownOptions: { input: {
      trial: fileURLToPath(new URL("./index.html", import.meta.url)),
      checks: fileURLToPath(new URL("./checks.html", import.meta.url)),
    } } },
  };
});
