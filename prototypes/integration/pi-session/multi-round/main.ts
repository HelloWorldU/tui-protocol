import { createTrialSession } from "../session-source.ts";
import { createLiveSource } from "../live-source.ts";
import { runMultiRound } from "./application.ts";
import { createMultiRoundModel } from "./provider.ts";

const options = { maxToolCalls: 10,
  systemPrompt: "Answer the user's questions briefly. You may read the fixed trial sample using read_trial_sample. No other tools or project files are available." };
try {
  await runMultiRound({ input: process.stdin, output: process.stdout, createSource: async () => {
    if (process.argv.includes("--live")) return createLiveSource(process.env.PI_TRIAL_MODEL, undefined, options);
    const { runtime, model } = await createMultiRoundModel(250);
    return createTrialSession(runtime, model, 250, undefined, options);
  } });
} catch {
  process.exitCode = 1;
  process.stderr.write("Pi multi-round trial stopped after a failure. Reload for a new session; no fallback or automatic retry.\n");
}
