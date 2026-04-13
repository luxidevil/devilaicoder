import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { X, Terminal as TerminalIcon, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TerminalHandle {
  sendCommand: (command: string) => void;
}

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  onReady?: (handle: TerminalHandle) => void;
}

export function TerminalPanel({ isOpen, onClose, onToggleMaximize, isMaximized, onReady }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [connected, setConnected] = useState(false);

  const connectTerminal = useCallback(() => {
    if (!termRef.current || xtermRef.current) return;

    const xterm = new XTerminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'Geist Mono', 'Fira Code', 'JetBrains Mono', monospace",
      theme: {
        background: "#0a0a0f",
        foreground: "#e4e4e7",
        cursor: "#a78bfa",
        selectionBackground: "#a78bfa33",
        black: "#18181b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(termRef.current);

    xtermRef.current = xterm;
    fitRef.current = fitAddon;

    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 50);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/terminal`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      xterm.writeln("\x1b[1;35m⚡ Luxi Terminal Connected\x1b[0m");
      xterm.writeln("");
      onReady?.({
        sendCommand: (command: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data: command + "\n" }));
          }
        },
      });
    };

    ws.onmessage = (event) => {
      xterm.write(event.data);
    };

    ws.onclose = () => {
      setConnected(false);
      xterm.writeln("\r\n\x1b[33m⚠ Terminal disconnected\x1b[0m");
    };

    ws.onerror = () => {
      setConnected(false);
      xterm.writeln("\r\n\x1b[31m✖ Connection error\x1b[0m");
    };

    xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    resizeObserverRef.current?.disconnect();
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(termRef.current);
    resizeObserverRef.current = resizeObserver;
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timeout = setTimeout(connectTerminal, 100);
      return () => clearTimeout(timeout);
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    fitRef.current = null;
    setConnected(false);
    return undefined;
  }, [isOpen, connectTerminal]);

  useEffect(() => {
    if (isOpen && fitRef.current) {
      setTimeout(() => {
        try { fitRef.current?.fit(); } catch {}
      }, 100);
    }
  }, [isOpen, isMaximized]);

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full border-t border-border bg-[#0a0a0f]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-card border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-primary/70" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terminal</span>
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            connected ? "bg-green-500" : "bg-muted-foreground/40"
          )} />
        </div>
        <div className="flex items-center gap-1">
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            data-testid="button-close-terminal"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div ref={termRef} className="flex-1 overflow-hidden p-1" />
    </div>
  );
}
