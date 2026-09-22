import type { Api, Model, Transport } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createCodingWorkspace, MAX_SOURCE_UNITS } from "./workspace.ts";

export const CODING_PROMPT = "Fix totalCents in total.mjs. Read the source and its tests, run the tests before editing, make a minimal fix, then run tests again. Report the actual before/after results.";
export const FOLLOWUP_PROMPT = "Without changing files, run the tests again and explain why the quantity fix works, including zero quantity. Use the same project from the previous turn.";
export const CODING_LIMITS = { maxEvents: 2048, maxBlocks: 64, maxTextUnits: 32768 };

export async function createCodingSource(runtime: ModelRuntime, model: Model<Api>, transport?: Transport) {
  const workspace = await createCodingWorkspace();
  let calls = 0;
  const begin = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (++calls > 24) throw new Error("Coding tool-call budget exceeded");
  };
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: {} });
  try {
    const tools = [
      defineTool({ name: "read_coding_file", label: "Read sample code", description: "Read total.mjs or its immutable total.test.mjs tests.",
        parameters: Type.Object({ path: Type.Union([Type.Literal("total.mjs"), Type.Literal("total.test.mjs")]) }),
        execute: async (_id, params, signal) => { begin(signal); return text(`${params.path}:\n${await workspace.read(params.path, signal)}`); },
      }),
      defineTool({ name: "replace_coding_text", label: "Edit sample code", description: "Replace one exact occurrence in total.mjs. The test file is read-only.",
        parameters: Type.Object({ oldText: Type.String({ minLength: 1, maxLength: MAX_SOURCE_UNITS }), newText: Type.String({ maxLength: MAX_SOURCE_UNITS }) }),
        execute: async (_id, params, signal) => { begin(signal); return text(await workspace.replace(params.oldText, params.newText, signal)); },
      }),
      defineTool({ name: "run_coding_tests", label: "Run sample tests", description: "Run the fixed Node test command in the temporary sample project. A nonzero exit means tests failed.",
        parameters: Type.Object({}),
        execute: async (_id, _params, signal, update) => {
          begin(signal);
          update?.(text("Running total.test.mjs..."));
          const result = await workspace.runTests(signal, output => update?.(text(`Running total.test.mjs...\n${output}`)));
          return { ...text(`Exit code: ${result.exitCode}\n${result.output}`), isError: result.exitCode !== 0, details: { exitCode: result.exitCode } };
        },
      }),
    ];
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", transport });
    const loader = new DefaultResourceLoader({ cwd: workspace.directory, agentDir: workspace.directory, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "You are fixing a generated JavaScript sample. Use only read_coding_file, replace_coding_text, and run_coding_tests. totalCents returns the total integer-cent cost of items with priceCents and quantity. Keep edits minimal and pure: no imports, network, process access, or new dependencies. Tests are immutable. Use the actual test exit code; a failed test is evidence to fix the code, not success. Later user turns share these files. Answer briefly.",
    });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: workspace.directory, agentDir: workspace.directory,
      modelRuntime: runtime, model, thinkingLevel: transport ? "low" : "off", tools: tools.map(tool => tool.name), customTools: tools,
      settingsManager: settings, sessionManager: SessionManager.inMemory(workspace.directory), resourceLoader: loader });
    session.agent.shouldStopAfterTurn = (_turn, signal) => signal?.aborted === true;
    return { session, workspace, toolCalls: () => calls, async dispose() {
      try { await session.abort(); }
      finally { try { session.dispose(); } finally { await workspace.dispose(); } }
    } };
  } catch (error) { await workspace.dispose(); throw error; }
}
