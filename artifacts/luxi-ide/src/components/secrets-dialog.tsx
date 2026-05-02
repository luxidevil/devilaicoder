import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Key, Loader2, Plus, Trash2, Eye, EyeOff } from "lucide-react";

interface Secret {
  id: number;
  key: string;
  description: string | null;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export function SecretsDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
}) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/secrets`);
      if (res.ok) setSecrets(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open, projectId]);

  const save = async () => {
    setError("");
    if (!newKey.trim()) {
      setError("Key is required");
      return;
    }
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(newKey.trim())) {
      setError("Key must match /^[A-Z_][A-Z0-9_]*$/i (e.g. STRIPE_KEY)");
      return;
    }
    if (!newValue) {
      setError("Value cannot be empty. Use Delete if you want to remove the secret.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/secrets/${newKey.trim()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue, description: newDesc || undefined }),
      });
      if (res.ok) {
        setNewKey("");
        setNewValue("");
        setNewDesc("");
        setShowAdd(false);
        await load();
      } else {
        const e = await res.json();
        setError(e.error ?? "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (key: string) => {
    await fetch(`/api/projects/${projectId}/secrets/${key}`, { method: "DELETE" });
    setConfirmDelete(null);
    await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            Project Secrets
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          These environment variables are injected into commands run by the agent and terminal for this project only.
        </p>

        {!showAdd && (
          <Button onClick={() => setShowAdd(true)} variant="outline" className="w-full" data-testid="button-add-secret">
            <Plus className="w-4 h-4 mr-2" /> Add Secret
          </Button>
        )}

        {showAdd && (
          <div className="space-y-2 border border-border bg-muted/30 rounded-lg p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Key</Label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                  placeholder="STRIPE_API_KEY"
                  className="font-mono text-xs"
                  data-testid="input-secret-key"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description (optional)</Label>
                <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What this is for" data-testid="input-secret-desc" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Value</Label>
              <div className="relative">
                <Input
                  type={showValue ? "text" : "password"}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="sk-live-..."
                  className="font-mono text-xs pr-10"
                  data-testid="input-secret-value"
                />
                <button type="button" onClick={() => setShowValue(!showValue)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving} data-testid="button-save-secret">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => { setShowAdd(false); setError(""); setNewKey(""); setNewValue(""); setNewDesc(""); }}>Cancel</Button>
            </div>
          </div>
        )}

        <ScrollArea className="max-h-[400px] -mx-1 px-1">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
            </div>
          ) : secrets.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No project secrets yet. Add one to inject env vars into your commands.
            </div>
          ) : (
            <div className="space-y-1.5">
              {secrets.map((s) => (
                <div key={s.id} className="border border-border rounded-lg p-3 bg-card flex items-center gap-3">
                  <Key className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono text-foreground">{s.key}</div>
                    {s.description && <div className="text-xs text-muted-foreground truncate">{s.description}</div>}
                    <div className="text-[10px] text-muted-foreground font-mono">{s.preview}</div>
                  </div>
                  {confirmDelete === s.key ? (
                    <>
                      <Button size="sm" variant="destructive" onClick={() => remove(s.key)} data-testid={`button-confirm-delete-secret-${s.key}`}>Delete</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setNewKey(s.key); setNewDesc(s.description ?? ""); setNewValue(""); setShowAdd(true); }}>Update</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(s.key)} data-testid={`button-delete-secret-${s.key}`}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="text-[11px] text-muted-foreground italic">
          Values are masked in the UI but injected as plain env vars when the agent runs commands.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
