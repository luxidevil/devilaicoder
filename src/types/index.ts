export interface Project {
  id: number;
  name: string;
  description: string;
  language: string;
  repo_url: string;
  repo_provider: string;
  repo_branch: string;
  repo_connected_at: string | null;
  repo_last_sync_at: string | null;
  repo_last_error: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: number;
  project_id: number;
  name: string;
  path: string;
  content: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  project_id: number;
  title: string;
  created_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: string;
}

export interface ProjectCheckpoint {
  id: number;
  project_id: number;
  reason: string;
  created_at: string;
  file_count: number;
}

export interface ProjectTask {
  id: number;
  project_id: number;
  title: string;
  request: string;
  acceptance_criteria: string[];
  status: string;
  workspace_key: string;
  base_checkpoint_id: number | null;
  changed_paths: string[];
  last_review: string;
  last_validation: string;
  last_summary: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  applied_at: string | null;
  discarded_at: string | null;
}

export interface ProjectTaskReview {
  summary: string;
  changed_paths: string[];
  added: string[];
  modified: string[];
  removed: string[];
  previews: Array<{
    path: string;
    status: string;
    preview: string;
  }>;
}

export interface ProjectSecurityProfile {
  project_id: number;
  scope: {
    allowed_hosts: string[];
    start_urls: string[];
    blocked_hosts: string[];
    allow_production: boolean;
    max_depth: number;
    notes: string;
  };
  auth_profiles: Array<{
    id: string;
    name: string;
    kind: string;
    start_url: string;
    login_path: string;
    username_secret_key: string;
    password_secret_key: string;
    otp_notes: string;
    role: string;
    notes: string;
    enabled: boolean;
  }>;
  continuous_scans: Array<{
    id: string;
    name: string;
    cadence: string;
    target: string;
    workflow: string;
    enabled: boolean;
    last_run_at: string | null;
  }>;
  updated_at: string;
}

export interface SecurityCustomCheck {
  id: number;
  project_id: number;
  name: string;
  description: string;
  kind: string;
  severity: string;
  pattern: string;
  file_glob: string;
  dependency_name: string;
  remediation: string;
  standards: string[];
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SecurityFinding {
  id: number;
  project_id: number;
  task_id: number | null;
  title: string;
  category: string;
  severity: string;
  status: string;
  source: string;
  dedupe_key: string;
  summary: string;
  impact: string;
  recommendation: string;
  affected_paths: string[];
  affected_urls: string[];
  standards: string[];
  tags: string[];
  evidence: Array<{
    label: string;
    details: string;
    source: string;
  }>;
  reproduction_steps: string[];
  regression_check: string;
  fix_validation: string;
  triage_owner: string;
  created_at: string;
  updated_at: string;
  fixed_at: string | null;
}

export interface SecurityReport {
  id: number;
  project_id: number;
  title: string;
  summary: string;
  status: string;
  finding_ids: number[];
  scope_snapshot: string;
  generated_markdown: string;
  created_at: string;
  updated_at: string;
}

export interface SecurityOastSession {
  id: number;
  project_id: number;
  label: string;
  token: string;
  callback_url: string;
  hit_count: number;
  last_hit_at: string | null;
  hits: Array<{
    method: string;
    path: string;
    query: string;
    headers: Record<string, unknown>;
    body_preview: string;
    ip: string;
    created_at: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface TrafficCapture {
  id: number;
  project_id: number;
  name: string;
  source: string;
  request_count: number;
  hosts: string[];
  endpoints: string[];
  summary: string;
  raw_excerpt: string;
  entries?: TrafficCaptureEntry[];
  created_at: string;
  updated_at: string;
}

export interface TrafficCaptureEntry {
  id: string;
  order: number;
  started_at: string | null;
  time_ms: number;
  method: string;
  url: string;
  host: string;
  path: string;
  query: string;
  http_version: string;
  headers: Array<{ name: string; value: string }>;
  cookies: Array<{ name: string; value: string }>;
  request_body_mime_type: string;
  request_body_text: string;
  request_body_base64: string;
  response_status: number;
  response_status_text: string;
  response_headers: Array<{ name: string; value: string }>;
  response_content_type: string;
  response_body_preview: string;
  fetch_template: string;
  curl_template: string;
  notes: string[];
}

export interface TrafficCaptureDetail {
  capture: TrafficCapture & { entries: TrafficCaptureEntry[] };
  reverse_engineering: {
    capture_id: number;
    name: string;
    request_count: number;
    hosts: string[];
    endpoints: string[];
    method_counts: Record<string, number>;
    content_types: string[];
    auth_headers: string[];
    cookie_names: string[];
    likely_auth_entries: Array<{ id: string; order: number; method: string; path: string; status: number }>;
    graphql_entries: Array<{ id: string; order: number; method: string; path: string }>;
    json_api_entries: Array<{ id: string; order: number; method: string; path: string; status: number }>;
    notes: string[];
  };
}

export interface TrafficReplayResult {
  entry: {
    id: string;
    order: number;
    method: string;
    url: string;
    path: string;
    host: string;
    notes: string[];
    fetch_template: string;
    curl_template: string;
  };
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body_preview: string;
  };
  response: {
    status: number;
    status_text: string;
    headers: Record<string, string>;
    body_preview: string;
  };
  comparison: {
    original_status: number;
    replay_status: number;
    status_matches: boolean;
    original_content_type: string;
    replay_content_type: string;
    content_type_matches: boolean;
    original_body_preview: string;
    replay_body_preview: string;
  };
}

export interface TrafficMutationResult {
  mutations: Record<string, unknown>;
  original: {
    id: string;
    order: number;
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    body_preview: string;
  };
  mutated: {
    id: string;
    order: number;
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    body_preview: string;
    fetch_template: string;
    curl_template: string;
  };
  replay: TrafficReplayResult;
}

export interface TrafficFlowGraph {
  capture_id: number;
  name: string;
  node_count: number;
  edge_count: number;
  nodes: Array<{
    id: string;
    order: number;
    label: string;
    status: number;
    host: string;
    notes: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
    reason: string;
  }>;
  chains: Array<{
    host: string;
    start_order: number;
    end_order: number;
    length: number;
    requests: Array<{
      id: string;
      order: number;
      method: string;
      path: string;
      status: number;
    }>;
  }>;
}

export interface TrafficFlowReplayResult {
  chain: {
    capture_id: number;
    capture_name: string;
    selected_by: string;
    entry_ids: string[];
    start_order: number;
    end_order: number;
    carry_cookies: boolean;
  };
  steps: Array<{
    entry_id: string;
    order: number;
    method: string;
    url: string;
    request_headers: Record<string, string>;
    request_body_preview: string;
    cookies_sent: string[];
    response_status: number;
    response_status_text: string;
    response_headers: Record<string, string>;
    response_body_preview: string;
    status_matches: boolean;
    content_type_matches: boolean;
    cookies_set: string[];
    notes: string[];
    error?: string;
  }>;
  summary: {
    total_steps: number;
    matched_statuses: number;
    matched_content_types: number;
    failures: number;
    final_cookie_jar: Array<{
      domain: string;
      cookies: Array<{ name: string; value: string }>;
    }>;
  };
  node_script: string;
}

export interface ProjectReverseEngineering {
  project: string;
  stack: string[];
  api_specs: Array<Record<string, unknown>>;
  endpoint_candidates: string[];
  absolute_hosts: string[];
  graphql_operations: string[];
  websocket_targets: string[];
  source_map_refs: string[];
  auth_headers: string[];
  local_storage_keys: string[];
  session_storage_keys: string[];
  cookie_writes: string[];
  dynamic_imports: string[];
  bundle_candidates: Array<{
    path: string;
    language: string;
    size: number;
    minified: boolean;
    signals: string[];
    endpoint_candidates: string[];
    graphql_operations: string[];
    websocket_targets: string[];
    source_maps: string[];
    auth_headers: string[];
    storage_keys: string[];
    cookie_writes: string[];
    dynamic_imports: string[];
  }>;
  traffic_summaries: Array<{
    capture_id: number;
    name: string;
    request_count: number;
    hosts: string[];
    endpoints: string[];
    method_counts: Record<string, number>;
    content_types: string[];
    auth_headers: string[];
    cookie_names: string[];
    likely_auth_entries: Array<{ id: string; order: number; method: string; path: string; status: number }>;
    graphql_entries: Array<{ id: string; order: number; method: string; path: string }>;
    json_api_entries: Array<{ id: string; order: number; method: string; path: string; status: number }>;
    notes: string[];
  }>;
  notes: string[];
}

export interface ProjectGitStatus {
  connected: boolean;
  repo_url: string;
  repo_provider: string;
  repo_branch: string;
  repo_connected_at: string | null;
  repo_last_sync_at: string | null;
  repo_last_error: string;
  status: {
    connected: boolean;
    branch: string;
    upstream: string;
    ahead: number;
    behind: number;
    clean: boolean;
    changes: string[];
    remoteUrl: string;
    lastCommitHash: string;
    lastCommitMessage: string;
    lastCommitAt: string;
  };
  error?: string;
  ok?: boolean;
  output?: string;
  committed?: boolean;
  checkpoint_id?: number | null;
  sync?: {
    ok: boolean;
    imported: number;
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
    skipped: number;
    truncated: boolean;
    totalChars: number;
    paths: string[];
  };
}

export interface FilePolicy {
  targets: string[];
  locked: string[];
  ignored: string[];
}

export type AgentEvent =
  | { type: 'user'; content: string }
  | { type: 'plan'; title: string; steps: string[] }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; tool: string; result: string }
  | { type: 'file_changed'; path: string; action: string }
  | { type: 'task_file_changed'; path: string; action: string; taskId?: number | null }
  | { type: 'checkpoint_created'; checkpointId: number; reason: string; created_at: string }
  | { type: 'browser_handoff'; sessionId: string; content: string; requiresVisibleBrowser: boolean }
  | { type: 'preview_url'; url: string }
  | { type: 'message'; content: string }
  | { type: 'error'; content: string }
  | { type: 'done' };

export type ChatMode = 'agent' | 'chat';
export type AgentProfile = 'builder' | 'design' | 'research' | 'autofix' | 'security';
export type AgentAutonomy = 'guided' | 'standard' | 'max';

export type AIProvider = 'gemini' | 'anthropic' | 'openai' | 'vertex' | 'kimi';

export interface UserKeys {
  provider: AIProvider;
  model: string;
  gemini_key?: string;
  anthropic_key?: string;
  openai_key?: string;
  vertex_key?: string;
  kimi_key?: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  language: string;
  icon: string;
  files: { path: string; content: string }[];
}
