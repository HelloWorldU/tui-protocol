import { loadLiveModel } from "../live-source.ts";
import { runMultiRound } from "../multi-round/application.ts";
import { createCodingSource, CODING_LIMITS } from "./source.ts";
import { createCodingModel } from "./provider.ts";

try {
  await runMultiRound({ input: process.stdin, output: process.stdout, maxRounds: 2, turnDeadlineMs: 120_000,
    adapterLimits: CODING_LIMITS, createSource: async () => {
      const live = process.argv.includes("--live");
      const { runtime, model } = live ? await loadLiveModel(process.env.PI_TRIAL_MODEL) : await createCodingModel(100);
      return createCodingSource(runtime, model, live ? "sse" : undefined);
    } });
} catch {
  process.exitCode = 1;
  process.stderr.write("Coding trial stopped after a failure. Reload for a new temporary project.\n");
}
