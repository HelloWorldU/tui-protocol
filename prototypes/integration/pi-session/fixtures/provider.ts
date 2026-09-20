import { setTimeout as delay } from "node:timers/promises";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Local provider fixture; never opens a model connection or reads real credentials. */
export async function createFixtureModel(pauseMs = 10) {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  let requests = 0;
  runtime.registerProvider("protocol-trial", {
    api: "protocol-trial", apiKey: "local-fixture-not-a-secret", baseUrl: "http://127.0.0.1/unused",
    models: [{ id: "local", name: "Local deterministic fixture", reasoning: false, input: ["text"],
      contextWindow: 8192, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const invocation = ++requests;
      const message: AssistantMessage = {
        role: "assistant", content: [{ type: "text", text: "" }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "pending",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        try {
          if (invocation > 2) throw new Error("Local fixture permits only two model requests");
          const toolResult = [...context.messages].reverse().find(item => item.role === "toolResult");
          if (invocation === 2 && (!toolResult || !toolResult.content.some(part =>
            part.type === "text" && part.text.includes("mutable history keeps old output readable")))) {
            throw new Error("Second fixture response requires the real tool result");
          }
          stream.push({ type: "start", partial: structuredClone(message) });
          stream.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
          const fragments = invocation === 1 ? ["Reading", " the local sample."] : [
            "Result: ", "mutable history keeps old output readable.",
            "\nThe read_trial_sample tool returned the sample.",
          ];
          for (const fragment of fragments) {
            await delay(pauseMs, undefined, { signal: options?.signal });
            const text = message.content[0];
            if (text.type !== "text") throw new Error("Invalid fixture text state");
            text.text += fragment;
            stream.push({ type: "text_delta", contentIndex: 0, delta: fragment, partial: structuredClone(message) });
          }
          const text = message.content[0];
          if (text.type !== "text") throw new Error("Invalid fixture text state");
          stream.push({ type: "text_end", contentIndex: 0, content: text.text, partial: structuredClone(message) });
          if (invocation === 1) {
            message.content.push({ type: "toolCall", id: "sample-call", name: "read_trial_sample", arguments: {} });
          }
          message.stopReason = invocation === 1 ? "toolUse" : "stop";
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
  const model = runtime.getModel("protocol-trial", "local");
  if (!model) throw new Error("Local fixture model not registered");
  return { runtime, model, requestCount: () => requests };
}
