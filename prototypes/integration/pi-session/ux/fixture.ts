import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { INITIAL, CONTINUATION, PROGRESS, LATER, SUMMARY, FINAL } from "./samples.ts";
export { PROMPT, INITIAL, CONTINUATION, SUMMARY, LATER } from "./samples.ts";
export type GateName = "stream" | "tools" | "shrink" | "final";

/** Test scheduling only, not application backpressure or a protocol feature. */
export class Gates {
  #released = new Set<GateName>();
  #listeners = new Map<GateName, Set<() => void>>();
  release(name: GateName): void {
    this.#released.add(name);
    for (const wake of this.#listeners.get(name) ?? []) wake();
    this.#listeners.delete(name);
  }
  wait(name: GateName, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error("Fixture cancelled"));
    if (this.#released.has(name)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener("abort", abort); this.#listeners.get(name)?.delete(done); };
      const done = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(new Error("Fixture cancelled")); };
      const listeners = this.#listeners.get(name) ?? new Set();
      listeners.add(done); this.#listeners.set(name, listeners);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

/** Actual Pi session; fixed in-memory provider and two read-only fixture tools. */
export async function createUxSession(cwd: string, gates: Gates) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  let requests = 0;
  runtime.registerProvider("protocol-ux", {
    api: "protocol-ux", apiKey: "local-fixture-not-a-secret", baseUrl: "http://127.0.0.1/unused",
    models: [{ id: "fixed", name: "Fixed UX trial", reasoning: false, input: ["text"], contextWindow: 32768,
      maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const invocation = ++requests;
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "" }], api: model.api, provider: model.provider,
        model: model.id, timestamp: 1, stopReason: "pending",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        try {
          if (invocation > 2) throw new Error("UX fixture allows only two model responses");
          if (invocation === 2 && ["slow-call", "later-call"].some(id => !context.messages.some(m => m.role === "toolResult" && m.toolCallId === id))) {
            throw new Error("Final response requires both real tool results");
          }
          if (invocation === 2) await gates.wait("final", options?.signal);
          stream.push({ type: "start", partial: structuredClone(message) });
          stream.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
          const emitText = (delta: string) => {
            const part = message.content[0];
            if (part.type !== "text") throw new Error("Invalid fixture text part");
            part.text += delta;
            stream.push({ type: "text_delta", contentIndex: 0, delta, partial: structuredClone(message) });
          };
          emitText(invocation === 1 ? INITIAL : FINAL);
          if (invocation === 1) {
            await gates.wait("stream", options?.signal);
            for (const line of CONTINUATION.split("\n").slice(1)) emitText(`\n${line}`);
            await gates.wait("tools", options?.signal);
          }
          const part = message.content[0];
          if (part.type !== "text") throw new Error("Invalid fixture text part");
          stream.push({ type: "text_end", contentIndex: 0, content: part.text, partial: structuredClone(message) });
          if (invocation === 1) message.content.push(
            { type: "toolCall", id: "slow-call", name: "read_slow_sample", arguments: {} },
            { type: "toolCall", id: "later-call", name: "read_later_sample", arguments: {} },
          );
          message.stopReason = invocation === 1 ? "toolUse" : "stop";
          stream.push({ type: "done", reason: message.stopReason, message });
        } catch (error) {
          message.stopReason = options?.signal?.aborted ? "aborted" : "error";
          message.errorMessage = String(error);
          stream.push({ type: "error", reason: message.stopReason, error: message });
        } finally { stream.end(); }
      })();
      return stream;
    },
  });
  const tools = [
    defineTool({ name: "read_slow_sample", label: "Slow sample", description: "Fixed progress then short result.", parameters: Type.Object({}),
      async execute(_id, _params, signal, update) {
        update?.({ content: [{ type: "text", text: PROGRESS }], details: {} });
        await gates.wait("shrink", signal);
        return { content: [{ type: "text", text: SUMMARY }], details: {} };
      } }),
    defineTool({ name: "read_later_sample", label: "Later sample", description: "Fixed later result.", parameters: Type.Object({}),
      async execute() { return { content: [{ type: "text", text: LATER }], details: {} }; } }),
  ];
  const settings = SettingsManager.inMemory({ quietStartup: true, theme: "dark", compaction: { enabled: false },
    retry: { enabled: false }, cacheWarming: "off" });
  const services = await createAgentSessionServices({ cwd, agentDir: cwd, settingsManager: settings, modelRuntime: runtime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => "Use the two fixed read-only sample tools." } });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(cwd),
    model: runtime.getModel("protocol-ux", "fixed")!, thinkingLevel: "off", tools: tools.map(tool => tool.name), customTools: tools });
  return { session, services, requests: () => requests };
}
