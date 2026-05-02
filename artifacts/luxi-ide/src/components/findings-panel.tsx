import { useState, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search, Trash2, ChevronRight, ChevronDown } from "lucide-react";

type Finding = {
  id: number;
  title: string;
  body: string;
  kind: string;
  tags: string;
  updatedAt: string;
};

const KIND_COLORS: Record<string, string> = {
  vuln: "bg-red-500/15 text-red-400 border-red-500/30",
  ioc: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  credential: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  endpoint: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  binary: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  model: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  todo: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  note: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function relTime(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

interface Props {
  projectId: number;
}

export function FindingsPanel({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Finding[]>([]);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const url = query.trim()
        ? `/api/projects/${projectId}/findings?q=${encodeURIComponent(query.trim())}`
        : `/api/projects/${projectId}/findings`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {}
  }, [projectId, query]);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/findings/count`);
      if (!res.ok) return;
      const data = await res.json();
      setCount(typeof data?.count === "number" ? data.count : 0);
    } catch {}
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    refresh();
    const t = setInterval(() => { if (!cancelled) refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [open, refresh]);

  useEffect(() => {
    let cancelled = false;
    refreshCount();
    const t = setInterval(() => { if (!cancelled) refreshCount(); }, 8000);
    return () => { cancelled = true; clearInterval(t); };
  }, [refreshCount]);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm("Delete this finding?")) return;
    try {
      await fetch(`/api/findings/${id}`, { method: "DELETE" });
      setItems(prev => prev.filter(f => f.id !== id));
      refreshCount();
    } catch {}
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" title="Research findings & notes">
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Notes</span>
          {count > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{count}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[480px] sm:w-[560px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Research findings
          </SheetTitle>
        </SheetHeader>
        <div className="relative mt-3 mb-2">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, body, tags…"
            className="pl-7 h-8 text-xs"
          />
        </div>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {items.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">
              {query ? "No findings match." : "No findings yet. The agent will save them here as research progresses."}
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map(f => {
                const isExp = expanded.has(f.id);
                const kindClass = KIND_COLORS[f.kind] ?? KIND_COLORS.note;
                return (
                  <div key={f.id} className="group border border-border rounded-md bg-muted/20 hover:bg-muted/40 transition-colors">
                    <button
                      onClick={() => toggleExpand(f.id)}
                      className="w-full flex items-start gap-2 p-2 text-left"
                    >
                      {isExp ? <ChevronDown className="w-3 h-3 mt-0.5 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0 text-muted-foreground" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[9px] px-1 py-0 rounded border ${kindClass}`}>{f.kind}</span>
                          <span className="text-xs font-medium truncate">{f.title}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{relTime(f.updatedAt)}</span>
                          {f.tags && <span className="text-[10px] text-muted-foreground/70 truncate">{f.tags}</span>}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDelete(f.id, e)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 p-1 rounded hover:bg-red-500/20 hover:text-red-400 transition-all flex-shrink-0"
                        title="Delete finding"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </button>
                    {isExp && (
                      <div className="px-2 pb-2 -mt-1 ml-5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed border-t border-border/60 pt-2">
                        {f.body.length > 4000 ? f.body.slice(0, 4000) + "\n\n…(truncated, " + (f.body.length - 4000) + " more chars)" : f.body}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
