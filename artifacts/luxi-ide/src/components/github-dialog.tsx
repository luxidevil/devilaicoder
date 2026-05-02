import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { GitBranch, Loader2, Download, Upload, GitFork, RefreshCw, ExternalLink, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  cloneUrl: string;
  updatedAt: string;
  language: string | null;
}

interface Status {
  configured: boolean;
  valid?: boolean;
  login?: string;
  name?: string;
  avatarUrl?: string;
  error?: string;
}

export function GitHubDialog({
  open,
  onOpenChange,
  projectId,
  onCloned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onCloned?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"clone" | "push" | "create">("clone");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneBranch, setCloneBranch] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [pushBranch, setPushBranch] = useState("main");
  const [pushMessage, setPushMessage] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createPrivate, setCreatePrivate] = useState(true);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirmClone, setConfirmClone] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/github/status");
      if (r.ok) {
        const s = (await r.json()) as Status;
        setStatus(s);
        if (s.valid) loadRepos();
      }
    } finally {
      setLoading(false);
    }
  };

  const loadRepos = async () => {
    try {
      const r = await fetch("/api/github/repos");
      if (r.ok) setRepos(await r.json());
    } catch {}
  };

  useEffect(() => {
    if (open) {
      loadStatus();
      setResult(null);
    }
  }, [open]);

  const filteredRepos = repos.filter(
    (r) => !search || r.fullName.toLowerCase().includes(search.toLowerCase()) || (r.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const doClone = async () => {
    if (!cloneUrl) return;
    if (!confirmClone) {
      setConfirmClone(true);
      return;
    }
    setConfirmClone(false);
    setWorking(true);
    setResult(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/github/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: cloneUrl, branch: cloneBranch || undefined }),
      });
      const data = await r.json();
      if (r.ok) {
        setResult({ ok: true, msg: `Cloned: ${data.filesImported} files imported` });
        onCloned?.();
      } else {
        setResult({ ok: false, msg: data.error ?? "Clone failed" });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setWorking(false);
    }
  };

  const doPush = async () => {
    if (!pushUrl) return;
    setWorking(true);
    setResult(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/github/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: pushUrl, branch: pushBranch, commitMessage: pushMessage || undefined }),
      });
      const data = await r.json();
      if (r.ok) {
        setResult({ ok: true, msg: data.committed ? `Pushed to ${data.branch}` : `Up to date on ${data.branch} (no new changes)` });
      } else {
        setResult({ ok: false, msg: data.error ?? "Push failed" });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setWorking(false);
    }
  };

  const doCreate = async () => {
    if (!createName) return;
    setWorking(true);
    setResult(null);
    try {
      const r = await fetch("/api/github/create-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName, description: createDesc, private: createPrivate }),
      });
      const data = await r.json();
      if (r.ok) {
        setResult({ ok: true, msg: `Created ${data.fullName}` });
        setPushUrl(data.cloneUrl);
        setPushBranch(data.defaultBranch);
        setTab("push");
        await loadRepos();
      } else {
        setResult({ ok: false, msg: data.error ?? "Create failed" });
      }
    } catch (err: any) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            GitHub Integration
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting...
          </div>
        ) : !status?.configured ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p className="text-amber-400 font-medium mb-1">GitHub token not configured</p>
            <p className="text-xs text-muted-foreground">
              Set the <code className="font-mono text-foreground">GITHUB_PERSONAL_ACCESS_TOKEN</code> secret to enable GitHub integration.
            </p>
          </div>
        ) : !status.valid ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="text-destructive font-medium mb-1 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Invalid GitHub token</p>
            <p className="text-xs text-muted-foreground">{status.error}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border">
              {status.avatarUrl && <img src={status.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400" /> {status.login}
                </div>
                <div className="text-[11px] text-muted-foreground">{repos.length} repos</div>
              </div>
              <Button size="sm" variant="ghost" onClick={loadRepos}><RefreshCw className="w-3 h-3" /></Button>
            </div>

            <div className="flex gap-1 border-b border-border">
              {(["clone", "push", "create"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px",
                    tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`tab-github-${t}`}
                >
                  {t === "clone" && <><Download className="w-3 h-3 inline mr-1" /> Import</>}
                  {t === "push" && <><Upload className="w-3 h-3 inline mr-1" /> Push</>}
                  {t === "create" && <><GitFork className="w-3 h-3 inline mr-1" /> Create</>}
                </button>
              ))}
            </div>

            {tab === "clone" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Repository URL</Label>
                  <Input value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} placeholder="https://github.com/owner/repo" className="font-mono text-xs" data-testid="input-clone-url" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Branch (optional)</Label>
                  <Input value={cloneBranch} onChange={(e) => setCloneBranch(e.target.value)} placeholder="main" className="font-mono text-xs" />
                </div>
                <Button
                  onClick={doClone}
                  disabled={working || !cloneUrl}
                  variant={confirmClone ? "destructive" : "default"}
                  className="w-full"
                  data-testid="button-clone"
                >
                  {working ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cloning...</>
                  ) : confirmClone ? (
                    <><AlertCircle className="w-4 h-4 mr-2" /> Confirm: this REPLACES all current project files</>
                  ) : (
                    <><Download className="w-4 h-4 mr-2" /> Clone & Import</>
                  )}
                </Button>
                {confirmClone && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmClone(false)} className="w-full">Cancel</Button>
                )}

                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your repos..." className="text-xs" />
                <ScrollArea className="max-h-60 -mx-1 px-1">
                  <div className="space-y-1">
                    {filteredRepos.slice(0, 50).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => { setCloneUrl(r.cloneUrl); setCloneBranch(r.defaultBranch); }}
                        className="w-full text-left p-2 rounded border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-foreground truncate flex-1">{r.fullName}</span>
                          {r.private && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Private</span>}
                          {r.language && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">{r.language}</span>}
                        </div>
                        {r.description && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{r.description}</div>}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {tab === "push" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Target Repo URL</Label>
                  <Input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="https://github.com/owner/repo" className="font-mono text-xs" data-testid="input-push-url" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Branch</Label>
                    <Input value={pushBranch} onChange={(e) => setPushBranch(e.target.value)} className="font-mono text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Commit Message (optional)</Label>
                    <Input value={pushMessage} onChange={(e) => setPushMessage(e.target.value)} placeholder="Update from Luxi IDE" />
                  </div>
                </div>
                <Button onClick={doPush} disabled={working || !pushUrl} className="w-full" data-testid="button-push">
                  {working ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Pushing...</> : <><Upload className="w-4 h-4 mr-2" /> Push to GitHub</>}
                </Button>
                <p className="text-[11px] text-muted-foreground italic">
                  This syncs your IDE files to disk, then commits and pushes to the target branch (force-add mode).
                </p>
              </div>
            )}

            {tab === "create" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Repo Name</Label>
                  <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="my-new-project" className="font-mono text-xs" data-testid="input-create-name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description (optional)</Label>
                  <Input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="What this is" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={createPrivate} onChange={(e) => setCreatePrivate(e.target.checked)} />
                  Private repository
                </label>
                <Button onClick={doCreate} disabled={working || !createName} className="w-full" data-testid="button-create-repo">
                  {working ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : <><GitFork className="w-4 h-4 mr-2" /> Create Repo</>}
                </Button>
              </div>
            )}

            {result && (
              <div className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                result.ok ? "bg-green-500/10 border border-green-500/20 text-green-400" : "bg-destructive/10 border border-destructive/20 text-destructive"
              )}>
                {result.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span className="flex-1">{result.msg}</span>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
