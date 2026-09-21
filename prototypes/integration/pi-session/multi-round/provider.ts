import { setTimeout as delay } from "node:timers/promises";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Deterministic responses still traverse the real Pi conversation and tool loop. */
export async function createMultiRoundModel(pauseMs = 10, failPrompt?: string) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  let calls = 0;
  runtime.registerProvider("multi-fixture", {
    api: "multi-fixture", apiKey: "local-fixture-not-a-secret", baseUrl: "http://127.0.0.1/unused",
    models: [{ id: "local", name: "Multi-round fixture", reasoning: false, input: ["text"], contextWindow: 32768,
      maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const callId = `sample-${++calls}`;
      const users = context.messages.filter(message => message.role === "user");
      const userText = (message: typeof users[number]) => typeof message.content === "string" ? message.content :
        message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      const prompt = userText(users.at(-1)!);
      const lastUser = context.messages.lastIndexOf(users.at(-1)!);
      const result = context.messages.slice(lastUser + 1).find(message => message.role === "toolResult");
      const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "" }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "pending",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        try {
          if (prompt === failPrompt) throw new Error("Injected fixture model failure");
          stream.push({ type: "start", partial: structuredClone(message) });
          stream.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
          const fragments = result ? ["Answer: ", `prompt ${users.length}: ${prompt}`, "\nPrevious prompt: ",
            users.length > 1 ? userText(users.at(-2)!) : "(none)", "\nSample: ",
            result.content.filter(part => part.type === "text").map(part => part.text).join("\n")] :
            ["Reading", " the fixed sample for: ", prompt];
          for (const fragment of fragments) {
            await delay(pauseMs, undefined, { signal: options?.signal });
            const text = message.content[0];
            if (text.type !== "text") throw new Error("Invalid fixture state");
            text.text += fragment;
            stream.push({ type: "text_delta", contentIndex: 0, delta: fragment, partial: structuredClone(message) });
          }
          const text = message.content[0];
          if (text.type !== "text") throw new Error("Invalid fixture state");
          stream.push({ type: "text_end", contentIndex: 0, content: text.text, partial: structuredClone(message) });
          if (!result) message.content.push({ type: "toolCall", id: callId, name: "read_trial_sample", arguments: {} });
          message.stopReason = result ? "stop" : "toolUse";
          stream.push({ type: "done", reason: message.stopReason, message });
        } catch (error) {
          message.stopReason = options?.signal?.aborted ? "aborted" : "error";
          message.errorMessage = message.stopReason === "aborted" ? "Cancelled by user" : String(error);
          stream.push({ type: "error", reason: message.stopReason, error: message });
        } finally { stream.end(); }
      })();
      return stream;
    },
  });
  const model = runtime.getModel("multi-fixture", "local");
  if (!model) throw new Error("Fixture model missing");
  return { runtime, model };
}
