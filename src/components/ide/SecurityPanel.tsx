import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, FileText, Loader2, Play, Plus, Radar, Save, ShieldCheck, Trash2, Upload, Webhook } from 'lucide-react';
import {
  createOastSession,
  createSecurityCheck,
  deleteSecurityCheck,
  generateProjectSecurityReport,
  getProjectReverseEngineering,
  getTrafficCaptureDetail,
  getTrafficFlowGraph,
  getProjectSecurityContext,
  importProjectTrafficCapture,
  mutateTrafficReplay,
  replayTrafficFlow,
  replayTrafficCapture,
  runProjectSecurityScan,
  saveProjectSecurityProfile,
  updateProjectFinding,
} from '../../lib/api';
import type { ProjectReverseEngineering, ProjectSecurityProfile, SecurityCustomCheck, SecurityFinding, SecurityReport, TrafficCapture, TrafficCaptureDetail, TrafficFlowGraph, TrafficFlowReplayResult, TrafficMutationResult, TrafficReplayResult } from '../../types';

interface Props {
  projectId: number;
  activeTaskId?: number | null;
}

function linesToList(value: string) {
  return Array.from(new Set(
    value
      .split(/\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function stringifyList(values: string[]) {
  return values.join('\n');
}

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? [], null, 2);
}

function severityTone(severity: string) {
  const normalized = String(severity ?? '').toLowerCase();
  if (normalized === 'critical') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (normalized === 'high') return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
  if (normalized === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (normalized === 'low') return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
  return 'border-border bg-muted/40 text-muted-foreground';
}

export function SecurityPanel({ projectId, activeTaskId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['security-context', projectId],
    queryFn: () => getProjectSecurityContext(projectId),
  });

  const [allowedHosts, setAllowedHosts] = useState('');
  const [startUrls, setStartUrls] = useState('');
  const [blockedHosts, setBlockedHosts] = useState('');
  const [notes, setNotes] = useState('');
  const [maxDepth, setMaxDepth] = useState('4');
  const [allowProduction, setAllowProduction] = useState(false);
  const [authProfilesJson, setAuthProfilesJson] = useState('[]');
  const [continuousScansJson, setContinuousScansJson] = useState('[]');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [checkName, setCheckName] = useState('');
  const [checkKind, setCheckKind] = useState('regex');
  const [checkSeverity, setCheckSeverity] = useState('medium');
  const [checkPattern, setCheckPattern] = useState('');
  const [checkFileGlob, setCheckFileGlob] = useState('');
  const [checkDependency, setCheckDependency] = useState('');
  const [checkRemediation, setCheckRemediation] = useState('');
  const [creatingCheck, setCreatingCheck] = useState(false);
  const [deletingCheckId, setDeletingCheckId] = useState<number | null>(null);

  const [runningScan, setRunningScan] = useState(false);
  const [latestScan, setLatestScan] = useState<{
    attack_surface: Record<string, unknown>;
    api_specs: Array<Record<string, unknown>>;
    findings: SecurityFinding[];
    persisted_findings: SecurityFinding[];
  } | null>(null);

  const [reporting, setReporting] = useState(false);
  const [creatingOast, setCreatingOast] = useState(false);
  const [newOastLabel, setNewOastLabel] = useState('');
  const [importingTraffic, setImportingTraffic] = useState(false);
  const [trafficName, setTrafficName] = useState('');
  const [trafficPayload, setTrafficPayload] = useState('');
  const [selectedCaptureId, setSelectedCaptureId] = useState<number | null>(null);
  const [replayingEntryId, setReplayingEntryId] = useState<string | null>(null);
  const [replayingChainKey, setReplayingChainKey] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<TrafficReplayResult | null>(null);
  const [flowReplayResult, setFlowReplayResult] = useState<TrafficFlowReplayResult | null>(null);
  const [carryFlowCookies, setCarryFlowCookies] = useState(true);
  const [mutationEntryId, setMutationEntryId] = useState<string | null>(null);
  const [mutationPayload, setMutationPayload] = useState('{\n  "header_overrides": {},\n  "query_overrides": {},\n  "body_json_merge": {}\n}');
  const [mutatingEntryId, setMutatingEntryId] = useState<string | null>(null);
  const [mutationResult, setMutationResult] = useState<TrafficMutationResult | null>(null);
  const [updatingFindingId, setUpdatingFindingId] = useState<number | null>(null);
  const [copiedValue, setCopiedValue] = useState('');

  const { data: reverseEngineering } = useQuery<ProjectReverseEngineering>({
    queryKey: ['reverse-engineering', projectId],
    queryFn: () => getProjectReverseEngineering(projectId),
  });
  const { data: captureDetail } = useQuery<TrafficCaptureDetail>({
    queryKey: ['traffic-capture-detail', projectId, selectedCaptureId],
    queryFn: () => getTrafficCaptureDetail(projectId, selectedCaptureId!),
    enabled: selectedCaptureId !== null,
  });
  const { data: captureFlow } = useQuery<TrafficFlowGraph>({
    queryKey: ['traffic-flow', projectId, selectedCaptureId],
    queryFn: () => getTrafficFlowGraph(projectId, selectedCaptureId!),
    enabled: selectedCaptureId !== null,
  });

  useEffect(() => {
    if (!data?.profile) return;
    setAllowedHosts(stringifyList(data.profile.scope.allowed_hosts));
    setStartUrls(stringifyList(data.profile.scope.start_urls));
    setBlockedHosts(stringifyList(data.profile.scope.blocked_hosts));
    setNotes(data.profile.scope.notes);
    setMaxDepth(String(data.profile.scope.max_depth ?? 4));
    setAllowProduction(data.profile.scope.allow_production);
    setAuthProfilesJson(prettyJson(data.profile.auth_profiles));
    setContinuousScansJson(prettyJson(data.profile.continuous_scans));
  }, [data?.profile]);

  const findings = data?.findings ?? [];
  const reports = data?.reports ?? [];
  const checks = data?.checks ?? [];
  const oastSessions = data?.oast_sessions ?? [];
  const trafficCaptures = data?.traffic_captures ?? [];
  const selectedCapture = captureDetail?.capture ?? null;
  const captureReverseEngineering = captureDetail?.reverse_engineering ?? null;

  const groupedCounts = useMemo(() => {
    return findings.reduce<Record<string, number>>((acc, finding) => {
      const key = String(finding.severity ?? 'info').toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [findings]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['security-context', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['reverse-engineering', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['traffic-capture-detail', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['traffic-flow', projectId] }),
    ]);
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    try {
      const authProfiles = JSON.parse(authProfilesJson || '[]') as ProjectSecurityProfile['auth_profiles'];
      const continuousScans = JSON.parse(continuousScansJson || '[]') as ProjectSecurityProfile['continuous_scans'];
      await saveProjectSecurityProfile(projectId, {
        scope: {
          allowed_hosts: linesToList(allowedHosts),
          start_urls: linesToList(startUrls),
          blocked_hosts: linesToList(blockedHosts),
          allow_production: allowProduction,
          max_depth: Math.max(1, Math.min(Number(maxDepth) || 4, 12)),
          notes,
        },
        auth_profiles: authProfiles,
        continuous_scans: continuousScans,
      });
      await refresh();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Failed to save security profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCreateCheck = async () => {
    setCreatingCheck(true);
    try {
      await createSecurityCheck(projectId, {
        name: checkName,
        kind: checkKind,
        severity: checkSeverity,
        pattern: checkPattern,
        file_glob: checkFileGlob,
        dependency_name: checkDependency,
        remediation: checkRemediation,
      });
      setCheckName('');
      setCheckPattern('');
      setCheckFileGlob('');
      setCheckDependency('');
      setCheckRemediation('');
      await refresh();
    } finally {
      setCreatingCheck(false);
    }
  };

  const handleDeleteCheck = async (checkId: number) => {
    setDeletingCheckId(checkId);
    try {
      await deleteSecurityCheck(projectId, checkId);
      await refresh();
    } finally {
      setDeletingCheckId(null);
    }
  };

  const handleRunScan = async () => {
    setRunningScan(true);
    try {
      const result = await runProjectSecurityScan(projectId, {
        persist: true,
        taskId: activeTaskId ?? null,
      });
      setLatestScan(result);
      await refresh();
    } finally {
      setRunningScan(false);
    }
  };

  const handleGenerateReport = async () => {
    setReporting(true);
    try {
      await generateProjectSecurityReport(projectId, {
        title: `Security evidence pack ${new Date().toISOString().slice(0, 10)}`,
      });
      await refresh();
    } finally {
      setReporting(false);
    }
  };

  const handleCreateOast = async () => {
    setCreatingOast(true);
    try {
      await createOastSession(projectId, { label: newOastLabel });
      setNewOastLabel('');
      await refresh();
    } finally {
      setCreatingOast(false);
    }
  };

  const handleImportTraffic = async () => {
    setImportingTraffic(true);
    try {
      const har = trafficPayload.trim().startsWith('{') ? JSON.parse(trafficPayload) : trafficPayload;
      await importProjectTrafficCapture(projectId, {
        name: trafficName || `Traffic import ${new Date().toISOString().slice(0, 10)}`,
        source: 'har',
        har,
      });
      setTrafficName('');
      setTrafficPayload('');
      await refresh();
    } finally {
      setImportingTraffic(false);
    }
  };

  const handleReplayEntry = async (captureId: number, entryId: string) => {
    setReplayingEntryId(entryId);
    try {
      const result = await replayTrafficCapture(projectId, captureId, { entryId });
      setReplayResult(result);
    } finally {
      setReplayingEntryId(null);
    }
  };

  const handleReplayChain = async (captureId: number, chainIndex: number) => {
    const chainKey = `${captureId}:${chainIndex}`;
    setReplayingChainKey(chainKey);
    try {
      const result = await replayTrafficFlow(projectId, captureId, {
        chainIndex,
        carryCookies: carryFlowCookies,
      });
      setFlowReplayResult(result);
    } finally {
      setReplayingChainKey(null);
    }
  };

  const handleMutateEntry = async (captureId: number, entryId: string) => {
    setMutatingEntryId(entryId);
    try {
      const mutations = JSON.parse(mutationPayload || '{}') as Record<string, unknown>;
      const result = await mutateTrafficReplay(projectId, captureId, {
        entryId,
        mutations,
      });
      setMutationResult(result);
      setMutationEntryId(entryId);
    } finally {
      setMutatingEntryId(null);
    }
  };

  const handleFindingStatus = async (finding: SecurityFinding, status: string) => {
    setUpdatingFindingId(finding.id);
    try {
      await updateProjectFinding(projectId, finding.id, {
        status,
        fix_validation: status === 'fixed'
          ? (finding.fix_validation || 'Marked fixed from the security panel; add final regression proof after verification.')
          : finding.fix_validation,
      });
      await refresh();
    } finally {
      setUpdatingFindingId(null);
    }
  };

  const handleCopy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(''), 1200);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Security Operations
          </div>
          <div className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
            Critical {groupedCounts.critical ?? 0}
          </div>
          <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-[10px] text-orange-300">
            High {groupedCounts.high ?? 0}
          </div>
          <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
            Medium {groupedCounts.medium ?? 0}
          </div>
          <div className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300">
            Low {groupedCounts.low ?? 0}
          </div>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Scope, findings, callback URLs, traffic captures, and evidence packs for tester and researcher workflows.
        </div>
      </div>

      <div className="space-y-4 p-3">
        <section className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">Scope & Auth Vault</div>
              <div className="text-[11px] text-muted-foreground">Define in-scope hosts, start URLs, blocked hosts, auth profiles, and recurring scan intents.</div>
            </div>
            <button
              type="button"
              onClick={() => { void handleSaveProfile(); }}
              disabled={savingProfile}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
            >
              {savingProfile ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save scope
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <textarea value={allowedHosts} onChange={(event) => setAllowedHosts(event.target.value)} rows={4} placeholder="Allowed hosts (one per line)" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground" />
            <textarea value={startUrls} onChange={(event) => setStartUrls(event.target.value)} rows={4} placeholder="Start URLs" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground" />
            <textarea value={blockedHosts} onChange={(event) => setBlockedHosts(event.target.value)} rows={4} placeholder="Blocked hosts" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-[11px] text-foreground">
              <input type="checkbox" checked={allowProduction} onChange={(event) => setAllowProduction(event.target.checked)} />
              Allow production targets
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] text-foreground">
              Max depth
              <input value={maxDepth} onChange={(event) => setMaxDepth(event.target.value)} className="w-16 rounded border border-border bg-input px-2 py-1 text-[11px] text-foreground" />
            </label>
          </div>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Scope notes" className="mt-3 w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <textarea value={authProfilesJson} onChange={(event) => setAuthProfilesJson(event.target.value)} rows={8} placeholder="Auth profiles JSON" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground" />
            <textarea value={continuousScansJson} onChange={(event) => setContinuousScansJson(event.target.value)} rows={8} placeholder="Continuous scans JSON" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground" />
          </div>
          {profileError && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {profileError}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card/70 p-3">
          <div>
            <div className="text-sm font-medium text-foreground">Reverse Engineering Surface</div>
            <div className="text-[11px] text-muted-foreground">Work backward from bundles, source maps, storage keys, GraphQL, WebSockets, and imported traffic.</div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[11px] font-medium text-foreground">Endpoints</div>
              <div className="mt-2 max-h-36 overflow-auto space-y-1 text-[10px] text-muted-foreground">
                {(reverseEngineering?.endpoint_candidates ?? []).slice(0, 20).map((entry) => <div key={entry}>{entry}</div>)}
                {(reverseEngineering?.endpoint_candidates?.length ?? 0) === 0 && <div>No endpoint candidates yet.</div>}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[11px] font-medium text-foreground">GraphQL / WebSocket</div>
              <div className="mt-2 space-y-2 text-[10px] text-muted-foreground">
                <div>GraphQL: {(reverseEngineering?.graphql_operations ?? []).slice(0, 10).join(', ') || 'none'}</div>
                <div>WebSocket: {(reverseEngineering?.websocket_targets ?? []).slice(0, 6).join(', ') || 'none'}</div>
                <div>Source maps: {(reverseEngineering?.source_map_refs ?? []).slice(0, 6).join(', ') || 'none'}</div>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-[11px] font-medium text-foreground">Auth / Storage Clues</div>
              <div className="mt-2 space-y-2 text-[10px] text-muted-foreground">
                <div>Headers: {(reverseEngineering?.auth_headers ?? []).slice(0, 8).join(', ') || 'none'}</div>
                <div>LocalStorage: {(reverseEngineering?.local_storage_keys ?? []).slice(0, 8).join(', ') || 'none'}</div>
                <div>SessionStorage: {(reverseEngineering?.session_storage_keys ?? []).slice(0, 8).join(', ') || 'none'}</div>
                <div>Cookie writes: {(reverseEngineering?.cookie_writes ?? []).slice(0, 8).join(', ') || 'none'}</div>
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
            <div className="text-[11px] font-medium text-foreground">Bundle candidates</div>
            <div className="mt-2 space-y-2">
              {(reverseEngineering?.bundle_candidates ?? []).slice(0, 8).map((candidate) => (
                <div key={candidate.path} className="rounded-md border border-border/60 bg-card/70 p-2">
                  <div className="text-[11px] text-foreground">{candidate.path}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{candidate.signals.join(' • ')}</div>
                </div>
              ))}
              {(reverseEngineering?.bundle_candidates?.length ?? 0) === 0 && (
                <div className="text-[10px] text-muted-foreground">No strong reverse-engineering candidates detected yet.</div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">Custom Check Engine</div>
              <div className="text-[11px] text-muted-foreground">Create reusable regex, text, path, or dependency checks for customer-specific risk patterns.</div>
            </div>
            <button
              type="button"
              onClick={() => { void handleRunScan(); }}
              disabled={runningScan}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
            >
              {runningScan ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radar className="h-3 w-3" />}
              Run scan
            </button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <input value={checkName} onChange={(event) => setCheckName(event.target.value)} placeholder="Check name" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
            <select value={checkKind} onChange={(event) => setCheckKind(event.target.value)} className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="regex">Regex</option>
              <option value="text">Text</option>
              <option value="path">Path</option>
              <option value="dependency">Dependency</option>
            </select>
            <select value={checkSeverity} onChange={(event) => setCheckSeverity(event.target.value)} className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="info">Info</option>
            </select>
            <input value={checkFileGlob} onChange={(event) => setCheckFileGlob(event.target.value)} placeholder="File glob (optional)" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
            <input value={checkPattern} onChange={(event) => setCheckPattern(event.target.value)} placeholder="Pattern" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground md:col-span-2" />
            <input value={checkDependency} onChange={(event) => setCheckDependency(event.target.value)} placeholder="Dependency name (for dependency checks)" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground md:col-span-2" />
            <textarea value={checkRemediation} onChange={(event) => setCheckRemediation(event.target.value)} rows={2} placeholder="Remediation guidance" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground md:col-span-2" />
          </div>
          <button
            type="button"
            onClick={() => { void handleCreateCheck(); }}
            disabled={creatingCheck || !checkName.trim()}
            className="mt-3 inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            {creatingCheck ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add check
          </button>
          <div className="mt-3 space-y-2">
            {checks.map((check: SecurityCustomCheck) => (
              <div key={check.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground">{check.name}</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${severityTone(check.severity)}`}>{check.severity}</span>
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{check.kind}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {check.pattern || check.dependency_name || check.file_glob || 'No matcher saved.'}
                  </div>
                </div>
                <button type="button" onClick={() => { void handleDeleteCheck(check.id); }} disabled={deletingCheckId === check.id} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50">
                  {deletingCheckId === check.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            ))}
          </div>
          {latestScan && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/10 p-3">
              <div className="text-[12px] font-medium text-foreground">
                Latest scan: {latestScan.findings.length} findings, {latestScan.persisted_findings.length} persisted
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {String(latestScan.attack_surface.summary ?? 'Attack surface summary available.')}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">Findings & Triage</div>
              <div className="text-[11px] text-muted-foreground">Structured vulnerability tracking with evidence, status, standards mapping, and fix progress.</div>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {findings.length === 0 ? (
              <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-[11px] text-muted-foreground">
                No findings yet. Run a scan, save findings from the agent, or import evidence through the research workflow.
              </div>
            ) : findings.map((finding: SecurityFinding) => (
              <div key={finding.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-foreground">{finding.title}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${severityTone(finding.severity)}`}>{finding.severity}</span>
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{finding.status}</span>
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{finding.category}</span>
                </div>
                <div className="mt-2 text-[11px] text-foreground/90">{finding.summary || finding.impact || 'No summary yet.'}</div>
                {finding.affected_paths.length > 0 && (
                  <div className="mt-2 text-[10px] text-muted-foreground">Paths: {finding.affected_paths.join(', ')}</div>
                )}
                {finding.standards.length > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground">Standards: {finding.standards.join(', ')}</div>
                )}
                {finding.evidence.length > 0 && (
                  <div className="mt-2 rounded-md border border-border/60 bg-card/60 p-2 text-[10px] text-muted-foreground">
                    {finding.evidence.slice(0, 3).map((entry, index) => (
                      <div key={`${finding.id}-${index}`}>{entry.label}: {entry.details}</div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { void handleFindingStatus(finding, 'triaged'); }} disabled={updatingFindingId === finding.id} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
                    Triaged
                  </button>
                  <button type="button" onClick={() => { void handleFindingStatus(finding, 'in_progress'); }} disabled={updatingFindingId === finding.id} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
                    In progress
                  </button>
                  <button type="button" onClick={() => { void handleFindingStatus(finding, 'fixed'); }} disabled={updatingFindingId === finding.id} className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[10px] text-green-300 transition-colors hover:bg-green-500/15 disabled:opacity-50">
                    {updatingFindingId === finding.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Fixed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">Evidence Packs & OAST</div>
              <div className="text-[11px] text-muted-foreground">Generate report artifacts and callback URLs for blind out-of-band testing.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { void handleGenerateReport(); }} disabled={reporting} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50">
                {reporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                Generate report
              </button>
              <button type="button" onClick={() => { void handleCreateOast(); }} disabled={creatingOast} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50">
                {creatingOast ? <Loader2 className="h-3 w-3 animate-spin" /> : <Webhook className="h-3 w-3" />}
                New OAST URL
              </button>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newOastLabel} onChange={(event) => setNewOastLabel(event.target.value)} placeholder="OAST label (optional)" className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              {oastSessions.map((session) => (
                <div key={session.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-medium text-foreground">{session.label || `OAST ${session.id}`}</div>
                      <div className="text-[10px] text-muted-foreground">{session.hit_count} hit{session.hit_count === 1 ? '' : 's'}</div>
                    </div>
                    <button type="button" onClick={() => { void handleCopy(session.callback_url); }} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                      {copiedValue === session.callback_url ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  <div className="mt-2 break-all rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[10px] font-mono text-foreground/90">{session.callback_url}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {reports.map((report: SecurityReport) => (
                <div key={report.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12px] font-medium text-foreground">{report.title}</div>
                      <div className="text-[10px] text-muted-foreground">{report.finding_ids.length} finding{report.finding_ids.length === 1 ? '' : 's'} • {report.status}</div>
                    </div>
                    <button type="button" onClick={() => { void handleCopy(report.generated_markdown); }} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                      {copiedValue === report.generated_markdown ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-card/60 p-2 text-[10px] text-muted-foreground">{report.generated_markdown}</pre>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">Traffic Ingest</div>
              <div className="text-[11px] text-muted-foreground">Import HAR or captured traffic so the agent can map real endpoints and build evidence from replayable requests.</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <input value={trafficName} onChange={(event) => setTrafficName(event.target.value)} placeholder="Capture name" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
            <textarea value={trafficPayload} onChange={(event) => setTrafficPayload(event.target.value)} rows={6} placeholder="Paste HAR JSON here" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground" />
            <button type="button" onClick={() => { void handleImportTraffic(); }} disabled={importingTraffic || !trafficPayload.trim()} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50">
              {importingTraffic ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Import traffic
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {trafficCaptures.map((capture: TrafficCapture) => (
              <div key={capture.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-medium text-foreground">{capture.name}</div>
                    <div className="text-[10px] text-muted-foreground">{capture.request_count} requests • {capture.hosts.length} host{capture.hosts.length === 1 ? '' : 's'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{capture.source}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCaptureId(capture.id);
                        setReplayResult(null);
                        setFlowReplayResult(null);
                      }}
                      className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground">{capture.summary}</div>
                {capture.endpoints.length > 0 && (
                  <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-card/60 p-2 text-[10px] text-muted-foreground">{capture.endpoints.slice(0, 20).join('\n')}</pre>
                )}
              </div>
            ))}
          </div>

          {selectedCapture && (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Replay & Reverse Engineering</div>
                  <div className="text-[11px] text-muted-foreground">{selectedCapture.name}</div>
                </div>
                <button type="button" onClick={() => setSelectedCaptureId(null)} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                  Close
                </button>
              </div>

              {captureReverseEngineering && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-card/70 p-3">
                    <div className="text-[11px] font-medium text-foreground">Reverse engineering notes</div>
                    <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                      {captureReverseEngineering.notes.map((note) => (
                        <div key={note}>{note}</div>
                      ))}
                    </div>
                    <div className="mt-3 text-[10px] text-muted-foreground">
                      Auth headers: {captureReverseEngineering.auth_headers.join(', ') || 'none'}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Cookies: {captureReverseEngineering.cookie_names.join(', ') || 'none'}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Content types: {captureReverseEngineering.content_types.join(', ') || 'none'}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-card/70 p-3">
                    <div className="text-[11px] font-medium text-foreground">Likely auth / session entries</div>
                    <div className="mt-2 space-y-1 text-[10px] text-muted-foreground">
                      {captureReverseEngineering.likely_auth_entries.length === 0 ? (
                        <div>No obvious auth entries detected.</div>
                      ) : captureReverseEngineering.likely_auth_entries.slice(0, 8).map((entry) => (
                        <div key={`${entry.id}-${entry.order}`}>
                          #{entry.order} {entry.method} {entry.path} → {entry.status}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {captureFlow && (
                <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-medium text-foreground">Flow graph</div>
                    <label className="inline-flex items-center gap-2 text-[10px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={carryFlowCookies}
                        onChange={(event) => setCarryFlowCookies(event.target.checked)}
                        className="h-3 w-3 rounded border-border bg-input text-primary"
                      />
                      Carry cookies between requests
                    </label>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    {captureFlow.node_count} nodes • {captureFlow.edge_count} edges • {captureFlow.chains.length} chain{captureFlow.chains.length === 1 ? '' : 's'}
                  </div>
                  <div className="mt-2 space-y-2 text-[10px] text-muted-foreground">
                    {captureFlow.chains.slice(0, 6).map((chain, index) => (
                      <div key={`${chain.host}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/30 px-2 py-1.5">
                        <div>
                          {chain.host}: #{chain.start_order} → #{chain.end_order} ({chain.length} requests)
                        </div>
                        <button
                          type="button"
                          onClick={() => { void handleReplayChain(selectedCapture.id, index); }}
                          disabled={replayingChainKey === `${selectedCapture.id}:${index}`}
                          className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                        >
                          {replayingChainKey === `${selectedCapture.id}:${index}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Replay chain
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                <div className="text-[11px] font-medium text-foreground">Replayable entries</div>
                <div className="mt-2 space-y-2">
                  {(selectedCapture.entries ?? []).slice(0, 20).map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/60 bg-background/40 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] text-foreground">
                          <span className="font-medium">#{entry.order}</span> {entry.method} {entry.path}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${entry.response_status >= 400 ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                            {entry.response_status || 'n/a'}
                          </span>
                          <button type="button" onClick={() => { void handleCopy(entry.curl_template); }} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                            {copiedValue === entry.curl_template ? 'Copied' : 'Copy cURL'}
                          </button>
                          <button type="button" onClick={() => { void handleCopy(entry.fetch_template); }} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                            {copiedValue === entry.fetch_template ? 'Copied' : 'Copy fetch'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleReplayEntry(selectedCapture.id, entry.id); }}
                            disabled={replayingEntryId === entry.id}
                            className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                          >
                            {replayingEntryId === entry.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            Replay
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMutationEntryId(entry.id);
                              setMutationResult(null);
                            }}
                            className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Mutate
                          </button>
                        </div>
                      </div>
                      {entry.notes.length > 0 && (
                        <div className="mt-2 text-[10px] text-muted-foreground">{entry.notes.join(' • ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {mutationEntryId && (
                <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                  <div className="text-[11px] font-medium text-foreground">Mutation lab for entry {mutationEntryId}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Override headers, query params, method, path, or JSON body fragments before replaying.
                  </div>
                  <textarea
                    value={mutationPayload}
                    onChange={(event) => setMutationPayload(event.target.value)}
                    rows={8}
                    className="mt-2 w-full rounded-lg border border-border bg-input px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => { void handleMutateEntry(selectedCapture.id, mutationEntryId); }}
                    disabled={mutatingEntryId === mutationEntryId}
                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                  >
                    {mutatingEntryId === mutationEntryId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Mutate + replay
                  </button>
                </div>
              )}

              {replayResult && (
                <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                  <div className="text-[11px] font-medium text-foreground">Latest replay result</div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    Status match: {replayResult.comparison.status_matches ? 'yes' : 'no'} • Content type match: {replayResult.comparison.content_type_matches ? 'yes' : 'no'}
                  </div>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/40 p-2 text-[10px] text-muted-foreground">{JSON.stringify(replayResult, null, 2)}</pre>
                </div>
              )}

              {mutationResult && (
                <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                  <div className="text-[11px] font-medium text-foreground">Latest mutation replay</div>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/40 p-2 text-[10px] text-muted-foreground">{JSON.stringify(mutationResult, null, 2)}</pre>
                </div>
              )}

              {flowReplayResult && (
                <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-foreground">Latest flow replay</div>
                      <div className="text-[10px] text-muted-foreground">
                        {flowReplayResult.summary.total_steps} steps • {flowReplayResult.summary.matched_statuses} status matches • {flowReplayResult.summary.failures} failures
                      </div>
                    </div>
                    <button type="button" onClick={() => { void handleCopy(flowReplayResult.node_script); }} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                      {copiedValue === flowReplayResult.node_script ? 'Copied' : 'Copy Node script'}
                    </button>
                  </div>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/40 p-2 text-[10px] text-muted-foreground">{JSON.stringify(flowReplayResult, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </section>

        {(latestScan?.api_specs?.length ?? 0) > 0 && (
          <section className="rounded-xl border border-border bg-card/70 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Play className="h-4 w-4 text-primary" />
              API Security Surface
            </div>
            <div className="mt-3 space-y-2">
              {latestScan?.api_specs?.map((spec, index) => (
                <div key={`${spec.path ?? index}`} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="text-[12px] font-medium text-foreground">{String(spec.title ?? spec.path ?? 'API spec')}</div>
                  <div className="text-[10px] text-muted-foreground">{String(spec.path ?? '')}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-100/85">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
            <div>
              This panel gives the agent and your testers a real security workflow, but it is still a foundation layer. Deep dynamic scanning, replay proxies, and scanner-grade exploit coverage will keep improving on top of this.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
