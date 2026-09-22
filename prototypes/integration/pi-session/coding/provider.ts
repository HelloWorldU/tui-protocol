import { setTimeout as delay } from "node:timers/promises";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Scripted model decisions; file edits and child-process tests still execute. */
export async function createCodingModel(pauseMs = 5) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  let calls = 0;
  runtime.registerProvider("coding-fixture", {
    api: "coding-fixture", apiKey: "local-fixture-not-a-secret", baseUrl: "http://127.0.0.1/unused",
    models: [{ id: "local", name: "Coding fixture", reasoning: false, input: ["text"], contextWindow: 32768,
      maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const id = `coding-${++calls}`;
      const users = context.messages.filter(message => message.role === "user");
      const start = context.messages.lastIndexOf(users.at(-1)!);
      const results = context.messages.slice(start + 1).filter(message => message.role === "toolResult");
      const last = results.at(-1);
      const resultText = last?.content.filter(part => part.type === "text").map(part => part.text).join("\n") ?? "";
      const steps: Pick<ToolCall, "name" | "arguments">[] = [
        { name: "read_coding_file", arguments: { path: "total.mjs" } },
        { name: "read_coding_file", arguments: { path: "total.test.mjs" } },
        { name: "run_coding_tests", arguments: {} },
        { name: "replace_coding_text", arguments: { oldText: "sum + item.priceCents", newText: "sum + item.priceCents * item.quantity" } },
        { name: "run_coding_tests", arguments: {} },
      ];
      const step = users.length === 1 ? steps[results.length] : results.length === 0 ? steps[2] : undefined;
      const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "" }],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "pending",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        try {
          if (users.length === 1 && results.length === 3 && !resultText.includes("CODING TESTS: 3 passed, 3 failed")) {
            throw new Error("Expected the real failing baseline before editing");
          }
          if (!step && (!resultText.includes("Exit code: 0\n") || !resultText.includes("CODING TESTS: 6 passed, 0 failed"))) {
            throw new Error("A successful actual test run is required before the fixture can finish");
          }
          stream.push({ type: "start", partial: structuredClone(message) });
          stream.push({ type: "text_start", contentIndex: 0, partial: structuredClone(message) });
          const fragments = step ? ["Next: ", step.name, "."] : [
            "Verified: ", "6 tests passed. ", "Each item's price is multiplied by quantity; ",
            "zero quantity contributes zero. ", users.length === 1 ? "The initial run had 3 failures." : "The previous turn's edit remains in the same project.",
          ];
          for (const fragment of fragments) {
            await delay(pauseMs, undefined, { signal: options?.signal });
            const part = message.content[0]; if (part.type !== "text") throw new Error("Invalid fixture state");
            part.text += fragment;
            stream.push({ type: "text_delta", contentIndex: 0, delta: fragment, partial: structuredClone(message) });
          }
          const part = message.content[0]; if (part.type !== "text") throw new Error("Invalid fixture state");
          stream.push({ type: "text_end", contentIndex: 0, content: part.text, partial: structuredClone(message) });
          if (step) message.content.push({ type: "toolCall", id, ...step });
          message.stopReason = step ? "toolUse" : "stop";
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
  const model = runtime.getModel("coding-fixture", "local");
  if (!model) throw new Error("Missing coding fixture model");
  return { runtime, model };
}
