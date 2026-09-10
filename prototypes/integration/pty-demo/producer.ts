import { TuiClient, type TuiContext } from "../../../sdk/src/index.ts";

// Fixed demonstration program: no shell, AI service, file access, or user commands.
const client = new TuiClient({ write: bytes => { process.stdout.write(bytes); } });
let context: TuiContext | undefined;
let thinkingState = "";
let rejectedOperation = "";
let stage = 0;
let busy = true;
let stopped = false;
const timeout = setTimeout(() => shutdown(2), 10 * 60_000);
function shutdown(code: number): void {
  if (stopped) return;
  stopped = true;
  clearTimeout(timeout);
  client.dispose();
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
    for (let index = 0; index < fragments.length; index++) {
      // Sent content-state IDs are not successful Operation acknowledgements.
      thinkingState = context.extend("thinking", thinkingState, fragments[index]);
      if (index < fragments.length - 1) await new Promise(resolve => setTimeout(resolve, 120));
    }
  } else if (stage === 2) {
    thinkingState = context.replaceSuffix("thinking", thinkingState, 3, "完成");
  } else if (stage === 3) {
    thinkingState = context.update("thinking", "思考\t最终结论");
  } else if (stage === 4) {
    context.seal("thinking");
    rejectedOperation = context.update("thinking", "must not render");
  }
  busy = false;
}
process.stdin.setRawMode(true);
process.stdin.on("data", (chunk: Buffer) => {
  if (stopped) return;
  for (const event of client.receive(chunk)) {
    if (event.type === "error") { shutdown(3); return; }
    if (event.type === "ordinary") {
      const command = Buffer.from(event.data).toString("utf8");
      if (command === "n") void next().catch(() => shutdown(4));
      if (command === "q" && context) {
        void context.close().then(() => shutdown(0), () => shutdown(7));
      }
    } else if (event.message.kind === "protocol.error") {
      const message = event.message;
      if (message.context_id !== context?.id || message.operation_id !== rejectedOperation ||
          message.body.code !== "block_sealed") { shutdown(6); return; }
      // Re-query only after receiving the rejection: a return-path witness,
      // not a new Operation acknowledgement or automatic SDK retry.
      void client.negotiate().then(supported => { if (!supported) shutdown(5); }, () => shutdown(5));
    }
  }
});
process.stdin.on("end", () => { client.finish(); shutdown(8); });
process.stdout.on("error", () => shutdown(9));
async function start(): Promise<void> {
  if (!await client.negotiate()) { shutdown(5); return; }
  context = await client.openContext();
  thinkingState = context.append("thinking", "思考\t开始", "mutable");
  context.append("result", "结果: 保留这条消息", "sealed");
  context.append("tail", Array.from({ length: 12 }, (_, index) => `日志${index + 1}`).join("\n"), "sealed");
  busy = false;
}
void start().catch(() => shutdown(5));
