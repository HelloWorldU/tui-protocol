import { ProtocolStreamDecoder, encodeMessageFrames, type Message } from "../../reference-codec/index.ts";

// Fixed demonstration program: no shell, AI service, file access, or user commands.
const decoder = new ProtocolStreamDecoder({ emitOrdinaryData: true });
let frameId = 1;
let context = "";
let stage = 0;
let busy = true;
const timeout = setTimeout(() => shutdown(2), 10 * 60_000);
function send(message: Message): void {
  for (const frame of encodeMessageFrames(message, frameId++)) process.stdout.write(frame);
}
function append(id: string, block: string, content: string, lifecycle: "mutable" | "sealed"): void {
  send({ version: 1, kind: "block.append", context_id: context, operation_id: id,
    body: { block_id: block, lifecycle, content: { type: "text/plain", data: content } } });
}
function shutdown(code: number): void {
  clearTimeout(timeout);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  setTimeout(() => process.exit(code), 100);
}
async function next(): Promise<void> {
  if (busy || !context) return;
  busy = true;
  stage++;
  if (stage === 1) {
    const fragments = ["\n分析输入", "\n核对条件", "\n形成结论"];
    let base = "1";
    for (let index = 0; index < fragments.length; index++) {
      const id = String(index + 4);
      send({ version: 1, kind: "block.extend", context_id: context, operation_id: id,
        body: { block_id: "thinking", base_operation_id: base, fragment: fragments[index] } });
      base = id;
      if (index < fragments.length - 1) await new Promise(resolve => setTimeout(resolve, 120));
    }
  } else if (stage === 2) {
    send({ version: 1, kind: "block.replace_suffix", context_id: context, operation_id: "7",
      body: { block_id: "thinking", base_operation_id: "6", retain: 3, replacement: "完成" } });
  } else if (stage === 3) {
    send({ version: 1, kind: "block.update", context_id: context, operation_id: "8",
      body: { block_id: "thinking", content: { type: "text/plain", data: "思考\t最终结论" } } });
  } else if (stage === 4) {
    send({ version: 1, kind: "block.seal", context_id: context, operation_id: "9", body: { block_id: "thinking" } });
    send({ version: 1, kind: "block.update", context_id: context, operation_id: "10",
      body: { block_id: "thinking", content: { type: "text/plain", data: "must not render" } } });
  }
  busy = false;
}
process.stdin.setRawMode(true);
process.stdin.on("data", (chunk: Buffer) => {
  for (const event of decoder.push(chunk)) {
    if (event.type === "error") { shutdown(3); return; }
    if (event.type === "ordinary") {
      const command = Buffer.from(event.data).toString("utf8");
      if (command === "n") void next().catch(() => shutdown(4));
      if (command === "q" && context) send({ version: 1, kind: "context.close", request_id: "3", context_id: context, body: {} });
      continue;
    }
    const message = event.message;
    if (message.kind === "capability.response" && message.request_id === "1") {
      if (message.body.outcome !== "supported") { shutdown(5); return; }
      send({ version: 1, kind: "context.open", request_id: "2", body: {} });
    } else if (message.kind === "context.open.response" && message.request_id === "2" && "context_id" in message) {
      context = message.context_id;
      append("1", "thinking", "思考\t开始", "mutable");
      append("2", "result", "结果: 保留这条消息", "sealed");
      append("3", "tail", Array.from({ length: 12 }, (_, index) => `日志${index + 1}`).join("\n"), "sealed");
      busy = false;
    } else if (message.kind === "protocol.error") {
      if (message.operation_id !== "10" || message.body.code !== "block_sealed") { shutdown(6); return; }
      // A real return-path witness: only send this query after receiving the error.
      // It is diagnostic instrumentation, not a new Operation acknowledgement.
      send({ version: 1, kind: "capability.query", request_id: "verified-error", body: {} });
    } else if (message.kind === "context.close.response" && message.request_id === "3") shutdown(0);
  }
});
send({ version: 1, kind: "capability.query", request_id: "1", body: {} });
