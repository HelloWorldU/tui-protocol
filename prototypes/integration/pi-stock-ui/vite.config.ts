import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import * as pty from "node-pty";
import { bindPtyConnection } from "../pty-demo/connection.ts";

// Same single-child PTY bridge as the pty-demo host, on this trial's own port and
// geometry: Pi's chrome needs more than the 40x8 demo viewport. `?stock=1` on the
// WebSocket URL spawns the child with the protocol path disabled (trial flag off).
const port = 4181;
const origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString("hex");

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [{
    name: "pi-stock-ui-pty-host",
    transformIndexHtml: () => [{ tag: "meta", attrs: { name: "pty-token", content: token }, injectTo: "head" }],
    configureServer(server) {
      if (process.platform !== "win32") throw new Error("This fixture currently requires Windows and bundled ConPTY.");
      const sockets = new WebSocketServer({ noServer: true, maxPayload: 262144 });
      let active: WebSocket | undefined;
      server.httpServer!.on("upgrade", (request, socket, head) => {
        let url: URL;
        try { url = new URL(request.url ?? "/", origin); }
        catch { socket.destroy(); return; }
        if (url.pathname !== "/pty") return;
        if (request.headers.origin !== origin || request.headers.host !== `127.0.0.1:${port}` ||
            url.searchParams.get("token") !== token || active !== undefined) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
        }
        const stock = url.searchParams.get("stock") === "1";
        const paceParam = url.searchParams.get("pace");
        const pace = paceParam !== null && /^\d+$/.test(paceParam) ? Number(paceParam) : undefined;
        sockets.handleUpgrade(request, socket, head, client => sockets.emit("connection", client, stock, pace));
      });
      sockets.on("connection", (client: WebSocket, stock: boolean, pace: number | undefined) => {
        active = client;
        let child: pty.IPty;
        try {
          child = pty.spawn(process.execPath, [fileURLToPath(new URL("./main.ts", import.meta.url))], {
            name: "xterm-256color", cols: 60, rows: 24, cwd: process.cwd(),
            env: {
              ...process.env,
              ...(stock ? { PI_STOCK_UI_OFF: "1" } : {}),
              ...(pace !== undefined && pace > 0 && pace <= 10_000 ? { PI_TRIAL_PACE: String(pace) } : {}),
            },
            useConptyDll: true,
          });
        } catch (error) { active = undefined; client.close(1011, "PTY spawn failed"); console.error(error); return; }
        bindPtyConnection(client, child, undefined, () => { if (active === client) active = undefined; });
      });
      server.httpServer!.on("close", () => { for (const client of sockets.clients) client.terminate(); sockets.close(); });
    },
  }],
  build: { rolldownOptions: { input: {
    trial: fileURLToPath(new URL("./index.html", import.meta.url)),
    checks: fileURLToPath(new URL("./checks.html", import.meta.url)),
  } } },
});
