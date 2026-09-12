import { spawn as spawnProcess } from "node:child_process";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { ProtocolStreamDecoder, encodeMessageFrames } from "../../../protocol/src/index.ts";
import { TerminalProtocolSession } from "../../../terminal/src/index.ts";

const child = fileURLToPath(new URL("./probe-child.ts", import.meta.url));
const session = new TerminalProtocolSession({ completeBaselineSupported: true });
// Generate the real baseline response through the Session rather than inventing a schema.
const query = { version: 1, kind: "capability.query", request_id: "pty-probe", body: {} } as const;
const response = session.handle(query);
const responseBytes = Buffer.concat(encodeMessageFrames(response[0]!, 1));

interface Result {
  mode: string;
  queryReceived: boolean;
  responseReceived: boolean;
  ordinaryInputReceived: boolean;
  inputHex: string | undefined;
  outputHex: string;
  exitCode: number | null;
}

async function probe(mode: "pipe" | "system-conpty" | "bundled-conpty"): Promise<Result> {
  return new Promise((resolve, reject) => {
    let output = "";
    let sent = false;
    const decoder = new ProtocolStreamDecoder();
    let queryReceived = false;
    const collect = (data: string): void => {
      output += data;
      for (const event of decoder.push(Buffer.from(data, "utf8"))) {
        if (event.type === "message" && event.message.kind === "capability.query" &&
            event.message.request_id === "pty-probe") queryReceived = true;
      }
      // Send even if the outgoing query was lost, to test the return path independently.
      if (!sent && output.includes("PROBE_READY")) {
        sent = true;
        send("PTY_PING" + responseBytes.toString("utf8"));
      }
    };
    const finish = (exitCode: number | null): void => {
      clearTimeout(timeout);
      const report = /PROBE_REPORT:(\{[^\r\n]*\})/.exec(output)?.[1];
      const parsed = report ? JSON.parse(report) as { responseReceived: boolean; ordinaryInputReceived: boolean; inputHex: string } : undefined;
      resolve({ mode, queryReceived, responseReceived: parsed?.responseReceived === true,
        ordinaryInputReceived: parsed?.ordinaryInputReceived === true,
        inputHex: parsed?.inputHex, outputHex: Buffer.from(output).toString("hex"), exitCode });
    };
    let send: (data: string) => void;
    let kill: () => void;
    if (mode === "pipe") {
      const childProcess = spawnProcess(process.execPath, [child], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      send = data => { childProcess.stdin.write(data); };
      kill = () => { childProcess.kill(); };
      childProcess.stdout.setEncoding("utf8").on("data", collect);
      childProcess.stderr.on("data", data => { output += String(data); });
      childProcess.on("error", reject);
      childProcess.on("close", finish);
    } else {
      const ptyProcess = pty.spawn(process.execPath, [child], {
        name: "xterm-256color", cols: 240, rows: 24,
        useConptyDll: mode === "bundled-conpty",
        cwd: process.cwd(), env: process.env,
      });
      send = data => ptyProcess.write(data);
      kill = () => ptyProcess.kill();
      ptyProcess.onData(collect);
      ptyProcess.onExit(event => finish(event.exitCode));
    }
    const timeout = setTimeout(() => { kill(); reject(new Error(`${mode}: child did not finish within 8 seconds`)); }, 8000);
  });
}

const results = [await probe("pipe")];
if (process.platform === "win32") {
  results.push(await probe("system-conpty"), await probe("bundled-conpty"));
}
const failed = results.some(result => result.exitCode !== 0 || !result.queryReceived || !result.responseReceived || !result.ordinaryInputReceived);
// Each child has exited. Explicitly exit this standalone probe after flushing
// its report because the Windows PTY library may retain background handles.
process.stdout.write(JSON.stringify({ platform: process.platform, release: release(), node: process.version, results }, null, 2) + "\n",
  () => process.exit(failed ? 1 : 0));
