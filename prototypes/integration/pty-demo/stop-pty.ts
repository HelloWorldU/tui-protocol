/** Call only after disabling forwarding. Remaining pipe output is discarded. */
export function stopPty(child: { kill(): void; resume(): void }, onError: (error: unknown) => void) {
  try { child.kill(); } catch (error) { onError(error); }
  // Bundled ConPTY may need its paused output pipe to drain to finish cleanup.
  // Attempt this even if kill failed; do not hide either failure.
  try { child.resume(); } catch (error) { onError(error); }
}
