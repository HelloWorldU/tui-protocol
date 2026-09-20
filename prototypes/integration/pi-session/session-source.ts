import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "typebox";
import type { Api, Model, Transport } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";

/** Real Pi session, with only one fixed, read-only tool and no user resource discovery. */
export async function createTrialSession(runtime: ModelRuntime, model: Model<Api>, toolPauseMs = 10, transport?: Transport) {
  const parent = resolve(tmpdir());
  const cwd = await mkdtemp(join(parent, "tui-pi-session-"));
  const cleanup = async () => {
    const target = resolve(cwd);
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("tui-pi-session-")) {
      throw new Error("Refusing cleanup outside the allocated trial directory");
    }
    await rm(target, { recursive: true, force: true });
  };
  let toolCalls = 0;
  try {
    const settings = SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", transport,
    });
    const loader = new DefaultResourceLoader({
      cwd, agentDir: cwd, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Use read_trial_sample once, then briefly report its text. Do not request other tools.",
    });
    await loader.reload();
    const tool = defineTool({
      name: "read_trial_sample", label: "Read trial sample", description: "Read the fixed, non-sensitive local sample.",
      parameters: Type.Object({}),
      execute: async (_id, _params, signal, onUpdate) => {
        if (++toolCalls > 1) throw new Error("Trial permits one tool execution");
        onUpdate?.({ content: [{ type: "text", text: "Reading sample..." }], details: {} });
        await delay(toolPauseMs, undefined, { signal });
        const text = (await readFile(new URL("./fixtures/sample.txt", import.meta.url), "utf8")).trimEnd();
        return { content: [{ type: "text", text }], details: {} };
      },
    });
    const { session } = await createAgentSession({
      cwd, agentDir: cwd, modelRuntime: runtime, model, thinkingLevel: "off",
      tools: [tool.name], customTools: [tool], settingsManager: settings,
      sessionManager: SessionManager.inMemory(cwd), resourceLoader: loader,
    });
    return { session, toolCalls: () => toolCalls, async dispose() {
      try { await session.abort(); }
      finally {
        try { session.dispose(); }
        finally { await cleanup(); }
      }
    } };
  } catch (error) { await cleanup(); throw error; }
}
