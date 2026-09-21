import { randomBytes } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { WebSocket, WebSocketServer } from "ws";

/** Isolated fixed worker, not an arbitrary command runner or a general terminal host. */
export function comparisonServer(): Plugin {
  const token = randomBytes(32).toString("hex");
  const origin = "http://127.0.0.1:4179";
  return {
    name: "pi-ux-comparison",
    transformIndexHtml: () => [{ tag: "meta", attrs: { name: "ux-token", content: token }, injectTo: "head" }],
    configureServer(server) {
      const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384 });
      let active: WebSocket | undefined;
      server.httpServer!.on("upgrade", (request, socket, head) => {
        let url: URL;
        try { url = new URL(request.url ?? "/", origin); }
        catch { socket.destroy(); return; }
        if (url.pathname !== "/comparison") return;
        if (request.headers.origin !== origin || request.headers.host !== "127.0.0.1:4179" ||
            url.searchParams.get("token") !== token || active || !["regular", "protocol"].includes(url.searchParams.get("mode") ?? "")) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
        }
        sockets.handleUpgrade(request, socket, head, client => {
          active = client;
          void start(client, url.searchParams.get("mode")!).catch(error => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "failure", reason: String(error) }));
            client.close(); active = undefined;
          });
        });
      });
      async function start(client: WebSocket, mode: string) {
        const directory = await mkdtemp(join(tmpdir(), "tui-pi-ux-"));
        if (client.readyState !== WebSocket.OPEN) { await rm(directory, { recursive: true, force: true }); active = undefined; return; }
        let child: ChildProcess;
        try {
          child = fork(fileURLToPath(new URL("./worker.ts", import.meta.url)), [mode], {
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1", PI_TELEMETRY: "0" },
          });
        } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
        let exited = false;
        const deadline = setTimeout(() => child.kill(), 125_000);
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        let stderr = "";
        child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
        child.stdout?.resume(); // UI startup diagnostics are not terminal drawing output.
        child.on("message", message => {
          if (client.readyState !== WebSocket.OPEN) return;
          if (client.bufferedAmount > 2 * 1024 * 1024) { client.close(1011, "Trial output budget exceeded"); return; }
          client.send(JSON.stringify(message));
        });
        child.on("error", error => {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "failure", reason: String(error) }));
        });
        client.on("message", bytes => {
          try {
            const message = JSON.parse(String(bytes));
            if (!["reply", "start", "release", "resize", "stop"].includes(message.type)) throw new Error("Invalid fixture control");
            if (child.connected) child.send(message);
          } catch { client.close(1008, "Invalid fixture control"); }
        });
        client.on("close", () => {
          if (exited) return;
          if (child.connected) child.send({ type: "stop" });
          cleanupTimer = setTimeout(() => child.kill(), 2000);
        });
        child.on("close", (code, signal) => {
          exited = true;
          clearTimeout(deadline); clearTimeout(cleanupTimer);
          // directory is the exact mkdtemp allocation, never a caller-supplied path.
          void rm(directory, { recursive: true, force: true }).then(() => {
            if (active === client) active = undefined;
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "exit", code, signal, ...(code !== 0 ? { reason: stderr } : {}) }));
              client.close();
            }
          }).catch(error => {
            console.error("Pi UX temporary-directory cleanup failed", error);
            if (active === client) active = undefined;
            client.close(1011, "Trial cleanup failed");
          });
        });
      }
      server.httpServer!.on("close", () => { for (const client of sockets.clients) client.close(); sockets.close(); });
    },
  };
}
