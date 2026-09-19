import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import * as pty from "node-pty";
import { FlowWindow } from "./flow-window.ts";
import { ConsumptionWatchdog } from "./consumption-watchdog.ts";
import { bindPtyConnection } from "./connection.ts";

const origin = "http://127.0.0.1:4178";
export function createPtyHost(producer: string, javascriptOnly = false, flowControl?: { high: number; low: number; stallMs?: number }) {
  if (flowControl) new FlowWindow(flowControl.high, flowControl.low);
  if (flowControl?.stallMs !== undefined) new ConsumptionWatchdog(flowControl.stallMs, () => {}).dispose();
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
          bindPtyConnection(client, child, flowControl, () => { if (active === client) active = undefined; });
        });
        server.httpServer!.on("close", () => { for (const client of sockets.clients) client.terminate(); sockets.close(); });
      },
    }],
  });
}

export default createPtyHost(fileURLToPath(new URL("./producer.ts", import.meta.url)));
