import { API_BASE_URL, apiFetch, apiJson } from './supabase';
import type {
  AgentAutonomy,
  AgentProfile,
  Conversation,
  FilePolicy,
  Message,
  Project,
  ProjectCheckpoint,
  ProjectFile,
  ProjectGitStatus,
  ProjectSecurityProfile,
  ProjectTask,
  ProjectTaskReview,
  ProjectReverseEngineering,
  SecurityCustomCheck,
  SecurityFinding,
  SecurityOastSession,
  SecurityReport,
  TrafficCapture,
  TrafficCaptureDetail,
  TrafficFlowGraph,
  TrafficFlowReplayResult,
  TrafficMutationResult,
  TrafficReplayResult,
  UserKeys,
} from '../types';

export async function listProjects(): Promise<Project[]> {
  return apiJson<Project[]>('/projects');
}

export async function getProject(id: number): Promise<Project | null> {
  const response = await apiFetch(`/projects/${id}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    let error = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json() as { error?: string };
      if (data.error) error = data.error;
    } catch {}
    throw new Error(error);
  }
  return response.json() as Promise<Project>;
}

export async function createProject(payload: { name: string; description: string; language: string }): Promise<Project> {
  return apiJson<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteProject(id: number): Promise<void> {
  await apiJson<void>(`/projects/${id}`, { method: 'DELETE' });
}

export async function listFiles(projectId: number): Promise<ProjectFile[]> {
  return apiJson<ProjectFile[]>(`/projects/${projectId}/files`);
}

export async function createFile(projectId: number, payload: { name: string; path: string; content: string; language: string }): Promise<ProjectFile> {
  return apiJson<ProjectFile>(`/projects/${projectId}/files`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateFile(projectId: number, fileId: number, payload: { content?: string; name?: string; path?: string; language?: string }): Promise<ProjectFile> {
  return apiJson<ProjectFile>(`/projects/${projectId}/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteFile(projectId: number, fileId: number): Promise<void> {
  await apiJson<void>(`/projects/${projectId}/files/${fileId}`, { method: 'DELETE' });
}

export async function getProjectConversations(projectId: number): Promise<Conversation[]> {
  return apiJson<Conversation[]>(`/projects/${projectId}/conversations`);
}

export async function createConversation(projectId: number, title: string): Promise<Conversation> {
  return apiJson<Conversation>(`/projects/${projectId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function getMessages(conversationId: number): Promise<Message[]> {
  return apiJson<Message[]>(`/conversations/${conversationId}/messages`);
}

export async function saveMessage(conversationId: number, role: string, content: string): Promise<void> {
  await apiJson<void>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });
}

export interface ProjectDoc {
  id: number;
  project_id: number;
  title: string;
  content: string;
  source_type: string;
  source_ref: string;
  created_at: string;
  updated_at: string;
}

export type ProjectDocImportSource = 'figma' | 'github' | 'web' | 'openapi';

export async function listDocs(projectId: number): Promise<ProjectDoc[]> {
  return apiJson<ProjectDoc[]>(`/projects/${projectId}/docs`);
}

export async function createDoc(projectId: number, title: string, content: string): Promise<ProjectDoc> {
  return apiJson<ProjectDoc>(`/projects/${projectId}/docs`, {
    method: 'POST',
    body: JSON.stringify({ title, content }),
  });
}

export async function importProjectDoc(projectId: number, payload: {
  sourceType: ProjectDocImportSource;
  url: string;
  title?: string;
  token?: string;
}): Promise<ProjectDoc> {
  return apiJson<ProjectDoc>(`/projects/${projectId}/docs/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateDoc(docId: number, title: string, content: string): Promise<ProjectDoc> {
  return apiJson<ProjectDoc>(`/docs/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title, content }),
  });
}

export async function deleteDoc(docId: number): Promise<void> {
  await apiJson<void>(`/docs/${docId}`, { method: 'DELETE' });
}

export async function loadProjectSecrets(projectId: number): Promise<{ key: string; value: string }[]> {
  return apiJson<{ key: string; value: string }[]>(`/projects/${projectId}/secrets`);
}

export async function saveProjectSecrets(projectId: number, secrets: { key: string; value: string }[]): Promise<void> {
  await apiJson<void>(`/projects/${projectId}/secrets`, {
    method: 'PUT',
    body: JSON.stringify({ secrets }),
  });
}

export async function getAdminSettings() {
  return apiJson<{
    provider: string;
    model: string;
    geminiKeyConfigured: boolean;
    anthropicKeyConfigured: boolean;
    openaiKeyConfigured: boolean;
    vertexKeyConfigured: boolean;
    kimiKeyConfigured: boolean;
  }>('/admin/settings');
}

export async function saveAdminSettings(s: { provider: string; model: string; geminiApiKey?: string; anthropicApiKey?: string; openaiApiKey?: string; vertexApiKey?: string; kimiApiKey?: string }): Promise<void> {
  await apiJson<void>('/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(s),
  });
}

export async function getAdminStats() {
  return apiJson<{ projectCount: number; fileCount: number; userCount: number }>('/admin/stats');
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  subscription_tier: string;
  created_at: string;
  credit_balance: number;
  total_purchased: number;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  return apiJson<AdminUser[]>('/admin/users');
}

export async function grantCredits(userId: string, amount: number, note: string): Promise<void> {
  await apiJson<void>(`/admin/users/${userId}/credits`, {
    method: 'POST',
    body: JSON.stringify({ amount, note }),
  });
}

export async function getRunnerClientConfig(): Promise<{
  runner_url: string;
  configured: boolean;
  reachable: boolean;
  browser_available: boolean;
  error: string;
}> {
  return apiJson('/runner/config');
}

export async function getAdminRunnerConfig(): Promise<{ runner_url: string; runner_secret: string }> {
  return apiJson<{ runner_url: string; runner_secret: string }>('/admin/runner');
}

export async function saveRunnerConfig(runner_url: string, runner_secret: string): Promise<void> {
  await apiJson<void>('/admin/runner', {
    method: 'PUT',
    body: JSON.stringify({ runner_url, runner_secret }),
  });
}

export async function testRunnerConfig(runner_url?: string, runner_secret?: string) {
  return apiJson<{ status: string; platform: string; node: string; workDir: string; puppeteer: string }>('/admin/runner/test', {
    method: 'POST',
    body: JSON.stringify({ runner_url, runner_secret }),
  });
}

export async function setSubscriptionTier(userId: string, tier: string): Promise<void> {
  await apiJson<void>(`/admin/users/${userId}/tier`, {
    method: 'PATCH',
    body: JSON.stringify({ tier }),
  });
}

export async function listProjectCheckpoints(projectId: number): Promise<ProjectCheckpoint[]> {
  return apiJson<ProjectCheckpoint[]>(`/projects/${projectId}/checkpoints`);
}

export async function createProjectCheckpoint(projectId: number, reason: string): Promise<ProjectCheckpoint> {
  return apiJson<ProjectCheckpoint>(`/projects/${projectId}/checkpoints`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function restoreProjectCheckpoint(projectId: number, checkpointId: number): Promise<void> {
  await apiJson<void>(`/projects/${projectId}/checkpoints/${checkpointId}/restore`, {
    method: 'POST',
  });
}

export async function deleteProjectCheckpoint(projectId: number, checkpointId: number): Promise<void> {
  await apiJson<void>(`/projects/${projectId}/checkpoints/${checkpointId}`, {
    method: 'DELETE',
  });
}

export async function listProjectTasks(projectId: number): Promise<ProjectTask[]> {
  return apiJson<ProjectTask[]>(`/projects/${projectId}/tasks`);
}

export async function createProjectTask(projectId: number, payload: { title: string; request: string; acceptance_criteria: string[] }): Promise<ProjectTask> {
  return apiJson<ProjectTask>(`/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getProjectTask(projectId: number, taskId: number): Promise<ProjectTask> {
  return apiJson<ProjectTask>(`/projects/${projectId}/tasks/${taskId}`);
}

export async function reviewProjectTask(projectId: number, taskId: number): Promise<{ task: ProjectTask; review: ProjectTaskReview }> {
  return apiJson<{ task: ProjectTask; review: ProjectTaskReview }>(`/projects/${projectId}/tasks/${taskId}/review`);
}

export async function applyProjectTask(projectId: number, taskId: number): Promise<{ ok: boolean; checkpoint_id: number; task: ProjectTask; review: ProjectTaskReview }> {
  return apiJson<{ ok: boolean; checkpoint_id: number; task: ProjectTask; review: ProjectTaskReview }>(`/projects/${projectId}/tasks/${taskId}/apply`, {
    method: 'POST',
  });
}

export async function discardProjectTask(projectId: number, taskId: number): Promise<{ ok: boolean; task: ProjectTask }> {
  return apiJson<{ ok: boolean; task: ProjectTask }>(`/projects/${projectId}/tasks/${taskId}/discard`, {
    method: 'POST',
  });
}

export async function getProjectSecurityContext(projectId: number): Promise<{
  profile: ProjectSecurityProfile;
  checks: SecurityCustomCheck[];
  findings: SecurityFinding[];
  reports: SecurityReport[];
  oast_sessions: SecurityOastSession[];
  traffic_captures: TrafficCapture[];
}> {
  return apiJson(`/projects/${projectId}/security/context`);
}

export async function getProjectSecurityProfile(projectId: number): Promise<ProjectSecurityProfile> {
  return apiJson<ProjectSecurityProfile>(`/projects/${projectId}/security/profile`);
}

export async function saveProjectSecurityProfile(projectId: number, payload: {
  scope: ProjectSecurityProfile['scope'];
  auth_profiles: ProjectSecurityProfile['auth_profiles'];
  continuous_scans: ProjectSecurityProfile['continuous_scans'];
}): Promise<ProjectSecurityProfile> {
  return apiJson<ProjectSecurityProfile>(`/projects/${projectId}/security/profile`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listSecurityChecks(projectId: number): Promise<SecurityCustomCheck[]> {
  return apiJson<SecurityCustomCheck[]>(`/projects/${projectId}/security/checks`);
}

export async function createSecurityCheck(projectId: number, payload: Partial<SecurityCustomCheck> & { name: string }): Promise<SecurityCustomCheck> {
  return apiJson<SecurityCustomCheck>(`/projects/${projectId}/security/checks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSecurityCheck(projectId: number, checkId: number, payload: Partial<SecurityCustomCheck>): Promise<SecurityCustomCheck> {
  return apiJson<SecurityCustomCheck>(`/projects/${projectId}/security/checks/${checkId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteSecurityCheck(projectId: number, checkId: number): Promise<void> {
  await apiJson<void>(`/projects/${projectId}/security/checks/${checkId}`, {
    method: 'DELETE',
  });
}

export async function runProjectSecurityScan(projectId: number, payload: { persist?: boolean; taskId?: number | null; continuousScanId?: string } = {}): Promise<{
  attack_surface: Record<string, unknown>;
  api_specs: Array<Record<string, unknown>>;
  findings: SecurityFinding[];
  profile: ProjectSecurityProfile;
  persisted_findings: SecurityFinding[];
}> {
  return apiJson(`/projects/${projectId}/security/scan`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getProjectReverseEngineering(projectId: number): Promise<ProjectReverseEngineering> {
  return apiJson<ProjectReverseEngineering>(`/projects/${projectId}/security/reverse-engineering`);
}

export async function listProjectFindings(projectId: number): Promise<SecurityFinding[]> {
  return apiJson<SecurityFinding[]>(`/projects/${projectId}/findings`);
}

export async function createProjectFinding(projectId: number, payload: Partial<SecurityFinding> & { title: string }): Promise<SecurityFinding> {
  return apiJson<SecurityFinding>(`/projects/${projectId}/findings`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateProjectFinding(projectId: number, findingId: number, payload: Partial<SecurityFinding>): Promise<SecurityFinding> {
  return apiJson<SecurityFinding>(`/projects/${projectId}/findings/${findingId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function listSecurityReports(projectId: number): Promise<SecurityReport[]> {
  return apiJson<SecurityReport[]>(`/projects/${projectId}/reports`);
}

export async function generateProjectSecurityReport(projectId: number, payload: { title?: string; summary?: string; status?: string; finding_ids?: number[] } = {}): Promise<SecurityReport> {
  return apiJson<SecurityReport>(`/projects/${projectId}/reports/generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listOastSessions(projectId: number): Promise<SecurityOastSession[]> {
  return apiJson<SecurityOastSession[]>(`/projects/${projectId}/oast/sessions`);
}

export async function createOastSession(projectId: number, payload: { label?: string } = {}): Promise<SecurityOastSession> {
  return apiJson<SecurityOastSession>(`/projects/${projectId}/oast/sessions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listTrafficCaptures(projectId: number): Promise<TrafficCapture[]> {
  return apiJson<TrafficCapture[]>(`/projects/${projectId}/security/traffic`);
}

export async function importProjectTrafficCapture(projectId: number, payload: { name?: string; source?: string; har?: string | Record<string, unknown> }): Promise<TrafficCapture> {
  return apiJson<TrafficCapture>(`/projects/${projectId}/security/traffic/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTrafficCaptureDetail(projectId: number, captureId: number): Promise<TrafficCaptureDetail> {
  return apiJson<TrafficCaptureDetail>(`/projects/${projectId}/security/traffic/${captureId}`);
}

export async function replayTrafficCapture(projectId: number, captureId: number, payload: { entryId?: string | number; timeoutMs?: number } = {}): Promise<TrafficReplayResult> {
  return apiJson<TrafficReplayResult>(`/projects/${projectId}/security/traffic/${captureId}/replay`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTrafficFlowGraph(projectId: number, captureId: number): Promise<TrafficFlowGraph> {
  return apiJson<TrafficFlowGraph>(`/projects/${projectId}/security/traffic/${captureId}/flow`);
}

export async function replayTrafficFlow(projectId: number, captureId: number, payload: { chainIndex?: number; entryIds?: Array<string | number>; startOrder?: number; endOrder?: number; carryCookies?: boolean; stopOnFailure?: boolean; timeoutMs?: number } = {}): Promise<TrafficFlowReplayResult> {
  return apiJson<TrafficFlowReplayResult>(`/projects/${projectId}/security/traffic/${captureId}/replay-flow`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function mutateTrafficReplay(projectId: number, captureId: number, payload: { entryId?: string | number; mutations?: Record<string, unknown>; timeoutMs?: number } = {}): Promise<TrafficMutationResult> {
  return apiJson<TrafficMutationResult>(`/projects/${projectId}/security/traffic/${captureId}/mutate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getProjectGitStatus(projectId: number): Promise<ProjectGitStatus> {
  return apiJson<ProjectGitStatus>(`/projects/${projectId}/git`);
}

export async function connectProjectRepo(projectId: number, payload: { repoUrl: string; branch?: string }): Promise<ProjectGitStatus> {
  return apiJson<ProjectGitStatus>(`/projects/${projectId}/git/connect`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function pullProjectRepo(projectId: number, payload: { branch?: string } = {}): Promise<ProjectGitStatus> {
  return apiJson<ProjectGitStatus>(`/projects/${projectId}/git/pull`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function pushProjectRepo(projectId: number, payload: { message: string; branch?: string }): Promise<ProjectGitStatus> {
  return apiJson<ProjectGitStatus>(`/projects/${projectId}/git/push`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncProjectFromRunner(projectId: number): Promise<ProjectGitStatus> {
  return apiJson<ProjectGitStatus>(`/projects/${projectId}/git/sync`, {
    method: 'POST',
  });
}

export async function getUserCredits(_userId?: string): Promise<{ balance: number; subscription_tier: string }> {
  return apiJson<{ balance: number; subscription_tier: string }>('/me/credits');
}

export function streamAgent(
  payload: {
    message: string;
    projectId: number;
    files: ProjectFile[];
    docs: { title: string; content: string }[];
    history: { role: string; content: string }[];
    mode: 'agent' | 'chat';
    profile?: AgentProfile;
    fastMode?: boolean;
    autonomy?: AgentAutonomy;
    appTesting?: boolean;
    websiteMode?: boolean;
    manualBrowser?: boolean;
    browserSessionId?: string;
    filePolicy?: FilePolicy;
    taskId?: number;
    userKeys?: UserKeys;
    userId?: string;
  },
  signal?: AbortSignal,
): Promise<Response> {
  return apiFetch('/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export { API_BASE_URL };
