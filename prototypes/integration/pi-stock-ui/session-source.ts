import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "typebox";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, defineTool,
  SessionManager, SettingsManager,
  type AgentSessionRuntime, type CreateAgentSessionRuntimeFactory, type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

export const TRIAL_SYSTEM_PROMPT =
  "Use read_trial_sample once, then briefly report its text. Do not request other tools.";
export const TRIAL_PROMPT = "Read the trial sample using read_trial_sample, then give a brief answer.";
export const EXPECTED_TOOL_TEXT = "Trial sample: mutable history keeps old output readable.";

export interface TrialRuntimeSource {
  readonly runtime: AgentSessionRuntime;
  readonly cwd: string;
  readonly toolCalls: () => number;
  readonly dispose: () => Promise<void>;
}

/**
 * Real Pi 0.87.1 session runtime through the public createAgentSessionRuntime +
 * createAgentSessionServices + createAgentSessionFromServices composition, with one
 * fixed read-only tool, an in-memory session, a temp cwd, and no user resource
 * discovery. Environment is isolated so nothing reaches the network, model
 * catalogs, or the real agent directory. Not a production harness.
 */
export async function createTrialRuntime(fixture: { runtime: ModelRuntime; model: Model<Api> },
  toolPauseMs = 10, options: { maxToolCalls?: number } = {}): Promise<TrialRuntimeSource> {
  const maxToolCalls = options.maxToolCalls ?? 1;
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1) throw new Error("Invalid tool execution budget");
  const parent = resolve(tmpdir());
  const cwd = await mkdtemp(join(parent, "tui-pi-stock-ui-"));
  const agentDir = join(cwd, "agent");
  const savedEnv = {
    PI_OFFLINE: process.env.PI_OFFLINE, PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  };
  const cleanup = async () => {
    const target = resolve(cwd);
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("tui-pi-stock-ui-")) {
      throw new Error("Refusing cleanup outside the allocated trial directory");
    }
    await rm(target, { recursive: true, force: true });
  };
  let toolCalls = 0;
  try {
    process.env.PI_OFFLINE = "1";
    process.env.PI_SKIP_VERSION_CHECK = "1";
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const settings = SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off",
    });
    const tool = defineTool({
      name: "read_trial_sample", label: "Read trial sample", description: "Read the fixed, non-sensitive local sample.",
      parameters: Type.Object({}),
      execute: async (_id, _params, signal, onUpdate) => {
        if (++toolCalls > maxToolCalls) throw new Error("Trial tool execution budget exceeded");
        onUpdate?.({ content: [{ type: "text", text: "Reading sample..." }], details: {} });
        await delay(toolPauseMs, undefined, { signal });
        const text = (await readFile(new URL("./fixtures/sample.txt", import.meta.url), "utf8")).trimEnd();
        return { content: [{ type: "text", text }], details: {} };
      },
    });
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd, agentDir, settingsManager: settings, modelRuntime: fixture.runtime,
        resourceLoaderOptions: {
          noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
          systemPromptOverride: () => TRIAL_SYSTEM_PROMPT,
        },
      });
      const created = await createAgentSessionFromServices({
        services, sessionManager, sessionStartEvent, model: fixture.model, thinkingLevel: "off",
        tools: [tool.name], customTools: [tool],
      });
      return { ...created, services, diagnostics: services.diagnostics };
    };
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd, agentDir, sessionManager: SessionManager.inMemory(cwd),
    });
    return { runtime, cwd, toolCalls: () => toolCalls, async dispose() {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      try { await runtime.session.abort(); }
      finally {
        try { runtime.session.dispose(); }
        finally { await cleanup(); }
      }
    } };
  } catch (error) {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await cleanup();
    throw error;
  }
}
