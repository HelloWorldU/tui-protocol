import { setTimeout as delay } from "node:timers/promises";
import { AgentSessionRuntime, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { TuiClient } from "@tui-protocol/sdk";
import { PiEventAdapter } from "../event-adapter.ts";
import { transcriptEvent } from "../session-runner.ts";
import { CaptureTerminal } from "./capture-terminal.ts";
import { createUxSession, Gates, PROMPT } from "./fixture.ts";
import { semanticEvent } from "./semantic-trace.ts";

const mode = process.argv[2];
if (mode !== "regular" && mode !== "protocol") throw new Error("Invalid comparison mode");
const cwd = process.env.PI_CODING_AGENT_DIR;
if (!cwd) throw new Error("Missing isolated trial directory");
const send = (message: object) => { if (process.connected) process.send?.(message); };
const gates = new Gates();
const source = await createUxSession(cwd, gates);
let client: TuiClient | undefined;
let adapter: PiEventAdapter | undefined;
let run: Promise<void> | undefined;
let failed = false;
let stopping = false;
let ui: InteractiveMode | undefined;
const terminal = new CaptureTerminal(data => send({ type: "bytes", data }));
const trace: unknown[] = [];
const fail = (error: unknown) => {
  if (failed || stopping) return;
  failed = true;
  send({ type: "failure", reason: String(error) });
  adapter?.fail(error instanceof Error ? error : new Error(String(error)));
  void source.session.abort();
};
const unsubscribe = source.session.subscribe(event => {
  try {
    const selected = transcriptEvent(event);
    if (!selected) return;
    const record = semanticEvent(selected);
    trace.push(record);
    adapter?.accept(selected);
    send({ type: "event", event: record });
  } catch (error) { fail(error); }
});
if (mode === "regular") {
  const runtime = new AgentSessionRuntime(source.session, source.services, async () => { throw new Error("Session replacement is outside this trial"); });
  ui = new InteractiveMode(runtime, { terminal, tuiMode: "regular" });
  await ui.init();
} else {
  client = new TuiClient({ timeoutMs: 5000, write(bytes) { send({ type: "bytes", data: new TextDecoder().decode(bytes) }); } });
}
// Incoming controls are a private, loopback-only harness protocol, not terminal protocol messages.
process.on("message", (message: { type?: string; data?: string; cols?: number; gate?: string }) => {
  if (message.type === "stop") { void stop(); return; }
  if (stopping || failed) return;
  if (message.type === "reply" && typeof message.data === "string") {
    try {
      if (client) for (const event of client.receive(new TextEncoder().encode(message.data))) {
        if (event.type === "error" || (event.type === "message" && event.message.kind === "protocol.error")) throw new Error(JSON.stringify(event));
      }
    } catch (error) { fail(error); }
  } else if (message.type === "start" && !run) {
    run = (async () => {
      const context = client ? (await client.negotiate() ? await client.openContext() : undefined) : undefined;
      if (client && !context) throw new Error("Supporting terminal required");
      if (context) adapter = new PiEventAdapter(context);
      // Expand the native tool views while empty, not as a post-completion edit.
      // Both frontends therefore display the same fixed tool text, without truncation.
      if (mode === "regular") terminal.input("\x0f");
      await source.session.prompt(PROMPT);
      if (failed) return;
      if (adapter && adapter.state !== "finished") throw new Error("Adapter run did not finish");
      await context?.close();
      await delay(120);
      send({ type: "complete", trace, requests: source.requests() });
    })().catch(fail);
  } else if (message.type === "release" && ["stream", "tools", "shrink", "final"].includes(message.gate ?? "")) {
    gates.release(message.gate as "stream" | "tools" | "shrink" | "final");
  } else if (message.type === "resize" && Number.isInteger(message.cols) && message.cols! >= 30 && message.cols! <= 80) {
    terminal.resize(message.cols!);
    void delay(150).then(() => send({ type: "resized", cols: message.cols }));
  }
});
async function stop() {
  if (stopping) return;
  stopping = true;
  await source.session.abort();
  await run;
  unsubscribe(); client?.dispose(); source.session.dispose(); terminal.stop();
  process.exit(0); // Isolated process also owns Pi UI timers/watchers; not a reusable cleanup API.
}
process.on("disconnect", () => { void stop(); });
setTimeout(() => { send({ type: "failure", reason: "Fixture worker deadline" }); process.exit(1); }, 120_000).unref();
send({ type: "ready", mode });
