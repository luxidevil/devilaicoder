import { useState, useEffect, useCallback, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Database, RefreshCw, Search } from "lucide-react";

interface SearchHit {
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
  preview: string;
}

interface IndexStats {
  chunks: number;
  files: number;
  lastUpdated: string | null;
}

interface Props {
  projectId: number;
  onOpenFile?: (path: string, line?: number) => void;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function CodebasePanel({ projectId, onOpenFile }: Props) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<IndexStats>({ chunks: 0, files: 0, lastUpdated: null });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const indexPollRef = useRef<{ tick: number | null; stop: number | null }>({ tick: null, stop: null });

  // Clear any in-flight indexing pollers on unmount to avoid leaked timers.
  useEffect(() => {
    return () => {
      if (indexPollRef.current.tick !== null) clearInterval(indexPollRef.current.tick);
      if (indexPollRef.current.stop !== null) clearTimeout(indexPollRef.current.stop);
    };
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/index/stats`);
      if (!res.ok) return;
      const data = await res.json();
      setStats({
        chunks: Number(data?.chunks ?? 0),
        files: Number(data?.files ?? 0),
        lastUpdated: data?.lastUpdated ?? null,
      });
    } catch { /* noop */ }
  }, [projectId]);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  useEffect(() => {
    if (!open) return;
    refreshStats();
    setTimeout(() => inputRef.current?.focus(), 60);
    const t = setInterval(refreshStats, 5000);
    return () => clearInterval(t);
  }, [open, refreshStats]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) { setHits([]); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, k: 12 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        setHits([]);
      } else {
        setHits(Array.isArray(data?.hits) ? data.hits : []);
        if (data?.stats) setStats({
          chunks: Number(data.stats.chunks ?? 0),
          files: Number(data.stats.files ?? 0),
          lastUpdated: data.stats.lastUpdated ?? null,
        });
        if (data?.hint) setError(data.hint);
      }
    } catch (err: any) {
      setError(err.message);
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, query]);

  const triggerIndex = useCallback(async (full: boolean) => {
    setIndexing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 202) {
        setError(data?.error || `HTTP ${res.status}`);
      }
      // Background job — poll stats for ~60s. Stash refs so unmount cleans up.
      if (indexPollRef.current.tick !== null) clearInterval(indexPollRef.current.tick);
      if (indexPollRef.current.stop !== null) clearTimeout(indexPollRef.current.stop);
      const tick = window.setInterval(() => { refreshStats(); }, 1500);
      const stop = window.setTimeout(() => {
        clearInterval(tick);
        indexPollRef.current.tick = null;
        indexPollRef.current.stop = null;
        setIndexing(false);
      }, 60_000);
      indexPollRef.current = { tick, stop };
    } catch (err: any) {
      setError(err.message);
      setIndexing(false);
    }
  }, [projectId, refreshStats]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); runSearch(); }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5" data-testid="button-codebase-panel">
          <Database className="h-3.5 w-3.5" />
          <span className="text-xs">Codebase</span>
          {stats.chunks > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">{stats.chunks}</Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[560px] sm:max-w-[560px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Codebase Search
          </SheetTitle>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 py-2 text-xs text-muted-foreground border-b">
          <div>
            <span className="text-foreground font-medium">{stats.chunks}</span> chunks /{" "}
            <span className="text-foreground font-medium">{stats.files}</span> files
            <span className="ml-2">· updated {relTime(stats.lastUpdated)}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={indexing} onClick={() => triggerIndex(false)} data-testid="button-reindex">
              <RefreshCw className={`h-3 w-3 ${indexing ? "animate-spin" : ""}`} />
              <span className="ml-1 text-xs">{indexing ? "Indexing…" : "Refresh"}</span>
            </Button>
            <Button size="sm" variant="ghost" disabled={indexing} onClick={() => triggerIndex(true)} title="Re-embed everything from scratch">
              <span className="text-xs">Full</span>
            </Button>
          </div>
        </div>

        <div className="flex gap-2 py-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="What are you looking for? e.g. 'where do we validate the session'"
            className="text-xs"
            data-testid="input-codebase-search"
          />
          <Button size="sm" onClick={runSearch} disabled={loading || !query.trim()} data-testid="button-codebase-run-search">
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>

        {error && (
          <div className="text-xs text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded p-2 mb-2">
            {error}
          </div>
        )}

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2 pb-4">
            {hits.length === 0 && !loading && !error && (
              <div className="text-xs text-muted-foreground text-center py-8">
                {stats.chunks === 0
                  ? "Index is empty. Click Refresh to build it."
                  : "Type a natural-language query and press Enter."}
              </div>
            )}
            {hits.map((h, i) => (
              <button
                key={`${h.filePath}-${h.startLine}-${i}`}
                onClick={() => onOpenFile?.(h.filePath, h.startLine)}
                className="w-full text-left border border-border rounded p-2 hover:border-primary/60 hover:bg-accent/20 transition-colors"
                data-testid={`hit-${i}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-mono truncate text-primary">
                    {h.filePath}:{h.startLine}-{h.endLine}
                  </span>
                  <Badge variant="secondary" className="h-4 px-1 text-[10px] shrink-0">
                    {(h.similarity * 100).toFixed(0)}%
                  </Badge>
                </div>
                <pre className="text-[10px] leading-snug font-mono text-muted-foreground whitespace-pre-wrap line-clamp-6">
                  {h.preview}
                </pre>
              </button>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
