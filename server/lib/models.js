import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
}, { versionKey: false });

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  display_name: { type: String, required: true, trim: true },
  is_admin: { type: Boolean, default: false },
  subscription_tier: { type: String, default: 'free' },
  credit_balance: { type: Number, default: 10 },
  total_purchased: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

const projectSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  language: { type: String, default: 'typescript' },
  repo_url: { type: String, default: '' },
  repo_provider: { type: String, default: '' },
  repo_branch: { type: String, default: '' },
  repo_connected_at: { type: Date, default: null },
  repo_last_sync_at: { type: Date, default: null },
  repo_last_error: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const fileSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  name: { type: String, required: true },
  path: { type: String, required: true },
  content: { type: String, default: '' },
  language: { type: String, default: 'plaintext' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

fileSchema.index({ project_id: 1, path: 1 }, { unique: true });

const conversationSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  title: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

const messageSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  conversation_id: { type: Number, required: true, index: true },
  role: { type: String, required: true },
  content: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

const projectDocSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  title: { type: String, required: true },
  content: { type: String, default: '' },
  source_type: { type: String, default: 'manual' },
  source_ref: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const projectCheckpointSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason: { type: String, default: '' },
  files: {
    type: [{
      path: { type: String, required: true },
      name: { type: String, required: true },
      language: { type: String, default: 'plaintext' },
      content: { type: String, default: '' },
    }],
    default: [],
  },
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

const projectTaskSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  request: { type: String, default: '' },
  acceptance_criteria: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  status: { type: String, default: 'active' },
  workspace_key: { type: String, required: true, index: true },
  base_checkpoint_id: { type: Number, default: null },
  changed_paths: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  last_review: { type: String, default: '' },
  last_validation: { type: String, default: '' },
  last_summary: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  last_activity_at: { type: Date, default: Date.now },
  applied_at: { type: Date, default: null },
  discarded_at: { type: Date, default: null },
}, { versionKey: false });

const projectTaskFileSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  task_id: { type: Number, required: true, index: true },
  project_id: { type: Number, required: true, index: true },
  name: { type: String, required: true },
  path: { type: String, required: true },
  content: { type: String, default: '' },
  language: { type: String, default: 'plaintext' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

projectTaskFileSchema.index({ task_id: 1, path: 1 }, { unique: true });

const projectSecurityProfileSchema = new Schema({
  project_id: { type: Number, required: true, unique: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scope: {
    allowed_hosts: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    start_urls: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    blocked_hosts: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    allow_production: { type: Boolean, default: false },
    max_depth: { type: Number, default: 4 },
    notes: { type: String, default: '' },
  },
  auth_profiles: {
    type: [{
      id: { type: String, required: true },
      name: { type: String, required: true },
      kind: { type: String, default: 'session' },
      start_url: { type: String, default: '' },
      login_path: { type: String, default: '' },
      username_secret_key: { type: String, default: '' },
      password_secret_key: { type: String, default: '' },
      otp_notes: { type: String, default: '' },
      role: { type: String, default: '' },
      notes: { type: String, default: '' },
      enabled: { type: Boolean, default: true },
    }],
    default: [],
  },
  continuous_scans: {
    type: [{
      id: { type: String, required: true },
      name: { type: String, required: true },
      cadence: { type: String, default: 'manual' },
      target: { type: String, default: '' },
      workflow: { type: String, default: '' },
      enabled: { type: Boolean, default: true },
      last_run_at: { type: Date, default: null },
    }],
    default: [],
  },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const securityCustomCheckSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  kind: { type: String, default: 'regex' },
  severity: { type: String, default: 'medium' },
  pattern: { type: String, default: '' },
  file_glob: { type: String, default: '' },
  dependency_name: { type: String, default: '' },
  remediation: { type: String, default: '' },
  standards: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  tags: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  enabled: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const securityFindingSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  task_id: { type: Number, default: null, index: true },
  title: { type: String, required: true, trim: true },
  category: { type: String, default: 'security' },
  severity: { type: String, default: 'medium' },
  status: { type: String, default: 'open' },
  source: { type: String, default: 'manual' },
  dedupe_key: { type: String, default: '', index: true },
  summary: { type: String, default: '' },
  impact: { type: String, default: '' },
  recommendation: { type: String, default: '' },
  affected_paths: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  affected_urls: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  standards: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  tags: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  evidence: {
    type: [{
      label: { type: String, default: '' },
      details: { type: String, default: '' },
      source: { type: String, default: '' },
    }],
    default: [],
  },
  reproduction_steps: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  regression_check: { type: String, default: '' },
  fix_validation: { type: String, default: '' },
  triage_owner: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  fixed_at: { type: Date, default: null },
}, { versionKey: false });

securityFindingSchema.index({ project_id: 1, dedupe_key: 1 });

const securityReportSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  summary: { type: String, default: '' },
  status: { type: String, default: 'draft' },
  finding_ids: {
    type: [{ type: Number }],
    default: [],
  },
  scope_snapshot: { type: String, default: '' },
  generated_markdown: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const securityOastSessionSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  label: { type: String, default: '' },
  token: { type: String, required: true, unique: true, index: true },
  callback_url: { type: String, default: '' },
  hit_count: { type: Number, default: 0 },
  last_hit_at: { type: Date, default: null },
  hits: {
    type: [{
      method: { type: String, default: 'GET' },
      path: { type: String, default: '' },
      query: { type: String, default: '' },
      headers: { type: Schema.Types.Mixed, default: {} },
      body_preview: { type: String, default: '' },
      ip: { type: String, default: '' },
      created_at: { type: Date, default: Date.now },
    }],
    default: [],
  },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const trafficCaptureSchema = new Schema({
  id: { type: Number, required: true, unique: true, index: true },
  project_id: { type: Number, required: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  source: { type: String, default: 'har' },
  request_count: { type: Number, default: 0 },
  hosts: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  endpoints: {
    type: [{ type: String, trim: true }],
    default: [],
  },
  summary: { type: String, default: '' },
  raw_excerpt: { type: String, default: '' },
  entries: {
    type: [{
      id: { type: String, required: true },
      order: { type: Number, default: 0 },
      started_at: { type: Date, default: null },
      time_ms: { type: Number, default: 0 },
      method: { type: String, default: 'GET' },
      url: { type: String, default: '' },
      host: { type: String, default: '' },
      path: { type: String, default: '' },
      query: { type: String, default: '' },
      http_version: { type: String, default: '' },
      headers: {
        type: [{
          name: { type: String, default: '' },
          value: { type: String, default: '' },
        }],
        default: [],
      },
      cookies: {
        type: [{
          name: { type: String, default: '' },
          value: { type: String, default: '' },
        }],
        default: [],
      },
      request_body_mime_type: { type: String, default: '' },
      request_body_text: { type: String, default: '' },
      request_body_base64: { type: String, default: '' },
      response_status: { type: Number, default: 0 },
      response_status_text: { type: String, default: '' },
      response_headers: {
        type: [{
          name: { type: String, default: '' },
          value: { type: String, default: '' },
        }],
        default: [],
      },
      response_content_type: { type: String, default: '' },
      response_body_preview: { type: String, default: '' },
      fetch_template: { type: String, default: '' },
      curl_template: { type: String, default: '' },
      notes: {
        type: [{ type: String, trim: true }],
        default: [],
      },
    }],
    default: [],
  },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: '' },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const projectSecretSchema = new Schema({
  project_id: { type: Number, required: true, unique: true, index: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  secrets: {
    type: [{
      key: { type: String, required: true },
      value: { type: String, default: '' },
    }],
    default: [],
  },
  updated_at: { type: Date, default: Date.now },
}, { versionKey: false });

const creditTransactionSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  note: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

export const Counter = models.Counter || model('Counter', counterSchema);
export const User = models.User || model('User', userSchema);
export const Project = models.Project || model('Project', projectSchema);
export const ProjectFile = models.ProjectFile || model('ProjectFile', fileSchema);
export const Conversation = models.Conversation || model('Conversation', conversationSchema);
export const Message = models.Message || model('Message', messageSchema);
export const ProjectDoc = models.ProjectDoc || model('ProjectDoc', projectDocSchema);
export const ProjectCheckpoint = models.ProjectCheckpoint || model('ProjectCheckpoint', projectCheckpointSchema);
export const ProjectTask = models.ProjectTask || model('ProjectTask', projectTaskSchema);
export const ProjectTaskFile = models.ProjectTaskFile || model('ProjectTaskFile', projectTaskFileSchema);
export const ProjectSecurityProfile = models.ProjectSecurityProfile || model('ProjectSecurityProfile', projectSecurityProfileSchema);
export const SecurityCustomCheck = models.SecurityCustomCheck || model('SecurityCustomCheck', securityCustomCheckSchema);
export const SecurityFinding = models.SecurityFinding || model('SecurityFinding', securityFindingSchema);
export const SecurityReport = models.SecurityReport || model('SecurityReport', securityReportSchema);
export const SecurityOastSession = models.SecurityOastSession || model('SecurityOastSession', securityOastSessionSchema);
export const TrafficCapture = models.TrafficCapture || model('TrafficCapture', trafficCaptureSchema);
export const Setting = models.Setting || model('Setting', settingSchema);
export const ProjectSecret = models.ProjectSecret || model('ProjectSecret', projectSecretSchema);
export const CreditTransaction = models.CreditTransaction || model('CreditTransaction', creditTransactionSchema);

export async function nextSequence(key) {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return counter.seq;
}

export function serializeUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    display_name: user.display_name,
    is_admin: !!user.is_admin,
    subscription_tier: user.subscription_tier ?? 'free',
    credit_balance: user.credit_balance ?? 0,
    total_purchased: user.total_purchased ?? 0,
    created_at: user.created_at?.toISOString?.() ?? new Date(user.created_at).toISOString(),
  };
}

export function serializeProject(project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    language: project.language ?? 'typescript',
    repo_url: project.repo_url ?? '',
    repo_provider: project.repo_provider ?? '',
    repo_branch: project.repo_branch ?? '',
    repo_connected_at: project.repo_connected_at?.toISOString?.() ?? (project.repo_connected_at ? new Date(project.repo_connected_at).toISOString() : null),
    repo_last_sync_at: project.repo_last_sync_at?.toISOString?.() ?? (project.repo_last_sync_at ? new Date(project.repo_last_sync_at).toISOString() : null),
    repo_last_error: project.repo_last_error ?? '',
    created_at: project.created_at?.toISOString?.() ?? new Date(project.created_at).toISOString(),
    updated_at: project.updated_at?.toISOString?.() ?? new Date(project.updated_at).toISOString(),
  };
}

export function serializeFile(file) {
  return {
    id: file.id,
    project_id: file.project_id,
    name: file.name,
    path: file.path,
    content: file.content ?? '',
    language: file.language ?? 'plaintext',
    created_at: file.created_at?.toISOString?.() ?? new Date(file.created_at).toISOString(),
    updated_at: file.updated_at?.toISOString?.() ?? new Date(file.updated_at).toISOString(),
  };
}

export function serializeConversation(conversation) {
  return {
    id: conversation.id,
    project_id: conversation.project_id,
    title: conversation.title,
    created_at: conversation.created_at?.toISOString?.() ?? new Date(conversation.created_at).toISOString(),
  };
}

export function serializeMessage(message) {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    role: message.role,
    content: message.content ?? '',
    created_at: message.created_at?.toISOString?.() ?? new Date(message.created_at).toISOString(),
  };
}

export function serializeProjectDoc(doc) {
  return {
    id: doc.id,
    project_id: doc.project_id,
    title: doc.title,
    content: doc.content ?? '',
    source_type: doc.source_type ?? 'manual',
    source_ref: doc.source_ref ?? '',
    created_at: doc.created_at?.toISOString?.() ?? new Date(doc.created_at).toISOString(),
    updated_at: doc.updated_at?.toISOString?.() ?? new Date(doc.updated_at ?? doc.created_at).toISOString(),
  };
}

export function serializeProjectCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    project_id: checkpoint.project_id,
    reason: checkpoint.reason ?? '',
    created_at: checkpoint.created_at?.toISOString?.() ?? new Date(checkpoint.created_at).toISOString(),
    file_count: Array.isArray(checkpoint.files) ? checkpoint.files.length : 0,
  };
}

export function serializeProjectTask(task) {
  return {
    id: task.id,
    project_id: task.project_id,
    title: task.title,
    request: task.request ?? '',
    acceptance_criteria: Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [],
    status: task.status ?? 'active',
    workspace_key: task.workspace_key ?? '',
    base_checkpoint_id: task.base_checkpoint_id ?? null,
    changed_paths: Array.isArray(task.changed_paths) ? task.changed_paths : [],
    last_review: task.last_review ?? '',
    last_validation: task.last_validation ?? '',
    last_summary: task.last_summary ?? '',
    created_at: task.created_at?.toISOString?.() ?? new Date(task.created_at).toISOString(),
    updated_at: task.updated_at?.toISOString?.() ?? new Date(task.updated_at).toISOString(),
    last_activity_at: task.last_activity_at?.toISOString?.() ?? new Date(task.last_activity_at).toISOString(),
    applied_at: task.applied_at?.toISOString?.() ?? (task.applied_at ? new Date(task.applied_at).toISOString() : null),
    discarded_at: task.discarded_at?.toISOString?.() ?? (task.discarded_at ? new Date(task.discarded_at).toISOString() : null),
  };
}

export function serializeProjectSecurityProfile(profile) {
  return {
    project_id: profile.project_id,
    scope: {
      allowed_hosts: Array.isArray(profile.scope?.allowed_hosts) ? profile.scope.allowed_hosts : [],
      start_urls: Array.isArray(profile.scope?.start_urls) ? profile.scope.start_urls : [],
      blocked_hosts: Array.isArray(profile.scope?.blocked_hosts) ? profile.scope.blocked_hosts : [],
      allow_production: !!profile.scope?.allow_production,
      max_depth: Number(profile.scope?.max_depth ?? 4),
      notes: profile.scope?.notes ?? '',
    },
    auth_profiles: Array.isArray(profile.auth_profiles) ? profile.auth_profiles.map((entry) => ({
      id: entry.id,
      name: entry.name ?? '',
      kind: entry.kind ?? 'session',
      start_url: entry.start_url ?? '',
      login_path: entry.login_path ?? '',
      username_secret_key: entry.username_secret_key ?? '',
      password_secret_key: entry.password_secret_key ?? '',
      otp_notes: entry.otp_notes ?? '',
      role: entry.role ?? '',
      notes: entry.notes ?? '',
      enabled: entry.enabled !== false,
    })) : [],
    continuous_scans: Array.isArray(profile.continuous_scans) ? profile.continuous_scans.map((entry) => ({
      id: entry.id,
      name: entry.name ?? '',
      cadence: entry.cadence ?? 'manual',
      target: entry.target ?? '',
      workflow: entry.workflow ?? '',
      enabled: entry.enabled !== false,
      last_run_at: entry.last_run_at?.toISOString?.() ?? (entry.last_run_at ? new Date(entry.last_run_at).toISOString() : null),
    })) : [],
    updated_at: profile.updated_at?.toISOString?.() ?? new Date(profile.updated_at).toISOString(),
  };
}

export function serializeSecurityCustomCheck(check) {
  return {
    id: check.id,
    project_id: check.project_id,
    name: check.name,
    description: check.description ?? '',
    kind: check.kind ?? 'regex',
    severity: check.severity ?? 'medium',
    pattern: check.pattern ?? '',
    file_glob: check.file_glob ?? '',
    dependency_name: check.dependency_name ?? '',
    remediation: check.remediation ?? '',
    standards: Array.isArray(check.standards) ? check.standards : [],
    tags: Array.isArray(check.tags) ? check.tags : [],
    enabled: check.enabled !== false,
    created_at: check.created_at?.toISOString?.() ?? new Date(check.created_at).toISOString(),
    updated_at: check.updated_at?.toISOString?.() ?? new Date(check.updated_at).toISOString(),
  };
}

export function serializeSecurityFinding(finding) {
  return {
    id: finding.id,
    project_id: finding.project_id,
    task_id: finding.task_id ?? null,
    title: finding.title,
    category: finding.category ?? 'security',
    severity: finding.severity ?? 'medium',
    status: finding.status ?? 'open',
    source: finding.source ?? 'manual',
    dedupe_key: finding.dedupe_key ?? '',
    summary: finding.summary ?? '',
    impact: finding.impact ?? '',
    recommendation: finding.recommendation ?? '',
    affected_paths: Array.isArray(finding.affected_paths) ? finding.affected_paths : [],
    affected_urls: Array.isArray(finding.affected_urls) ? finding.affected_urls : [],
    standards: Array.isArray(finding.standards) ? finding.standards : [],
    tags: Array.isArray(finding.tags) ? finding.tags : [],
    evidence: Array.isArray(finding.evidence) ? finding.evidence.map((entry) => ({
      label: entry.label ?? '',
      details: entry.details ?? '',
      source: entry.source ?? '',
    })) : [],
    reproduction_steps: Array.isArray(finding.reproduction_steps) ? finding.reproduction_steps : [],
    regression_check: finding.regression_check ?? '',
    fix_validation: finding.fix_validation ?? '',
    triage_owner: finding.triage_owner ?? '',
    created_at: finding.created_at?.toISOString?.() ?? new Date(finding.created_at).toISOString(),
    updated_at: finding.updated_at?.toISOString?.() ?? new Date(finding.updated_at).toISOString(),
    fixed_at: finding.fixed_at?.toISOString?.() ?? (finding.fixed_at ? new Date(finding.fixed_at).toISOString() : null),
  };
}

export function serializeSecurityReport(report) {
  return {
    id: report.id,
    project_id: report.project_id,
    title: report.title,
    summary: report.summary ?? '',
    status: report.status ?? 'draft',
    finding_ids: Array.isArray(report.finding_ids) ? report.finding_ids : [],
    scope_snapshot: report.scope_snapshot ?? '',
    generated_markdown: report.generated_markdown ?? '',
    created_at: report.created_at?.toISOString?.() ?? new Date(report.created_at).toISOString(),
    updated_at: report.updated_at?.toISOString?.() ?? new Date(report.updated_at).toISOString(),
  };
}

export function serializeSecurityOastSession(session) {
  return {
    id: session.id,
    project_id: session.project_id,
    label: session.label ?? '',
    token: session.token,
    callback_url: session.callback_url ?? '',
    hit_count: Number(session.hit_count ?? 0),
    last_hit_at: session.last_hit_at?.toISOString?.() ?? (session.last_hit_at ? new Date(session.last_hit_at).toISOString() : null),
    hits: Array.isArray(session.hits) ? session.hits.map((hit) => ({
      method: hit.method ?? 'GET',
      path: hit.path ?? '',
      query: hit.query ?? '',
      headers: hit.headers ?? {},
      body_preview: hit.body_preview ?? '',
      ip: hit.ip ?? '',
      created_at: hit.created_at?.toISOString?.() ?? new Date(hit.created_at).toISOString(),
    })) : [],
    created_at: session.created_at?.toISOString?.() ?? new Date(session.created_at).toISOString(),
    updated_at: session.updated_at?.toISOString?.() ?? new Date(session.updated_at).toISOString(),
  };
}

export function serializeTrafficCapture(capture, options = {}) {
  const includeEntries = options.includeEntries === true;
  const entryLimit = Math.max(1, Math.min(Number(options.entryLimit ?? 200), 500));

  return {
    id: capture.id,
    project_id: capture.project_id,
    name: capture.name,
    source: capture.source ?? 'har',
    request_count: Number(capture.request_count ?? 0),
    hosts: Array.isArray(capture.hosts) ? capture.hosts : [],
    endpoints: Array.isArray(capture.endpoints) ? capture.endpoints : [],
    summary: capture.summary ?? '',
    raw_excerpt: capture.raw_excerpt ?? '',
    entries: includeEntries
      ? (Array.isArray(capture.entries) ? capture.entries.slice(0, entryLimit) : []).map((entry) => ({
        id: entry.id,
        order: Number(entry.order ?? 0),
        started_at: entry.started_at?.toISOString?.() ?? (entry.started_at ? new Date(entry.started_at).toISOString() : null),
        time_ms: Number(entry.time_ms ?? 0),
        method: entry.method ?? 'GET',
        url: entry.url ?? '',
        host: entry.host ?? '',
        path: entry.path ?? '',
        query: entry.query ?? '',
        http_version: entry.http_version ?? '',
        headers: Array.isArray(entry.headers) ? entry.headers.map((pair) => ({ name: pair.name ?? '', value: pair.value ?? '' })) : [],
        cookies: Array.isArray(entry.cookies) ? entry.cookies.map((pair) => ({ name: pair.name ?? '', value: pair.value ?? '' })) : [],
        request_body_mime_type: entry.request_body_mime_type ?? '',
        request_body_text: entry.request_body_text ?? '',
        request_body_base64: entry.request_body_base64 ?? '',
        response_status: Number(entry.response_status ?? 0),
        response_status_text: entry.response_status_text ?? '',
        response_headers: Array.isArray(entry.response_headers) ? entry.response_headers.map((pair) => ({ name: pair.name ?? '', value: pair.value ?? '' })) : [],
        response_content_type: entry.response_content_type ?? '',
        response_body_preview: entry.response_body_preview ?? '',
        fetch_template: entry.fetch_template ?? '',
        curl_template: entry.curl_template ?? '',
        notes: Array.isArray(entry.notes) ? entry.notes : [],
      }))
      : undefined,
    created_at: capture.created_at?.toISOString?.() ?? new Date(capture.created_at).toISOString(),
    updated_at: capture.updated_at?.toISOString?.() ?? new Date(capture.updated_at).toISOString(),
  };
}
