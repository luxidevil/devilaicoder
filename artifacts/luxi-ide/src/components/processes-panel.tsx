import { useEffect, useState } from "react";
import { Activity, X, RotateCw, Globe, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ProcessInfo {
  name: string;
  pid?: number;
  command: string;
  alive: boolean;
  exitCode: number | null;
  port: number | null;
  startedAt: number;
  uptimeSec: number;
  lastLine: string;
}

interface Props {
  projectId: number;
  onOpenPreview: (port: number) => void;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
}

export function ProcessesPanel({ projectId, onOpenPreview }: Props) {
  const [open, setOpen] = useState(false);
  const [procs, setProcs] = useState<ProcessInfo[]>([]);
  const [aliveCount, setAliveCount] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});

  // Lightweight poll for the count badge (every 5s) regardless of open state
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(`/api/projects/${projectId}/processes`);
        if (!r.ok) return;
        const data: ProcessInfo[] = await r.json();
        if (cancelled) return;
        setAliveCount(data.filter(p => p.alive).length);
        if (open) setProcs(data);
      } catch {}
    }
    tick();
    const int = setInterval(tick, open ? 2500 : 5000);
    return () => { cancelled = true; clearInterval(int); };
  }, [projectId, open]);

  const handleStop = async (name: string) => {
    await fetch(`/api/projects/${projectId}/processes/${encodeURIComponent(name)}`, { method: "DELETE" });
  };

  const toggleExpand = async (name: string) => {
    if (expanded === name) { setExpanded(null); return; }
    setExpanded(name);
    try {
      const r = await fetch(`/api/projects/${projectId}/processes/${encodeURIComponent(name)}/logs?tail=200`);
      if (!r.ok) return;
      const data = await r.json();
      setLogs(prev => ({ ...prev, [name]: data.lines }));
    } catch {}
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-processes"
          title="Running processes"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Procs</span>
          {aliveCount > 0 && (
            <Badge variant="default" className="h-4 px-1.5 text-[10px] bg-green-500/20 text-green-400 border-0">
              {aliveCount}
            </Badge>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Running Processes
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {procs.filter(p => p.alive).length} alive · {procs.length} total
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {procs.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No processes running.<br />
              Ask the agent to start a dev server.
            </div>
          )}

          {procs.map((p) => (
            <div key={p.name} className="border border-border rounded-md overflow-hidden bg-card">
              <div className="flex items-center gap-2 px-3 py-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.alive ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
                <button
                  onClick={() => toggleExpand(p.name)}
                  className="flex items-center gap-1 text-xs font-medium hover:text-primary transition-colors"
                >
                  <ChevronRight className={`w-3 h-3 transition-transform ${expanded === p.name ? "rotate-90" : ""}`} />
                  {p.name}
                </button>
                {p.port && (
                  <button
                    onClick={() => onOpenPreview(p.port!)}
                    className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    title={`Open localhost:${p.port} in preview`}
                  >
                    <Globe className="w-2.5 h-2.5" />
                    :{p.port}
                  </button>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {p.alive ? fmtUptime(p.uptimeSec) : `exit ${p.exitCode ?? "?"}`}
                </span>
                {p.alive && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-red-400"
                    onClick={() => handleStop(p.name)}
                    title="Stop process"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>

              <div className="px-3 pb-2 text-[10px] text-muted-foreground font-mono truncate">
                $ {p.command}
              </div>

              {p.lastLine && (
                <div className="px-3 pb-2 text-[10px] font-mono text-muted-foreground/70 truncate">
                  {p.lastLine}
                </div>
              )}

              {expanded === p.name && (
                <div className="bg-black/40 border-t border-border max-h-64 overflow-auto">
                  <pre className="text-[10px] font-mono text-foreground/80 p-2 whitespace-pre-wrap break-words">
                    {(logs[p.name] || []).join("\n") || "(no output yet)"}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {procs.length > 0 && (
            <button
              onClick={async () => {
                const r = await fetch(`/api/projects/${projectId}/processes`);
                if (r.ok) setProcs(await r.json());
              }}
              className="w-full text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1"
            >
              <RotateCw className="w-3 h-3" />
              Refresh
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
