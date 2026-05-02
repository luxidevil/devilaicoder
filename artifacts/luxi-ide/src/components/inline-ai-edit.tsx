import { useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InlineAiEditProps {
  open: boolean;
  initialInstruction?: string;
  onCancel: () => void;
  onApply: (replacement: string) => void;
  fetchReplacement: (instruction: string) => Promise<string>;
  anchorTop?: number;
  anchorLeft?: number;
}

export function InlineAiEdit({
  open,
  initialInstruction = "",
  onCancel,
  onApply,
  fetchReplacement,
  anchorTop,
  anchorLeft,
}: InlineAiEditProps) {
  const [instruction, setInstruction] = useState(initialInstruction);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setInstruction(initialInstruction);
      setPreview(null);
      setError(null);
      setPending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, initialInstruction]);

  if (!open) return null;

  const submit = async () => {
    if (!instruction.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await fetchReplacement(instruction.trim());
      setPreview(r);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate edit");
    } finally {
      setPending(false);
    }
  };

  const accept = () => {
    if (preview != null) {
      onApply(preview);
    }
  };

  const style: React.CSSProperties = {
    top: anchorTop ?? 16,
    left: anchorLeft ?? 16,
  };

  return (
    <div
      className="absolute z-30 w-[460px] max-w-[calc(100%-32px)] rounded-lg border border-primary/30 bg-card/95 backdrop-blur-xl shadow-2xl shadow-primary/20 ring-1 ring-primary/10"
      style={style}
      onClick={(e) => e.stopPropagation()}
      data-testid="inline-ai-edit"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground">Edit with AI</span>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">⌘K</span>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-2">
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (preview != null) accept();
              else submit();
            }
          }}
          placeholder='e.g. "convert to async/await", "add JSDoc", "extract to function"'
          rows={2}
          className="w-full resize-none rounded-md bg-background/60 border border-border px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
          disabled={pending}
        />

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-1">
            {error}
          </div>
        )}

        {preview != null && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Preview replacement
            </div>
            <pre className="max-h-48 overflow-auto rounded-md bg-background/80 border border-border p-2 text-[11px] font-mono leading-snug whitespace-pre-wrap break-words">
              {preview}
            </pre>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 text-xs"
          >
            Cancel
          </Button>
          {preview == null ? (
            <Button
              size="sm"
              onClick={submit}
              disabled={!instruction.trim() || pending}
              className="h-7 text-xs btn-brand"
            >
              {pending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 mr-1" />
                  Generate
                </>
              )}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreview(null)}
                className="h-7 text-xs"
              >
                Retry
              </Button>
              <Button
                size="sm"
                onClick={accept}
                className="h-7 text-xs btn-brand"
              >
                <Check className="w-3 h-3 mr-1" />
                Apply
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
