import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { ProcessTerminal } from "@earendil-works/pi-tui";
import { prepareStockUiTrial } from "./application.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { createTrialRuntime } from "./session-source.ts";

// Deliberately local-only: a deterministic provider, no model network, no credentials.
// Streaming stays slow enough to type and cancel mid-turn from the host page.
let failure: Error | undefined;
try {
  const fixture = await createFixtureModel(600);
  const source = await createTrialRuntime(fixture, 600);
  // InteractiveMode shuts down through process.exit, so temp cleanup hooks onto exit.
  process.on("exit", () => {
    try {
      const target = resolve(source.cwd);
      if (target.startsWith(resolve(tmpdir()) + sep)) rmSync(target, { recursive: true, force: true });
    } catch { /* best-effort trial cleanup */ }
  });
  const prepared = await prepareStockUiTrial({
    input: process.stdin, output: process.stdout, source,
    protocol: process.env.PI_STOCK_UI_OFF === "1" ? false : undefined,
    stockTerminal: () => new ProcessTerminal(),
    onFailure: error => {
      failure ??= error;
      try { prepared.interactiveMode.stop(); } catch { /* terminal may already be down */ }
      process.stderr.write("Pi stock-UI trial failed; transcript protocol state is no longer trustworthy.\n");
      process.exit(1);
    },
  });
  await prepared.interactiveMode.run();
  if (failure) throw failure;
} catch {
  process.exitCode = 1;
  // Do not send provider details or terminal control characters in raw diagnostics.
  process.stderr.write("Pi stock-UI trial stopped after an application or protocol failure.\n");
}
