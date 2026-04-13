import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "child_process";
import type { Server, IncomingMessage } from "http";
import { logger } from "./lib/logger";

const MAX_SESSIONS = 5;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

let activeSessions = 0;

function validateOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

export function setupTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/ws/terminal" || url.pathname === "/api/ws/terminal") {
      if (!validateOrigin(req)) {
        logger.warn("Terminal WebSocket rejected: invalid origin");
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      if (activeSessions >= MAX_SESSIONS) {
        logger.warn({ activeSessions }, "Terminal WebSocket rejected: max sessions reached");
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    activeSessions++;
    logger.info({ activeSessions }, "Terminal WebSocket connected");

    const shell = process.env.SHELL || "/bin/bash";
    const cwd = process.env.HOME || "/home/runner";

    let proc: ChildProcess;
    try {
      proc = spawn(shell, ["-i"], {
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      logger.error({ err }, "Failed to spawn shell");
      ws.send("\r\n\x1b[31mFailed to start shell process.\x1b[0m\r\n");
      ws.close();
      activeSessions--;
      return;
    }

    if (!proc.stdout || !proc.stdin || !proc.stderr) {
      ws.send("\r\n\x1b[31mFailed to start shell process.\x1b[0m\r\n");
      ws.close();
      activeSessions--;
      return;
    }

    let idleTimer = setTimeout(() => {
      logger.info("Terminal idle timeout — closing");
      ws.send("\r\n\x1b[33m⏱ Terminal closed due to inactivity.\x1b[0m\r\n");
      cleanup();
    }, IDLE_TIMEOUT_MS);

    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logger.info("Terminal idle timeout — closing");
        ws.send("\r\n\x1b[33m⏱ Terminal closed due to inactivity.\x1b[0m\r\n");
        cleanup();
      }, IDLE_TIMEOUT_MS);
    };

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(idleTimer);
      activeSessions--;
      try { proc.kill("SIGTERM"); } catch {}
      try { ws.close(); } catch {}
      logger.info({ activeSessions }, "Terminal session cleaned up");
    };

    proc.stdout.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString("utf-8"));
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.toString("utf-8"));
      }
    });

    proc.on("error", (err) => {
      logger.error({ err }, "Shell process error");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[31mShell error: ${err.message}\x1b[0m\r\n`);
      }
      cleanup();
    });

    proc.on("exit", (code) => {
      logger.info({ code }, "Shell process exited");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[33mShell exited with code ${code}\x1b[0m\r\n`);
      }
      cleanup();
    });

    ws.on("message", (data: Buffer | string) => {
      resetIdle();
      const msg = data.toString();

      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          return;
        }
        if (parsed.type === "input" && parsed.data) {
          proc.stdin!.write(parsed.data);
          return;
        }
      } catch {
        // raw text
      }

      proc.stdin!.write(msg);
    });

    ws.on("close", () => {
      cleanup();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "Terminal WebSocket error");
      cleanup();
    });
  });
}
