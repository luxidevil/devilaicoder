import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Github, GitBranch, Loader2, RefreshCw, UploadCloud, DownloadCloud, Link2 } from 'lucide-react';
import {
  connectProjectRepo,
  getProjectGitStatus,
  pullProjectRepo,
  pushProjectRepo,
  syncProjectFromRunner,
} from '../../lib/api';
import { cn } from '../../lib/utils';
import type { Project, ProjectGitStatus } from '../../types';

interface Props {
  projectId: number;
  project?: Project | null;
  runnerConnected: boolean;
}

function shortDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function summarizeSync(sync: ProjectGitStatus['sync']) {
  if (!sync) return '';
  const parts = [];
  parts.push(`${sync.imported} imported`);
  if (sync.created) parts.push(`${sync.created} created`);
  if (sync.updated) parts.push(`${sync.updated} updated`);
  if (sync.removed) parts.push(`${sync.removed} removed`);
  if (sync.skipped) parts.push(`${sync.skipped} skipped`);
  if (sync.truncated) parts.push('truncated');
  return parts.join(' • ');
}

export function RepoPanel({ projectId, project, runnerConnected }: Props) {
  const queryClient = useQueryClient();
  const [repoUrl, setRepoUrl] = useState(project?.repo_url ?? '');
  const [branch, setBranch] = useState(project?.repo_branch ?? '');
  const [commitMessage, setCommitMessage] = useState('Update from LUXI IDE');
  const [activity, setActivity] = useState<string>('');

  useEffect(() => {
    setRepoUrl(project?.repo_url ?? '');
  }, [project?.repo_url]);

  useEffect(() => {
    setBranch(project?.repo_branch ?? '');
  }, [project?.repo_branch]);

  const gitQuery = useQuery({
    queryKey: ['git', projectId],
    queryFn: () => getProjectGitStatus(projectId),
    enabled: !!projectId,
    refetchInterval: 15000,
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['git', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
    ]);
  };

  const connectMutation = useMutation({
    mutationFn: () => connectProjectRepo(projectId, { repoUrl: repoUrl.trim(), branch: branch.trim() || undefined }),
    onSuccess: async (data) => {
      setActivity(data.output || summarizeSync(data.sync) || 'Repository connected.');
      await invalidateAll();
    },
  });

  const pullMutation = useMutation({
    mutationFn: () => pullProjectRepo(projectId, { branch: branch.trim() || undefined }),
    onSuccess: async (data) => {
      setActivity(data.output || summarizeSync(data.sync) || 'Pulled latest changes.');
      await invalidateAll();
    },
  });

  const pushMutation = useMutation({
    mutationFn: () => pushProjectRepo(projectId, { message: commitMessage.trim() || 'Update from LUXI IDE', branch: branch.trim() || undefined }),
    onSuccess: async (data) => {
      setActivity(data.output || (data.committed ? 'Committed and pushed changes.' : 'Pushed branch with no new commit.'));
      await invalidateAll();
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncProjectFromRunner(projectId),
    onSuccess: async (data) => {
      setActivity(summarizeSync(data.sync) || 'Imported runner files into the IDE.');
      await invalidateAll();
    },
  });

  const git = gitQuery.data;
  const busy = connectMutation.isPending || pullMutation.isPending || pushMutation.isPending || syncMutation.isPending;
  const latestError = (
    connectMutation.error instanceof Error ? connectMutation.error.message
      : pullMutation.error instanceof Error ? pullMutation.error.message
      : pushMutation.error instanceof Error ? pushMutation.error.message
      : syncMutation.error instanceof Error ? syncMutation.error.message
      : gitQuery.error instanceof Error ? gitQuery.error.message
      : git?.error || project?.repo_last_error || ''
  );

  const statusTone = useMemo(() => {
    if (!runnerConnected) return ['border-amber-500/30 bg-amber-500/5 text-amber-300', 'Runner required for repo actions'];
    if (git?.connected && git.status.clean) return ['border-green-500/30 bg-green-500/5 text-green-300', 'Workspace clean'];
    if (git?.connected) return ['border-amber-500/30 bg-amber-500/5 text-amber-300', 'Uncommitted changes'];
    return ['border-border bg-muted/20 text-muted-foreground', 'No repository connected'];
  }, [git?.connected, git?.status.clean, runnerConnected]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Github className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Repo & GitHub</span>
        </div>
        <button
          onClick={() => gitQuery.refetch()}
          disabled={gitQuery.isFetching}
          className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          {gitQuery.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className={cn('rounded border px-3 py-2 text-[11px]', statusTone[0])}>
          <p className="font-medium">{statusTone[1]}</p>
          {git?.status?.branch && (
            <p className="mt-1 flex items-center gap-1.5">
              <GitBranch className="h-3 w-3" />
              <span>{git.status.branch}</span>
              {git.status.upstream ? <span className="text-muted-foreground">→ {git.status.upstream}</span> : null}
              {(git.status.ahead || git.status.behind) ? (
                <span className="text-muted-foreground">
                  {git.status.ahead ? `↑${git.status.ahead}` : ''}
                  {git.status.behind ? ` ↓${git.status.behind}` : ''}
                </span>
              ) : null}
            </p>
          )}
        </div>

        {!runnerConnected && (
          <div className="rounded border border-border/60 bg-card/50 px-3 py-3 text-[11px] text-muted-foreground">
            Connect the runner first. Repo clone, pull, push, and runner-to-IDE sync all execute inside the project sandbox.
          </div>
        )}

        <div className="space-y-2 rounded border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            <Link2 className="h-3.5 w-3.5 text-primary/80" />
            Connect Repository
          </div>
          <input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/owner/repo.git or owner/repo"
            className="w-full rounded border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="Branch (optional)"
              className="flex-1 rounded border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => connectMutation.mutate()}
              disabled={!runnerConnected || !repoUrl.trim() || busy}
              className="rounded border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              {connectMutation.isPending ? 'Cloning...' : git?.connected ? 'Reconnect' : 'Clone'}
            </button>
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground/70">
            Private GitHub repos can use a <span className="font-mono">GITHUB_TOKEN</span> or <span className="font-mono">GH_TOKEN</span> secret from the Secrets tab.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => pullMutation.mutate()}
            disabled={!runnerConnected || !git?.connected || busy}
            className="flex items-center justify-center gap-2 rounded border border-border bg-muted/20 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-40"
          >
            {pullMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
            Pull & Sync
          </button>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={!runnerConnected || busy}
            className="flex items-center justify-center gap-2 rounded border border-border bg-muted/20 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-40"
          >
            {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Import Runner Files
          </button>
        </div>

        <div className="space-y-2 rounded border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            <UploadCloud className="h-3.5 w-3.5 text-primary/80" />
            Commit & Push
          </div>
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Commit message"
            className="w-full rounded border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => pushMutation.mutate()}
            disabled={!runnerConnected || !git?.connected || busy}
            className="w-full rounded border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
          >
            {pushMutation.isPending ? 'Pushing...' : 'Push to Origin'}
          </button>
        </div>

        {git?.connected && (
          <div className="rounded border border-border/60 bg-card/40 p-3 text-[11px] text-muted-foreground">
            <div className="space-y-1">
              <p><span className="text-foreground">Remote:</span> {git.status.remoteUrl || git.repo_url || 'Not detected'}</p>
              <p><span className="text-foreground">Last sync:</span> {shortDate(git.repo_last_sync_at)}</p>
              <p><span className="text-foreground">Last commit:</span> {git.status.lastCommitMessage || 'Unknown'}</p>
              {git.status.lastCommitHash ? (
                <p className="font-mono text-[10px] text-muted-foreground/80">{git.status.lastCommitHash.slice(0, 12)} {git.status.lastCommitAt ? `• ${shortDate(git.status.lastCommitAt)}` : ''}</p>
              ) : null}
            </div>
            {git.status.changes.length > 0 && (
              <div className="mt-3 rounded border border-border/50 bg-background/60 p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Working tree</p>
                <div className="max-h-28 overflow-y-auto font-mono text-[10px] text-amber-300/90">
                  {git.status.changes.slice(0, 10).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  {git.status.changes.length > 10 ? <div>...and {git.status.changes.length - 10} more</div> : null}
                </div>
              </div>
            )}
          </div>
        )}

        {(activity || git?.sync) && (
          <div className="rounded border border-border/60 bg-background/50 p-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              <span>Latest activity</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words leading-5">{activity || summarizeSync(git?.sync)}</p>
          </div>
        )}

        {latestError && (
          <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-[11px] text-red-300">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Repo error</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words leading-5">{latestError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
