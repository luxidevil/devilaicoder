import { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal, Play, Square, Trash2, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { projectRunnerFetch, syncProjectFilesToRunner } from '../../lib/runner';
import type { ProjectFile } from '../../types';

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'info' | 'cmd' | 'exit';
  text: string;
  ts: number;
}

interface TerminalSession {
  id: string;
  title: string;
  lines: TerminalLine[];
  running: boolean;
}

interface Props {
  projectId: number;
  files: ProjectFile[];
  runnerUrl: string;
}

const SHELL_PRESETS = [
  { label: 'npm install', cmd: 'npm install' },
  { label: 'npm run dev', cmd: 'npm run dev' },
  { label: 'npm run build', cmd: 'npm run build' },
  { label: 'python -m http.server', cmd: 'python3 -m http.server 8080' },
  { label: 'ls -la', cmd: 'ls -la' },
];

function newSession(id: string): TerminalSession {
  return { id, title: `Terminal ${id}`, lines: [], running: false };
}

export function TerminalPanel({ projectId, files, runnerUrl }: Props) {
  const [sessions, setSessions] = useState<TerminalSession[]>(() => [newSession('1')]);
  const [activeId, setActiveId] = useState('1');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [showPresets, setShowPresets] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<Record<string, AbortController>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(2);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.lines]);

  const pushLine = useCallback((sessionId: string, line: TerminalLine) => {
    setSessions((prev) =>
      prev.map((s) => s.id === sessionId ? { ...s, lines: [...s.lines, line] } : s),
    );
  }, []);

  const setRunning = useCallback((sessionId: string, running: boolean) => {
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, running } : s));
  }, []);

  const runCommand = useCallback(async (cmd: string, sessionId: string) => {
    if (!runnerUrl || !cmd.trim()) return;
    const abort = new AbortController();
    abortRef.current[sessionId] = abort;
    setRunning(sessionId, true);
    pushLine(sessionId, { type: 'cmd', text: `$ ${cmd}`, ts: Date.now() });

    try {
      await syncProjectFilesToRunner(projectId, files);

      const res = await projectRunnerFetch(projectId, 'run', {
        command: cmd,
        stream: true,
        timeout: 120000,
      }, abort.signal);

      if (!res.ok || !res.body) {
        pushLine(sessionId, { type: 'stderr', text: `[ERROR] Runner returned ${res.status}`, ts: Date.now() });
        setRunning(sessionId, false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const ev = JSON.parse(raw) as { type: string; data?: string; code?: number };
            if (ev.type === 'stdout' && ev.data) pushLine(sessionId, { type: 'stdout', text: ev.data, ts: Date.now() });
            if (ev.type === 'stderr' && ev.data) pushLine(sessionId, { type: 'stderr', text: ev.data, ts: Date.now() });
            if (ev.type === 'exit') pushLine(sessionId, { type: 'exit', text: `[exited with code ${ev.code ?? 0}]`, ts: Date.now() });
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        pushLine(sessionId, { type: 'stderr', text: `[ERROR] ${err.message}`, ts: Date.now() });
      }
    }
    setRunning(sessionId, false);
    delete abortRef.current[sessionId];
  }, [runnerUrl, projectId, files, pushLine, setRunning]);

  const handleSubmit = () => {
    const cmd = input.trim();
    if (!cmd || !active) return;
    setHistory((h) => [cmd, ...h.slice(0, 99)]);
    setHistoryIdx(-1);
    setInput('');
    runCommand(cmd, active.id);
  };

  const addSession = () => {
    const id = String(nextId.current++);
    setSessions((prev) => [...prev, newSession(id)]);
    setActiveId(id);
  };

  const closeSession = (id: string) => {
    abortRef.current[id]?.abort();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeId === id && next.length > 0) setActiveId(next[next.length - 1].id);
      return next.length > 0 ? next : [newSession('1')];
    });
  };

  const clearSession = () => {
    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, lines: [] } : s));
  };

  const stopSession = () => {
    abortRef.current[activeId]?.abort();
    delete abortRef.current[activeId];
    setRunning(activeId, false);
    pushLine(activeId, { type: 'info', text: '[interrupted]', ts: Date.now() });
  };

  const notConnected = !runnerUrl;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117] font-mono text-[12px]">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card flex-shrink-0 overflow-x-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer flex-shrink-0 transition-colors select-none group',
              activeId === s.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
            )}
          >
            <Terminal className="w-3 h-3" />
            <span className="text-[11px]">{s.title}</span>
            {s.running && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            <button
              onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
        <button
          onClick={addSession}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded transition-colors flex-shrink-0"
        >
          <Plus className="w-3 h-3" />
        </button>
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {active?.running && (
            <button onClick={stopSession} className="p-1 text-red-400 hover:bg-red-400/10 rounded transition-colors" title="Stop">
              <Square className="w-3 h-3" />
            </button>
          )}
          <button onClick={clearSession} className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded transition-colors" title="Clear">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {notConnected ? (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <Terminal className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">Runner not connected</p>
            <p className="text-[11px] text-muted-foreground/60">Configure a runner in Admin &rarr; Runner to enable the terminal</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {active?.lines.length === 0 && (
              <p className="text-muted-foreground/40 text-[11px] select-none">Runner connected — type a command below</p>
            )}
            {active?.lines.map((line, i) => (
              <div key={i} className={cn(
                'leading-5 whitespace-pre-wrap break-all',
                line.type === 'cmd' && 'text-cyan-400',
                line.type === 'stdout' && 'text-gray-300',
                line.type === 'stderr' && 'text-red-400',
                line.type === 'info' && 'text-muted-foreground/50 italic',
                line.type === 'exit' && 'text-muted-foreground/50 italic',
              )}>
                {line.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border/50 flex-shrink-0">
            {showPresets && (
              <div className="border-b border-border/50 p-2 flex flex-wrap gap-1">
                {SHELL_PRESETS.map((p) => (
                  <button
                    key={p.cmd}
                    onClick={() => { setInput(p.cmd); setShowPresets(false); inputRef.current?.focus(); }}
                    className="text-[10px] px-2 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => setShowPresets((v) => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                {showPresets ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              <span className="text-cyan-400 flex-shrink-0 select-none">$</span>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const idx = Math.min(historyIdx + 1, history.length - 1);
                    setHistoryIdx(idx);
                    setInput(history[idx] ?? '');
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const idx = Math.max(historyIdx - 1, -1);
                    setHistoryIdx(idx);
                    setInput(idx === -1 ? '' : history[idx]);
                  }
                  if (e.key === 'c' && e.ctrlKey) stopSession();
                }}
                disabled={active?.running}
                placeholder={active?.running ? 'Running...' : 'Enter command...'}
                className="flex-1 bg-transparent text-gray-200 placeholder:text-muted-foreground/40 outline-none text-[12px] disabled:opacity-50"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                onClick={handleSubmit}
                disabled={!input.trim() || active?.running}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors flex-shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
