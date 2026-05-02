import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { ChevronDown, ChevronRight, Plus, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DiffViewProps {
  before: string;
  after: string;
  path: string;
  action: string;
  defaultOpen?: boolean;
}

export function DiffView({ before, after, path, action, defaultOpen = false }: DiffViewProps) {
  const [open, setOpen] = useState(defaultOpen);

  const { parts, addedLines, removedLines } = useMemo(() => {
    const parts = diffLines(before ?? "", after ?? "");
    let added = 0;
    let removed = 0;
    for (const p of parts) {
      const lines = p.value.split("\n").filter((_, i, arr) => i < arr.length - 1 || arr[i] !== "").length;
      if (p.added) added += lines;
      else if (p.removed) removed += lines;
    }
    return { parts, addedLines: added, removedLines: removed };
  }, [before, after]);

  const isCreate = action === "created" || (!before && after);
  const isDelete = action === "deleted";

  // Cap diff display at ~400 visible lines to avoid layout collapse on huge files
  const MAX_DISPLAY_LINES = 400;
  let displayed = 0;
  let truncated = false;

  return (
    <div className="border border-border/60 rounded-md overflow-hidden bg-card/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-accent/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        )}
        <span
          className={`font-medium ${
            isCreate ? "text-green-400" : isDelete ? "text-red-400" : "text-blue-400"
          }`}
        >
          {action}
        </span>
        <span className="font-mono text-foreground text-[11px] truncate flex-1 text-left">{path}</span>
        {(addedLines > 0 || removedLines > 0) && (
          <span className="flex items-center gap-2 text-[11px] font-mono shrink-0">
            {addedLines > 0 && (
              <span className="text-green-400 flex items-center gap-0.5">
                <Plus className="w-2.5 h-2.5" />
                {addedLines}
              </span>
            )}
            {removedLines > 0 && (
              <span className="text-red-400 flex items-center gap-0.5">
                <Minus className="w-2.5 h-2.5" />
                {removedLines}
              </span>
            )}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-border/60"
          >
            <pre className="text-[11px] font-mono leading-[1.5] overflow-x-auto bg-background/40 max-h-96 overflow-y-auto">
              {parts.map((p, i) => {
                if (truncated) return null;
                const lines = p.value.split("\n");
                // Drop trailing empty line from split
                if (lines[lines.length - 1] === "") lines.pop();

                const cls = p.added
                  ? "bg-green-500/10 text-green-300"
                  : p.removed
                    ? "bg-red-500/10 text-red-300"
                    : "text-muted-foreground";
                const sign = p.added ? "+" : p.removed ? "-" : " ";

                return (
                  <div key={i}>
                    {lines.map((line, j) => {
                      if (displayed >= MAX_DISPLAY_LINES) {
                        truncated = true;
                        return null;
                      }
                      displayed++;
                      return (
                        <div key={j} className={`flex ${cls} px-2`}>
                          <span className="w-4 select-none opacity-60">{sign}</span>
                          <span className="whitespace-pre">{line}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {truncated && (
                <div className="px-2 py-1 text-muted-foreground italic text-center border-t border-border/40">
                  Diff truncated — {MAX_DISPLAY_LINES}+ lines hidden
                </div>
              )}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
