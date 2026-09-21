/** Read the host's displayed report, not hidden Pi or terminal state. */
export function hasStreamingAssistantText(report: string): boolean {
  return report.split("\n").some(line => {
    const match = /^  pi-\d+: mutable; (".*")$/.exec(line);
    if (!match) return false;
    try {
      const text: unknown = JSON.parse(match[1]);
      return typeof text === "string" && text.startsWith("Assistant:\n") && text.slice(11).trim().length > 0;
    } catch { return false; }
  });
}

/** Explicitly armed, one-shot UI check; it never starts a model call itself. */
export function installLiveCancelCheck(doc: Document, cancelButtonId = "quit"): void {
  const armed = doc.querySelector<HTMLInputElement>("#cancel-on-text");
  if (!armed) return;
  const report = doc.querySelector<HTMLElement>("#report")!;
  const cancel = doc.getElementById(cancelButtonId) as HTMLButtonElement;
  const result = doc.querySelector<HTMLElement>("#cancel-check-result")!;
  const observer = new MutationObserver(() => {
    if (!armed.checked || cancel.disabled || !hasStreamingAssistantText(report.textContent ?? "")) return;
    armed.checked = false;
    armed.disabled = true;
    result.textContent = "Cancellation sent after visible streaming text; inspect retained content, Context close, and the application outcome below.";
    cancel.click();
    observer.disconnect();
  });
  observer.observe(report, { childList: true, characterData: true, subtree: true });
  doc.defaultView?.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}
