import { runApplication } from "./application.ts";
import { createFixtureModel } from "./fixtures/provider.ts";
import { createTrialSession } from "./session-source.ts";

// Deliberately local-only until the user selects a live model and credentials.
try {
  await runApplication({ input: process.stdin, output: process.stdout, createSource: async () => {
    const { runtime, model } = await createFixtureModel(600);
    return createTrialSession(runtime, model, 600);
  } });
} catch {
  process.exitCode = 1;
  // Do not send provider details or terminal control characters in raw diagnostics.
  process.stderr.write("Pi trial stopped after an application or protocol failure.\n");
}
