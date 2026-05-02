import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Globe, RefreshCw, Loader2, AlertCircle, CheckCircle, Zap, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getRunnerBaseUrl, projectRunnerFetch, projectRunnerJson, syncProjectFilesToRunner } from '../../lib/runner';
import type { ProjectFile } from '../../types';

interface Props {
  projectId: number;
  files: ProjectFile[];
  runnerUrl: string;
  onPreviewUrl?: (url: string) => void;
}

interface ServerState {
  running: boolean;
  pid?: number;
  url?: string;
  port?: number;
  logs: string[];
  starting: boolean;
  error?: string;
}

const COMMON_PORTS = [3000, 3001, 4000, 4173, 5173, 5174, 8000, 8080, 8888];

const PRESETS = [
  { label: 'Vite (React/Vue/Svelte)', cmd: 'npm run dev -- --host 0.0.0.0', port: 5173 },
  { label: 'Next.js', cmd: 'npm run dev', port: 3000 },
  { label: 'Create React App', cmd: 'npm start', port: 3000 },
  { label: 'Python HTTP server', cmd: 'python3 -m http.server 8080', port: 8080 },
  { label: 'Node / Express', cmd: 'node index.js', port: 3000 },
  { label: 'npm run build + serve', cmd: 'npm run build && npx serve dist -p 4173', port: 4173 },
];

async function pingPort(projectId: number, port: number): Promise<boolean> {
  try {
    const data = await projectRunnerJson<{ stdout?: string }>(projectId, 'run', {
        command: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/ --max-time 1`,
        timeout: 3000,
    });
    const code = parseInt(data.stdout ?? '0');
    return code >= 200 && code < 500;
  } catch { return false; }
}

export function DevServerPanel({ projectId, files, runnerUrl, onPreviewUrl }: Props) {
  const [state, setState] = useState<ServerState>({ running: false, logs: [], starting: false });
  const [cmd, setCmd] = useState('npm run dev -- --host 0.0.0.0');
  const [port, setPort] = useState(5173);
  const [customPreviewUrl, setCustomPreviewUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const base = getRunnerBaseUrl(runnerUrl);

  const pushLog = useCallback((line: string) => {
    setState((prev) => ({ ...prev, logs: [...prev.logs.slice(-199), line] }));
  }, []);

  const startServer = useCallback(async () => {
    if (!runnerUrl || !cmd.trim()) return;
    setState((prev) => ({ ...prev, starting: true, logs: [], error: undefined, running: false, url: undefined }));
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      pushLog(`$ ${cmd}`);
      pushLog(`[Syncing ${files.length} file${files.length === 1 ? '' : 's'} to runner...]`);
      await syncProjectFilesToRunner(projectId, files);
      pushLog('[Starting server — waiting for port to open...]');

      const res = await projectRunnerFetch(projectId, 'run', {
        command: cmd,
        stream: true,
        timeout: 300000,
      }, abort.signal);

      if (!res.ok || !res.body) {
        setState((prev) => ({ ...prev, starting: false, error: `Runner returned ${res.status}` }));
        return;
      }

      setState((prev) => ({ ...prev, running: true, starting: false }));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let detected = false;

      const detectUrl = async () => {
        if (detected) return;
        const alive = await pingPort(projectId, port);
        if (alive) {
          detected = true;
          const url = `http://${new URL(runnerUrl).hostname}:${port}`;
          setState((prev) => ({ ...prev, url }));
          onPreviewUrl?.(url);
          pushLog(`[Server detected at ${url}]`);
        }
      };

      pollRef.current = setInterval(detectUrl, 2000);
      setTimeout(detectUrl, 3000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim(); if (!raw) continue;
          try {
            const ev = JSON.parse(raw) as { type: string; data?: string; code?: number };
            if ((ev.type === 'stdout' || ev.type === 'stderr') && ev.data) {
              pushLog(ev.data.replace(/\n$/, ''));
              if (!detected && (ev.data.includes('localhost') || ev.data.includes('http://'))) {
                const m = ev.data.match(/https?:\/\/[^\s\n]+/);
                if (m) {
                  detected = true;
                  const url = m[0].replace('localhost', new URL(runnerUrl).hostname);
                  setState((prev) => ({ ...prev, url }));
                  onPreviewUrl?.(url);
                  pushLog(`[Preview URL detected: ${url}]`);
                }
              }
            }
            if (ev.type === 'exit') {
              pushLog(`[Server exited with code ${ev.code ?? 0}]`);
              setState((prev) => ({ ...prev, running: false }));
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setState((prev) => ({ ...prev, starting: false, running: false, error: err.message }));
      }
    }

    if (pollRef.current) clearInterval(pollRef.current);
    setState((prev) => ({ ...prev, running: false, starting: false }));
    abortRef.current = null;
  }, [runnerUrl, cmd, port, projectId, files, base, pushLog, onPreviewUrl]);

  const stopServer = useCallback(() => {
    abortRef.current?.abort();
    if (pollRef.current) clearInterval(pollRef.current);
    setState((prev) => ({ ...prev, running: false, starting: false }));
    pushLog('[Server stopped]');
  }, [pushLog]);

  const scanPorts = useCallback(async () => {
    if (!runnerUrl) return;
    setScanning(true); setScanResult([]);
    const open: number[] = [];
    for (const p of COMMON_PORTS) {
      const alive = await pingPort(projectId, p);
      if (alive) open.push(p);
    }
    setScanResult(open);
    setScanning(false);
  }, [runnerUrl, projectId]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const notConnected = !runnerUrl;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Dev Server</span>
        {state.running && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Running
          </span>
        )}
      </div>

      {notConnected ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <Globe className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">Runner not connected</p>
            <p className="text-[11px] text-muted-foreground/60">Configure a runner in Admin &rarr; Runner to start dev servers</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Preset</label>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.cmd}
                  onClick={() => { setCmd(p.cmd); setPort(p.port); }}
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded border transition-colors',
                    cmd === p.cmd
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-muted/20 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_80px] gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Command</label>
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                disabled={state.running || state.starting}
                placeholder="npm run dev"
                className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 3000)}
                disabled={state.running || state.starting}
                className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex gap-2">
            {state.running || state.starting ? (
              <button
                onClick={stopServer}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/30 text-red-400 hover:bg-red-600/30 text-xs font-medium transition-colors"
              >
                <Square className="w-3 h-3" /> Stop
              </button>
            ) : (
              <button
                onClick={startServer}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-600/30 text-green-400 hover:bg-green-600/30 text-xs font-medium transition-colors"
              >
                <Play className="w-3 h-3" /> Start
              </button>
            )}
            <button
              onClick={scanPorts}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/20 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors disabled:opacity-40"
            >
              {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Scan Ports
            </button>
          </div>

          {scanResult.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {scanResult.map((p) => {
                const url = `http://${new URL(runnerUrl).hostname}:${p}`;
                return (
                  <button
                    key={p}
                    onClick={() => { setState((prev) => ({ ...prev, url })); onPreviewUrl?.(url); }}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-green-400/30 bg-green-400/5 text-green-400 hover:bg-green-400/10 transition-colors"
                  >
                    <CheckCircle className="w-2.5 h-2.5" /> :{p}
                  </button>
                );
              })}
              {scanResult.length === 0 && !scanning && (
                <span className="text-[11px] text-muted-foreground/60">No open ports found</span>
              )}
            </div>
          )}

          {state.error && (
            <div className="flex items-center gap-2 text-[11px] text-destructive p-2 rounded-lg border border-destructive/20 bg-destructive/5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {state.error}
            </div>
          )}

          {state.url && (
            <div className="flex items-center gap-2 p-2 rounded-lg border border-green-400/20 bg-green-400/5">
              <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              <span className="text-[11px] text-green-400 font-mono truncate flex-1">{state.url}</span>
              <button onClick={() => window.open(state.url, '_blank')} className="text-green-400/70 hover:text-green-400 transition-colors">
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Manual Preview URL</label>
            <div className="flex gap-2">
              <input
                value={customPreviewUrl}
                onChange={(e) => setCustomPreviewUrl(e.target.value)}
                placeholder="http://your-droplet-ip:3000"
                className="flex-1 rounded border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
              <button
                onClick={() => { if (customPreviewUrl) { setState((prev) => ({ ...prev, url: customPreviewUrl })); onPreviewUrl?.(customPreviewUrl); } }}
                disabled={!customPreviewUrl}
                className="px-2 py-1 rounded border border-border bg-muted/30 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                Open
              </button>
            </div>
          </div>

          {state.logs.length > 0 && (
            <div className="rounded border border-border/50 bg-[#0d1117] overflow-hidden">
              <div className="px-2 py-1 border-b border-border/30 text-[10px] text-muted-foreground/50 font-mono">
                Server logs ({state.logs.length} lines)
              </div>
              <div className="max-h-48 overflow-y-auto p-2 space-y-0.5">
                {state.logs.map((line, i) => (
                  <div key={i} className={cn(
                    'text-[11px] font-mono leading-4 whitespace-pre-wrap break-all',
                    line.startsWith('[') ? 'text-cyan-400/70' : 'text-gray-400',
                  )}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.starting && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting server, waiting for port {port}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
