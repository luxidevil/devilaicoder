import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, Eye, FileWarning, GitBranch, Loader2, Plus, RotateCcw, ShieldCheck, X } from 'lucide-react';
import {
  applyProjectTask,
  createProjectTask,
  discardProjectTask,
  listProjectTasks,
  reviewProjectTask,
} from '../../lib/api';
import type { ProjectTask, ProjectTaskReview } from '../../types';

interface Props {
  projectId: number;
  activeTaskId: number | null;
  onActiveTaskChange: (taskId: number | null) => void;
  onFilesApplied?: () => void;
}

function normalizeCriteriaInput(value: string) {
  return Array.from(new Set(
    value
      .split(/\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )).slice(0, 20);
}

export function TaskPanel({ projectId, activeTaskId, onActiveTaskChange, onFilesApplied }: Props) {
  const queryClient = useQueryClient();
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => listProjectTasks(projectId),
  });

  const activeTask = useMemo(() => tasks.find((task) => task.id === activeTaskId) ?? null, [tasks, activeTaskId]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [criteriaInput, setCriteriaInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewTaskId, setReviewTaskId] = useState<number | null>(null);
  const [reviewData, setReviewData] = useState<ProjectTaskReview | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [discardingId, setDiscardingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const task = await createProjectTask(projectId, {
        title,
        request,
        acceptance_criteria: normalizeCriteriaInput(criteriaInput),
      });
      setTitle('');
      setRequest('');
      setCriteriaInput('');
      setCreating(false);
      onActiveTaskChange(task.id);
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create task.');
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (taskId: number) => {
    setReviewingId(taskId);
    setError(null);
    try {
      const result = await reviewProjectTask(projectId, taskId);
      setReviewTaskId(taskId);
      setReviewData(result.review);
      await refresh();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Failed to review task.');
    } finally {
      setReviewingId(null);
    }
  };

  const handleApply = async (task: ProjectTask) => {
    setApplyingId(task.id);
    setError(null);
    try {
      await applyProjectTask(projectId, task.id);
      if (activeTaskId === task.id) onActiveTaskChange(null);
      setReviewTaskId(task.id);
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      onFilesApplied?.();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Failed to apply task.');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDiscard = async (task: ProjectTask) => {
    setDiscardingId(task.id);
    setError(null);
    try {
      await discardProjectTask(projectId, task.id);
      if (activeTaskId === task.id) onActiveTaskChange(null);
      await refresh();
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : 'Failed to discard task.');
    } finally {
      setDiscardingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Task Workspaces</div>
            <div className="text-[10px] text-muted-foreground">Run risky work in isolation, then review/apply it deliberately.</div>
          </div>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="w-3 h-3" />
            {creating ? 'Close' : 'New'}
          </button>
        </div>
        {activeTask && (
          <div className="mt-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-foreground">Active task: {activeTask.title}</div>
                <div className="text-[10px] text-muted-foreground">{activeTask.acceptance_criteria.length > 0 ? `${activeTask.acceptance_criteria.length} acceptance checks` : 'No explicit acceptance checks yet'}</div>
              </div>
              <button
                type="button"
                onClick={() => onActiveTaskChange(null)}
                className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Main branch
              </button>
            </div>
          </div>
        )}
        {creating && (
          <div className="mt-3 space-y-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              rows={3}
              placeholder="What should this isolated task accomplish?"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <textarea
              value={criteriaInput}
              onChange={(event) => setCriteriaInput(event.target.value)}
              rows={3}
              placeholder="Acceptance criteria (one per line)"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <button
              type="button"
              onClick={() => { void handleCreate(); }}
              disabled={saving || !title.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Create isolated task
            </button>
          </div>
        )}
        {error && (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 text-[11px] text-muted-foreground">
            No isolated tasks yet. Create one when you want the agent to experiment, retry, or refactor without touching the main project immediately.
          </div>
        ) : tasks.map((task) => {
          const isActive = activeTaskId === task.id;
          const showReview = reviewTaskId === task.id && reviewData;
          const isClosed = task.status === 'applied' || task.status === 'discarded';

          return (
            <div key={task.id} className="rounded-xl border border-border bg-card/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{task.title}</div>
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {task.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {task.request || 'No request notes saved.'}
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{task.workspace_key}</span>
                    <span className="mx-1.5 text-muted-foreground/40">•</span>
                    {task.changed_paths.length} changed path{task.changed_paths.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onActiveTaskChange(isActive ? null : task.id)}
                  disabled={isClosed}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${
                    isActive
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                  } ${isClosed ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <GitBranch className="w-3 h-3" />
                  {isActive ? 'Selected' : 'Use'}
                </button>
              </div>

              {task.acceptance_criteria.length > 0 && (
                <div className="mt-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Acceptance</div>
                  <div className="mt-1 space-y-1">
                    {task.acceptance_criteria.map((criterion) => (
                      <div key={criterion} className="flex items-start gap-2 text-[11px] text-foreground/90">
                        <Check className="mt-0.5 w-3 h-3 text-green-400" />
                        <span>{criterion}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { void handleReview(task.id); }}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {reviewingId === task.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => { void handleApply(task); }}
                  disabled={isClosed || applyingId === task.id}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                >
                  {applyingId === task.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />}
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => { void handleDiscard(task); }}
                  disabled={isClosed || discardingId === task.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                >
                  {discardingId === task.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Discard
                </button>
              </div>

              {showReview && (
                <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                    <FileWarning className="w-3.5 h-3.5 text-amber-400" />
                    {reviewData.summary}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span>{reviewData.added.length} added</span>
                    <span>{reviewData.modified.length} modified</span>
                    <span>{reviewData.removed.length} removed</span>
                  </div>
                  {reviewData.previews.map((preview) => (
                    <div key={`${preview.path}-${preview.status}`} className="rounded-lg border border-border/60 bg-card/70">
                      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
                        <span className="text-[11px] font-medium text-foreground">{preview.path}</span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{preview.status}</span>
                      </div>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-3 py-2 text-[10px] font-mono text-muted-foreground">{preview.preview}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
