import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { History, Loader2, Save, RotateCcw, Trash2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface Snapshot {
  id: number;
  label: string;
  reason: string | null;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
}

export function CheckpointsDialog({
  open,
  onOpenChange,
  projectId,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onRestored?: () => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots`);
      if (res.ok) setSnapshots(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open, projectId]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || undefined, reason: reason || undefined }),
      });
      if (res.ok) {
        setLabel("");
        setReason("");
        await load();
      }
    } finally {
      setCreating(false);
    }
  };

  const restore = async (id: number) => {
    setRestoring(id);
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots/${id}/restore`, { method: "POST" });
      if (res.ok) {
        onRestored?.();
        onOpenChange(false);
      }
    } finally {
      setRestoring(null);
      setConfirmRestore(null);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/projects/${projectId}/snapshots/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Checkpoints
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 border border-border bg-muted/30 rounded-lg p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Before refactor" data-testid="input-checkpoint-label" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason (optional)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you're about to change" data-testid="input-checkpoint-reason" />
            </div>
          </div>
          <Button onClick={create} disabled={creating} className="w-full" data-testid="button-create-checkpoint">
            {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : <><Save className="w-4 h-4 mr-2" /> Save Current Checkpoint</>}
          </Button>
        </div>

        <ScrollArea className="max-h-[420px] -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
            </div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No checkpoints yet. Save one to enable rollback.
            </div>
          ) : (
            <div className="space-y-1.5">
              {snapshots.map((s) => (
                <div key={s.id} className="border border-border rounded-lg p-3 bg-card hover-elevate">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{s.label}</div>
                      {s.reason && <div className="text-xs text-muted-foreground truncate">{s.reason}</div>}
                      <div className="text-[10px] text-muted-foreground font-mono mt-1">
                        {new Date(s.createdAt).toLocaleString()} · {s.fileCount} files · {(s.totalBytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {confirmRestore === s.id ? (
                        <>
                          <Button size="sm" variant="destructive" onClick={() => restore(s.id)} disabled={restoring === s.id} data-testid={`button-confirm-restore-${s.id}`}>
                            {restoring === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(null)}>Cancel</Button>
                        </>
                      ) : confirmDelete === s.id ? (
                        <>
                          <Button size="sm" variant="destructive" onClick={() => remove(s.id)}>Delete</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setConfirmRestore(s.id)} data-testid={`button-restore-${s.id}`}>
                            <RotateCcw className="w-3 h-3 mr-1" /> Restore
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(s.id)} data-testid={`button-delete-checkpoint-${s.id}`}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="text-[11px] text-muted-foreground italic">
          Restore creates an auto-checkpoint of your current state first, so you can always undo a restore.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
