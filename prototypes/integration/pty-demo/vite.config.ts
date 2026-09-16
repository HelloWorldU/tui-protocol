import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import * as pty from "node-pty";
import { FlowWindow } from "./flow-window.ts";

const origin = "http://127.0.0.1:4178";
export function createPtyHost(producer: string, javascriptOnly = false, flowControl?: { high: number; low: number }) {
  if (flowControl) new FlowWindow(flowControl.high, flowControl.low);
  const token = randomBytes(32).toString("hex");
  return defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    server: { host: "127.0.0.1", port: 4178, strictPort: true },
    plugins: [{
      name: "fixed-local-pty-demo",
      transformIndexHtml: () => [{ tag: "meta", attrs: { name: "pty-token", content: token }, injectTo: "head" }],
      configureServer(server) {
        if (process.platform !== "win32") throw new Error("This fixture currently requires Windows and bundled ConPTY.");
        const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384 });
        let active: WebSocket | undefined;
        server.httpServer!.on("upgrade", (request, socket, head) => {
          let url: URL;
          try { url = new URL(request.url ?? "/", origin); }
          catch { socket.destroy(); return; }
          if (url.pathname !== "/pty") return;
          if (request.headers.origin !== origin || request.headers.host !== "127.0.0.1:4178" ||
              url.searchParams.get("token") !== token || active !== undefined) {
            socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
          }
          sockets.handleUpgrade(request, socket, head, client => sockets.emit("connection", client));
        });
        sockets.on("connection", client => {
          active = client;
          let child: pty.IPty;
          try {
            child = pty.spawn(process.execPath, [...(javascriptOnly ? ["--no-experimental-strip-types"] : []), producer], { name: "xterm-256color", cols: 40, rows: 8,
              cwd: process.cwd(), env: process.env, useConptyDll: true });
          } catch (error) { active = undefined; client.close(1011, "PTY spawn failed"); console.error(error); return; }
          let exited = false;
          let exitCode: number | undefined;
          let peakSocketBytes = 0;
          const window = flowControl ? new FlowWindow(flowControl.high, flowControl.low) : undefined;
          const reportFlow = () => {
            if (window && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
              type: "flow", sent: window.sent, consumed: window.consumed,
              outstanding: window.outstanding, peak: window.peak, paused: window.paused,
              pauses: window.pauses, resumes: window.resumes, peakSocketBytes,
            }));
          };
          const finishExit = () => {
            if (exitCode === undefined || (window && window.outstanding !== 0) || client.readyState !== WebSocket.OPEN) return;
            reportFlow();
            client.send(JSON.stringify({ type: "exit", code: exitCode }));
            client.close(1000, "Child exited");
          };
          const timer = setTimeout(() => client.close(1000, "Demo time limit"), 10 * 60_000);
          const dataSubscription = child.onData(data => {
            if (client.readyState !== WebSocket.OPEN) return;
            try {
              const bytes = Buffer.from(data, "utf8");
              if (window?.add(bytes.length)) child.pause();
              client.send(bytes);
              peakSocketBytes = Math.max(peakSocketBytes, client.bufferedAmount);
              reportFlow();
            } catch { client.close(1011, "PTY forwarding failed"); }
          });
          const exitSubscription = child.onExit(event => {
            exited = true;
            exitCode = event.exitCode;
            finishExit();
          });
          client.on("message", (bytes, binary) => {
            try {
              if (binary) { if (!exited) child.write(bytes.toString("utf8")); return; }
              const message = JSON.parse(bytes.toString());
              if (window && message.type === "consumed") {
                if (window.acknowledge(message.total) && !exited) child.resume();
                reportFlow(); finishExit(); return;
              }
              if (exited) return;
              if (message.type !== "resize" || !Number.isInteger(message.cols) || !Number.isInteger(message.rows) ||
                  message.cols < 10 || message.cols > 160 || message.rows < 4 || message.rows > 50) throw new Error("Invalid resize");
              child.resize(message.cols, message.rows);
            } catch { client.close(1008, "Invalid host command"); }
          });
          client.on("error", () => client.close());
          client.on("close", () => {
            clearTimeout(timer);
            dataSubscription.dispose(); exitSubscription.dispose();
            if (!exited) child.kill();
            if (active === client) active = undefined;
          });
        });
        server.httpServer!.on("close", () => { for (const client of sockets.clients) client.terminate(); sockets.close(); });
      },
    }],
  });
}

export default createPtyHost(fileURLToPath(new URL("./producer.ts", import.meta.url)));
