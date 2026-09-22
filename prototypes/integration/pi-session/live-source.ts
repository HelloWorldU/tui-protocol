import { homedir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createTrialSession } from "./session-source.ts";

export const LIVE_PROVIDER = "openai-codex";
export const DEFAULT_LIVE_MODEL = "gpt-5.5";

/** Explicit subscription-only source; no copying Codex tokens or API-key fallback. */
export async function createLiveSource(modelId = DEFAULT_LIVE_MODEL, authPath = join(homedir(), ".pi", "agent", "auth.json"),
  options: { maxToolCalls?: number; systemPrompt?: string } = {}) {
  const { runtime, model } = await loadLiveModel(modelId, authPath);
  // Model-provider transport only; the browser-to-PTY bridge still uses WebSocket.
  const source = await createTrialSession(runtime, model, 10, "sse", options);
  source.session.setThinkingLevel("low");
  return source;
}

/** Resolve Pi-owned OAuth and a catalog model without starting a model request. */
export async function loadLiveModel(modelId = DEFAULT_LIVE_MODEL, authPath = join(homedir(), ".pi", "agent", "auth.json")) {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(modelId)) throw new Error("Invalid Pi trial model ID");
  const runtime = await ModelRuntime.create({
    authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  const credentials = await runtime.listCredentials();
  if (!credentials.some(item => item.providerId === LIVE_PROVIDER && item.type === "oauth")) {
    throw new Error("Sign in to OpenAI Codex with Pi before starting the live trial");
  }
  const model = runtime.getModel(LIVE_PROVIDER, modelId);
  if (!model) throw new Error("Model is not in the pinned Pi OpenAI Codex catalog");
  return { runtime, model };
}
