import { runApplication } from "./application.ts";
import { createLiveSource } from "./live-source.ts";

// Live use is opt-in through a separate host command. Default tests stay local.
try {
  await runApplication({ input: process.stdin, output: process.stdout,
    createSource: () => createLiveSource(process.env.PI_TRIAL_MODEL),
  });
} catch {
  process.exitCode = 1;
  process.stderr.write("Live Pi trial stopped. Check Pi login and selected model; no fallback or automatic restart.\n");
}
