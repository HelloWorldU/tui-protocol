const sourceLabel = "Local deterministic provider, actual Pi 0.86.1 session. No model network requests or credentials.";
const checksLink = '<p><a href="/checks.html">Run local browser checks</a></p>';
const checkSection = /<section id="local-checks">[\s\S]*?<\/section>/;

/** Fail closed if markup changes: a live source must not retain fixture-only run buttons. */
export function livePage(html: string, path: string): string {
  if (path.endsWith("/checks.html")) return "<!doctype html><title>Live checks disabled</title><p>Automatic checks are disabled in live mode. Start prompts deliberately from the main page.</p>";
  if (!html.includes(sourceLabel) || !html.includes(checksLink) || !checkSection.test(html)) {
    throw new Error("Multi-round page changed; update the live-mode labels and fixture controls before serving");
  }
  return html.replace(sourceLabel,
    "LIVE: OpenAI Codex subscription via Pi. Each accepted prompt consumes plan allowance and sends your prompt, conversation history, and sample-tool data to OpenAI. Do not enter secrets. No API-key fallback.")
    .replace(checksLink, "<p>Live mode: automatic browser checks disabled.</p>")
    .replace(checkSection,
      '<label><input type="checkbox" id="cancel-on-text"> Cancel once assistant text appears (one-shot; never starts a model call)</label><p id="cancel-check-result">Not armed unless checked.</p>');
}
