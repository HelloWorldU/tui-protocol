import { ProtocolStreamDecoder, encodeMessageFrames } from "../../reference-codec/index.ts";

// A bounded transport diagnostic, not a TUI implementation or fallback policy.
const decoder = new ProtocolStreamDecoder();
let inputHex = "";
let responseReceived = false;
let inputText = "";
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (chunk: Buffer) => {
  inputHex += chunk.toString("hex");
  inputText += chunk.toString("utf8");
  for (const event of decoder.push(chunk)) {
    if (event.type === "message" && event.message.kind === "capability.response" &&
        event.message.request_id === "pty-probe") responseReceived = true;
  }
});
process.stdout.write("PROBE_READY\r\n");
for (const frame of encodeMessageFrames({
  version: 1, kind: "capability.query", request_id: "pty-probe", body: {},
}, 1)) process.stdout.write(frame);
process.stdout.write("PROBE_SENT\r\n");
setTimeout(() => {
  process.stdout.write(`PROBE_REPORT:${JSON.stringify({ responseReceived, ordinaryInputReceived: inputText.includes("PTY_PING"), inputHex: inputHex.slice(0, 80) })}\r\n`, () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    setTimeout(() => process.exit(0), 100);
  });
}, 2000);
