import { useEffect, useState } from "react";
import { MessageSquarePlus, MessageCircle, Trash2, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface Conversation {
  id: number;
  projectId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  projectId: number;
  currentConversationId: number | null;
  onSwitch: (id: number) => void;
  onNew: () => void;
  /** Bumped by the parent every time it saves a new message so the list refreshes. */
  refreshKey: number;
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ConversationsMenu({
  projectId,
  currentConversationId,
  onSwitch,
  onNew,
  refreshKey,
}: Props) {
  const [open, setOpen] = useState(false);
  const [convos, setConvos] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/conversations`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setConvos(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, refreshKey, open]);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConvos(prev => prev.filter(c => c.id !== id));
    if (id === currentConversationId) onNew();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-conversations"
          title="Conversations"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span>Chats</span>
          {convos.length > 0 && (
            <span className="text-[10px] text-muted-foreground/70">({convos.length})</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-h-[400px] overflow-y-auto">
        <DropdownMenuItem
          onClick={() => { onNew(); setOpen(false); }}
          className="text-xs cursor-pointer font-medium"
        >
          <MessageSquarePlus className="w-3.5 h-3.5 mr-2 text-primary" />
          New chat
        </DropdownMenuItem>
        {convos.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Recent
            </DropdownMenuLabel>
            {convos.map(c => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => { onSwitch(c.id); setOpen(false); }}
                className="text-xs cursor-pointer flex items-start gap-2 group"
              >
                {c.id === currentConversationId ? (
                  <Check className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                ) : (
                  <MessageCircle className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{c.title || "Untitled"}</div>
                  <div className="text-[10px] text-muted-foreground">{relTime(c.updatedAt)}</div>
                </div>
                <button
                  onClick={(e) => handleDelete(c.id, e)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-all flex-shrink-0"
                  title="Delete chat"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
