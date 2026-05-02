import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, FileText, Regex, CaseSensitive } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FindFile {
  id: number;
  name: string;
  path: string;
  content: string;
}

export interface FindMatch {
  fileId: number;
  filePath: string;
  fileName: string;
  line: number;
  column: number;
  preview: string;
}

interface FindInFilesProps {
  open: boolean;
  onClose: () => void;
  files: FindFile[];
  onJump: (fileId: number, line: number, column: number) => void;
}

const MAX_RESULTS = 500;

export function FindInFiles({ open, onClose, files, onJump }: FindInFilesProps) {
  const [query, setQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const matches = useMemo<{ items: FindMatch[]; truncated: boolean; error: string | null }>(() => {
    const q = query;
    if (!q.trim()) return { items: [], truncated: false, error: null };
    let pattern: RegExp;
    try {
      if (useRegex) {
        pattern = new RegExp(q, caseSensitive ? "g" : "gi");
      } else {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        pattern = new RegExp(escaped, caseSensitive ? "g" : "gi");
      }
    } catch (e: any) {
      return { items: [], truncated: false, error: `Invalid regex: ${e.message}` };
    }
    const out: FindMatch[] = [];
    let truncated = false;
    outer: for (const f of files) {
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        pattern.lastIndex = 0;
        const m = pattern.exec(line);
        if (m) {
          out.push({
            fileId: f.id,
            filePath: f.path,
            fileName: f.name,
            line: i + 1,
            column: m.index + 1,
            preview: line.length > 200 ? line.slice(0, 200) + "…" : line,
          });
          if (out.length >= MAX_RESULTS) {
            truncated = true;
            break outer;
          }
        }
      }
    }
    return { items: out, truncated, error: null };
  }, [query, useRegex, caseSensitive, files]);

  const grouped = useMemo(() => {
    const map = new Map<number, { fileName: string; filePath: string; items: FindMatch[] }>();
    for (const m of matches.items) {
      const g = map.get(m.fileId) ?? { fileName: m.fileName, filePath: m.filePath, items: [] };
      g.items.push(m);
      map.set(m.fileId, g);
    }
    return Array.from(map.entries()).map(([fileId, v]) => ({ fileId, ...v }));
  }, [matches.items]);

  if (!open) return null;

  const totalMatches = matches.items.length;

  return (
    <div className="flex flex-col h-full bg-card/95 backdrop-blur-sm border-r border-border" data-testid="find-in-files">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider">Find in files</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-close-find"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2 space-y-2 border-b border-border">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Search across project..."
            className="flex-1 text-xs bg-background/60 border border-border rounded px-2 py-1.5 font-mono outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
            data-testid="input-find-query"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCaseSensitive((s) => !s)}
            className={cn(
              "p-1 rounded text-xs border transition-colors",
              caseSensitive ? "bg-primary/15 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
            title="Match case"
          >
            <CaseSensitive className="w-3 h-3" />
          </button>
          <button
            onClick={() => setUseRegex((s) => !s)}
            className={cn(
              "p-1 rounded text-xs border transition-colors",
              useRegex ? "bg-primary/15 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
            title="Regular expression"
          >
            <Regex className="w-3 h-3" />
          </button>
          <div className="ml-auto text-[10px] text-muted-foreground font-mono">
            {matches.error ? (
              <span className="text-destructive">error</span>
            ) : query.trim() ? (
              <>
                {totalMatches} {totalMatches === 1 ? "match" : "matches"} in {grouped.length} {grouped.length === 1 ? "file" : "files"}
                {matches.truncated && <span className="text-amber-400 ml-1">(capped)</span>}
              </>
            ) : (
              <>{files.length} files indexed</>
            )}
          </div>
        </div>
        {matches.error && <div className="text-[11px] text-destructive">{matches.error}</div>}
      </div>

      <div className="flex-1 overflow-auto">
        {grouped.length === 0 && query.trim() && !matches.error ? (
          <div className="p-4 text-xs text-muted-foreground text-center">No matches</div>
        ) : (
          grouped.map((g) => (
            <div key={g.fileId} className="border-b border-border/40">
              <div className="px-3 py-1.5 bg-muted/30 flex items-center gap-2">
                <FileText className="w-3 h-3 text-primary/70" />
                <span className="text-[11px] font-mono font-semibold truncate flex-1">{g.fileName}</span>
                <span className="text-[10px] text-muted-foreground">{g.items.length}</span>
              </div>
              <div>
                {g.items.map((m, idx) => (
                  <button
                    key={`${g.fileId}-${m.line}-${m.column}-${idx}`}
                    onClick={() => onJump(m.fileId, m.line, m.column)}
                    className="w-full text-left px-3 py-1 hover:bg-primary/10 transition-colors flex items-baseline gap-2 group"
                    data-testid={`find-result-${g.fileId}-${m.line}`}
                  >
                    <span className="text-[10px] text-muted-foreground font-mono w-10 text-right shrink-0">{m.line}:{m.column}</span>
                    <code className="text-[11px] font-mono text-foreground/90 group-hover:text-foreground truncate">{m.preview.trimStart()}</code>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
