import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { handleAIStream } from './lib/ai.js';
import { authResponse, isAuthDisabled, optionalAuth, requireAdmin, requireAuth } from './lib/auth.js';
import { connectToDatabase } from './lib/db.js';
import {
  Conversation,
  CreditTransaction,
  Message,
  Project,
  ProjectCheckpoint,
  ProjectDoc,
  ProjectFile,
  ProjectSecret,
  ProjectSecurityProfile,
  ProjectTask,
  SecurityCustomCheck,
  SecurityFinding,
  SecurityOastSession,
  SecurityReport,
  TrafficCapture,
  User,
  nextSequence,
  serializeConversation,
  serializeProjectSecurityProfile,
  serializeProjectCheckpoint,
  serializeFile,
  serializeMessage,
  serializeProject,
  serializeProjectDoc,
  serializeProjectTask,
  serializeSecurityCustomCheck,
  serializeSecurityFinding,
  serializeSecurityOastSession,
  serializeSecurityReport,
  serializeTrafficCapture,
  serializeUser,
} from './lib/models.js';
import { decryptSecret, encryptSecret } from './lib/secrets.js';
import { importProjectConnectorDoc } from './lib/connectors.js';
import { ensureProjectMemoryDoc } from './lib/project-intel.js';
import {
  analyzeProjectReverseEngineering,
  buildTrafficCaptureDetail,
  buildTrafficFlowGraph,
  buildAttackSurfaceSummary,
  createSecurityOastSession,
  createSecurityReport,
  ensureProjectSecurityProfile,
  importTrafficCapture,
  mutateTrafficCaptureEntry,
  loadProjectSecurityContext,
  normalizeAuthProfiles,
  normalizeContinuousScans,
  normalizeCustomCheckPayload,
  normalizeFindingStatus,
  normalizeSecurityScope,
  normalizeSecuritySeverity,
  persistSecurityFindings,
  replayTrafficCaptureFlow,
  replayTrafficCaptureEntry,
  recordOastHit,
  runSecurityScan,
  summarizeApiSpecs,
} from './lib/security.js';
import {
  getRunnerClientConfig,
  getSettings,
  getRunnerConfig,
  runnerHealthCheck,
  runnerRequest,
  saveRunnerConfig,
  upsertSettings,
} from './lib/runner.js';
import { syncProjectFilesToRunner, syncRunnerWorkspaceToProject } from './lib/project-sync.js';
import {
  applyTaskFilesToProject,
  buildTaskReview,
  buildTaskWorkspaceKey,
  getOwnedTask,
  listTaskFiles,
  normalizeAcceptanceCriteria,
  seedTaskFilesFromProject,
  touchTask,
} from './lib/tasks.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');

app.use(cors({
  origin: true,
  credentials: false,
}));
app.use(express.json({ limit: '20mb' }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseNumericId(value) {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

async function getOwnedProject(projectId, userId) {
  if (isAuthDisabled()) {
    return Project.findOne({ id: projectId });
  }
  return Project.findOne({ id: projectId, user_id: userId });
}

function getPlatformSettingsWithEnvFallback(settings = {}) {
  const vertexEnv = process.env.VERTEX_API_KEY || process.env.GOOGLE_VERTEX_API_KEY || '';
  const geminiEnv = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const anthropicEnv = process.env.ANTHROPIC_API_KEY || '';
  const openaiEnv = process.env.OPENAI_API_KEY || '';
  const kimiEnv = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';

  return {
    provider: settings.provider || process.env.DEFAULT_AI_PROVIDER || (vertexEnv ? 'vertex' : 'gemini'),
    model: settings.model || process.env.DEFAULT_AI_MODEL || (vertexEnv ? 'gemini-2.5-pro' : 'gemini-2.5-flash'),
    gemini_key: settings.gemini_key || geminiEnv,
    anthropic_key: settings.anthropic_key || anthropicEnv,
    openai_key: settings.openai_key || openaiEnv,
    vertex_key: settings.vertex_key || vertexEnv,
    kimi_key: settings.kimi_key || kimiEnv,
  };
}

async function touchProject(projectId) {
  await Project.updateOne({ id: projectId }, { updated_at: new Date() });
}

async function getOwnedConversation(conversationId, userId) {
  const conversation = await Conversation.findOne({ id: conversationId });
  if (!conversation) return null;
  const project = await getOwnedProject(conversation.project_id, userId);
  return project ? conversation : null;
}

async function getOwnedDoc(docId, userId) {
  const doc = await ProjectDoc.findOne({ id: docId });
  if (!doc) return null;
  const project = await getOwnedProject(doc.project_id, userId);
  return project ? doc : null;
}

async function getOwnedCheckpoint(checkpointId, projectId, userId) {
  const checkpoint = await ProjectCheckpoint.findOne({ id: checkpointId, project_id: projectId, user_id: userId });
  if (!checkpoint) return null;
  const project = await getOwnedProject(projectId, userId);
  return project ? checkpoint : null;
}

async function getOwnedSecurityFinding(findingId, projectId, userId) {
  return SecurityFinding.findOne({ id: findingId, project_id: projectId, user_id: userId });
}

async function getOwnedSecurityCheck(checkId, projectId, userId) {
  return SecurityCustomCheck.findOne({ id: checkId, project_id: projectId, user_id: userId });
}

async function getOwnedTrafficCapture(captureId, projectId, userId) {
  return TrafficCapture.findOne({ id: captureId, project_id: projectId, user_id: userId });
}

function inferBaseUrl(req) {
  const protocol = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] ?? req.get('host') ?? '').split(',')[0].trim();
  return host ? `${protocol}://${host}` : '';
}

function buildRunnerPayload(projectId, body = {}) {
  const payload = { ...body };
  delete payload.projectId;
  return {
    ...payload,
    projectId: String(projectId),
  };
}

async function runnerJsonForProject(projectId, endpoint, body = {}, timeoutMs = 30000, init = {}) {
  const response = await runnerRequest(endpoint, buildRunnerPayload(projectId, body), timeoutMs, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Runner ${endpoint} failed (${response.status})${text ? `: ${text}` : ''}`);
  }
  return response.json();
}

async function streamRunnerForProject(req, res, projectId, endpoint, body = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const response = await runnerRequest(
    endpoint,
    buildRunnerPayload(projectId, body),
    timeoutMs,
    { signal: controller.signal },
  );

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    res.status(response.status).json({ error: text || `Runner ${endpoint} failed (${response.status})` });
    return;
  }

  res.status(response.status);
  res.setHeader('Content-Type', response.headers.get('content-type') ?? 'text/event-stream');
  res.setHeader('Cache-Control', response.headers.get('cache-control') ?? 'no-cache');
  res.setHeader('Connection', response.headers.get('connection') ?? 'keep-alive');

  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
}

async function createProjectCheckpointSnapshot(projectId, userId, reason = '') {
  const files = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
  const checkpoint = await ProjectCheckpoint.create({
    id: await nextSequence('project_checkpoints'),
    project_id: projectId,
    user_id: userId,
    reason,
    files: files.map((file) => ({
      path: file.path,
      name: file.name,
      language: file.language ?? 'plaintext',
      content: file.content ?? '',
    })),
  });
  return checkpoint;
}

async function restoreProjectCheckpointSnapshot(projectId, checkpoint) {
  const snapshotFiles = Array.isArray(checkpoint.files) ? checkpoint.files : [];
  const currentFiles = await ProjectFile.find({ project_id: projectId });
  const snapshotByPath = new Map(snapshotFiles.map((file) => [file.path, file]));

  await Promise.all(currentFiles.map(async (file) => {
    const snapshotFile = snapshotByPath.get(file.path);
    if (!snapshotFile) {
      await ProjectFile.deleteOne({ _id: file._id });
      return;
    }

    file.name = snapshotFile.name;
    file.language = snapshotFile.language ?? 'plaintext';
    file.content = snapshotFile.content ?? '';
    file.updated_at = new Date();
    await file.save();
    snapshotByPath.delete(file.path);
  }));

  for (const snapshotFile of snapshotByPath.values()) {
    await ProjectFile.create({
      id: await nextSequence('project_files'),
      project_id: projectId,
      name: snapshotFile.name,
      path: snapshotFile.path,
      content: snapshotFile.content ?? '',
      language: snapshotFile.language ?? 'plaintext',
    });
  }

  await touchProject(projectId);
}

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function inferRepoProvider(repoUrl = '') {
  const normalized = String(repoUrl ?? '').toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('github.com')) return 'github';
  if (normalized.includes('gitlab.com')) return 'gitlab';
  if (normalized.includes('bitbucket.org')) return 'bitbucket';
  return 'git';
}

function normalizeRepoUrl(repoUrl = '') {
  const trimmed = String(repoUrl ?? '').trim();
  if (!trimmed) return '';
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/i.test(trimmed) && !trimmed.includes('://') && !trimmed.startsWith('git@')) {
    return `https://github.com/${trimmed.replace(/\.git$/i, '')}.git`;
  }
  return trimmed;
}

async function getProjectSecretMap(projectId, userId) {
  const secretDoc = await ProjectSecret.findOne({ project_id: projectId, user_id: userId });
  const map = {};
  for (const secret of secretDoc?.secrets ?? []) {
    const key = String(secret.key ?? '').trim().toUpperCase();
    if (!key) continue;
    map[key] = decryptSecret(secret.value);
  }
  return map;
}

async function runRunnerShellCommand(projectId, command, options = {}) {
  const timeout = Math.max(1000, Number(options.timeout ?? 30000));
  return runnerJsonForProject(projectId, '/run', {
    command,
    cwd: options.cwd,
    timeout,
  }, timeout + 5000);
}

async function prepareGitAuth(projectId, userId, repoUrl) {
  const normalizedRepoUrl = String(repoUrl ?? '').trim();
  const secretMap = await getProjectSecretMap(projectId, userId);
  const settings = await getSettings(['github_token', 'ssh_private_key', 'ssh_passphrase']);
  const tempPaths = [];
  let prefix = '';
  let authMode = 'none';

  if (/^git@|^ssh:\/\//i.test(normalizedRepoUrl)) {
    const sshPrivateKey = String(secretMap.SSH_PRIVATE_KEY || settings.ssh_private_key || '').trim();
    if (sshPrivateKey) {
      const keyPath = '.luxi/git-ssh-key';
      await runnerJsonForProject(projectId, '/write', {
        filePath: keyPath,
        content: `${sshPrivateKey.endsWith('\n') ? sshPrivateKey : `${sshPrivateKey}\n`}`,
      }, 30000);
      await runRunnerShellCommand(projectId, `mkdir -p .luxi && chmod 700 .luxi && chmod 600 ${shellQuote(keyPath)}`, { timeout: 15000 });
      tempPaths.push(keyPath);
      prefix = `GIT_SSH_COMMAND=${shellQuote(`ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`)}`;
      authMode = 'ssh';
    }
  } else if (/github\.com/i.test(normalizedRepoUrl)) {
    const githubToken = String(secretMap.GITHUB_TOKEN || secretMap.GH_TOKEN || settings.github_token || '').trim();
    if (githubToken) {
      const askpassPath = '.luxi/git-askpass.sh';
      const askpassScript = `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' "x-access-token" ;;
  *) printf '%s\\n' ${shellQuote(githubToken)} ;;
esac
`;
      await runnerJsonForProject(projectId, '/write', {
        filePath: askpassPath,
        content: askpassScript,
      }, 30000);
      await runRunnerShellCommand(projectId, `mkdir -p .luxi && chmod 700 .luxi && chmod 700 ${shellQuote(askpassPath)}`, { timeout: 15000 });
      tempPaths.push(askpassPath);
      prefix = `GIT_ASKPASS=${shellQuote(askpassPath)} GIT_TERMINAL_PROMPT=0`;
      authMode = 'token';
    }
  }

  return {
    prefix,
    authMode,
    async cleanup() {
      if (tempPaths.length === 0) return;
      try {
        await runRunnerShellCommand(projectId, `rm -f ${tempPaths.map((entry) => shellQuote(entry)).join(' ')}`, { timeout: 15000 });
      } catch {}
    },
  };
}

async function runGitCommand(projectId, userId, repoUrl, command, options = {}) {
  const auth = await prepareGitAuth(projectId, userId, repoUrl);
  const prefixedCommand = auth.prefix ? `${auth.prefix} ${command}` : command;
  try {
    return await runRunnerShellCommand(projectId, prefixedCommand, options);
  } finally {
    await auth.cleanup();
  }
}

function parseGitStatusOutput(output) {
  const status = {
    branch: '',
    upstream: '',
    ahead: 0,
    behind: 0,
    clean: true,
    changes: [],
  };

  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      status.branch = line.slice('# branch.head '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/# branch\.ab \+(\d+) \-(\d+)/);
      if (match) {
        status.ahead = Number(match[1] ?? 0);
        status.behind = Number(match[2] ?? 0);
      }
      continue;
    }
    status.clean = false;
    status.changes.push(line);
  }

  return status;
}

async function getProjectGitState(projectId) {
  const isGitRepo = await runRunnerShellCommand(projectId, 'git rev-parse --is-inside-work-tree', { timeout: 15000 });
  if (isGitRepo.exitCode !== 0 || !String(isGitRepo.stdout ?? '').trim().includes('true')) {
    return {
      connected: false,
      branch: '',
      upstream: '',
      ahead: 0,
      behind: 0,
      clean: true,
      changes: [],
      remoteUrl: '',
      lastCommitHash: '',
      lastCommitMessage: '',
      lastCommitAt: '',
    };
  }

  const [statusResult, remoteResult, commitResult] = await Promise.all([
    runRunnerShellCommand(projectId, 'git status --porcelain=2 --branch', { timeout: 15000 }),
    runRunnerShellCommand(projectId, 'git remote get-url origin', { timeout: 15000 }),
    runRunnerShellCommand(projectId, 'git log -1 --pretty=format:%H%n%s%n%aI', { timeout: 15000 }),
  ]);

  const parsedStatus = parseGitStatusOutput(statusResult.stdout);
  const commitLines = String(commitResult.stdout ?? '').split('\n');
  return {
    connected: true,
    ...parsedStatus,
    remoteUrl: String(remoteResult.stdout ?? '').trim(),
    lastCommitHash: String(commitLines[0] ?? '').trim(),
    lastCommitMessage: String(commitLines[1] ?? '').trim(),
    lastCommitAt: String(commitLines[2] ?? '').trim(),
  };
}

async function persistProjectGitMetadata(project, gitState = {}, overrides = {}) {
  if (gitState.remoteUrl !== undefined) {
    project.repo_url = gitState.remoteUrl || project.repo_url || '';
  }
  if (gitState.branch !== undefined) {
    project.repo_branch = gitState.branch || project.repo_branch || '';
  }
  if (project.repo_url || gitState.remoteUrl) {
    project.repo_provider = inferRepoProvider(gitState.remoteUrl || project.repo_url);
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'repo_connected_at')) {
    project.repo_connected_at = overrides.repo_connected_at;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'repo_last_sync_at')) {
    project.repo_last_sync_at = overrides.repo_last_sync_at;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'repo_last_error')) {
    project.repo_last_error = overrides.repo_last_error;
  }
  project.updated_at = new Date();
  await project.save();
  return project;
}

function buildGitResponse(project, gitState, extra = {}) {
  const repoUrl = project.repo_url || gitState?.remoteUrl || '';
  const repoBranch = project.repo_branch || gitState?.branch || '';
  return {
    connected: !!gitState?.connected,
    repo_url: repoUrl,
    repo_provider: project.repo_provider || inferRepoProvider(repoUrl),
    repo_branch: repoBranch,
    repo_connected_at: project.repo_connected_at?.toISOString?.() ?? (project.repo_connected_at ? new Date(project.repo_connected_at).toISOString() : null),
    repo_last_sync_at: project.repo_last_sync_at?.toISOString?.() ?? (project.repo_last_sync_at ? new Date(project.repo_last_sync_at).toISOString() : null),
    repo_last_error: project.repo_last_error ?? '',
    status: gitState,
    ...extra,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  if (isAuthDisabled()) {
    res.status(403).json({ error: 'Authentication is disabled in this deployment.' });
    return;
  }
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  const displayName = String(req.body.displayName ?? '').trim();

  if (!email || !password || !displayName) {
    res.status(400).json({ error: 'Email, password, and display name are required' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const isFirstUser = (await User.countDocuments()) === 0;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    email,
    password_hash: passwordHash,
    display_name: displayName,
    is_admin: isFirstUser,
    subscription_tier: isFirstUser ? 'unlimited' : 'free',
    credit_balance: isFirstUser ? 999999 : 10,
  });

  res.status(201).json(authResponse(user));
}));

app.post('/api/auth/signin', asyncRoute(async (req, res) => {
  if (isAuthDisabled()) {
    res.status(403).json({ error: 'Authentication is disabled in this deployment.' });
    return;
  }
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);
  if (!passwordValid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  res.json(authResponse(user));
}));

app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: serializeUser(req.user), auth_disabled: isAuthDisabled() });
}));

app.get('/api/projects', requireAuth, asyncRoute(async (req, res) => {
  const projects = isAuthDisabled()
    ? await Project.find().sort({ updated_at: -1 })
    : await Project.find({ user_id: req.user._id }).sort({ updated_at: -1 });
  res.json(projects.map(serializeProject));
}));

app.post('/api/projects', requireAuth, asyncRoute(async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const description = String(req.body.description ?? '').trim();
  const language = String(req.body.language ?? 'typescript').trim();

  if (!name) {
    res.status(400).json({ error: 'Project name is required' });
    return;
  }

  const project = await Project.create({
    id: await nextSequence('projects'),
    user_id: req.user._id,
    name,
    description,
    language,
  });

  res.status(201).json(serializeProject(project));
}));

app.get('/api/projects/:id', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(serializeProject(project));
}));

app.delete('/api/projects/:id', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const conversations = await Conversation.find({ project_id: projectId }).select({ id: 1 });
  const conversationIds = conversations.map((conversation) => conversation.id);

  await Promise.all([
    Project.deleteOne({ _id: project._id }),
    ProjectFile.deleteMany({ project_id: projectId }),
    Conversation.deleteMany({ project_id: projectId }),
    ProjectDoc.deleteMany({ project_id: projectId }),
    ProjectSecret.deleteMany({ project_id: projectId }),
    conversationIds.length > 0 ? Message.deleteMany({ conversation_id: { $in: conversationIds } }) : Promise.resolve(),
  ]);

  res.status(204).end();
}));

app.get('/api/projects/:id/files', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const files = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
  res.json(files.map(serializeFile));
}));

app.post('/api/projects/:id/files', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const payload = {
    name: String(req.body.name ?? '').trim(),
    path: String(req.body.path ?? '').trim(),
    content: String(req.body.content ?? ''),
    language: String(req.body.language ?? 'plaintext').trim(),
  };

  if (!payload.name || !payload.path) {
    res.status(400).json({ error: 'File name and path are required' });
    return;
  }

  const existing = await ProjectFile.findOne({ project_id: projectId, path: payload.path });
  if (existing) {
    res.status(409).json({ error: 'A file with this path already exists' });
    return;
  }

  const file = await ProjectFile.create({
    id: await nextSequence('project_files'),
    project_id: projectId,
    ...payload,
  });
  await touchProject(projectId);

  res.status(201).json(serializeFile(file));
}));

app.patch('/api/projects/:id/files/:fileId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const fileId = parseNumericId(req.params.fileId);
  if (projectId === null || fileId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const file = await ProjectFile.findOne({ id: fileId, project_id: projectId });
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  if (req.body.name !== undefined) file.name = String(req.body.name);
  if (req.body.path !== undefined) file.path = String(req.body.path);
  if (req.body.content !== undefined) file.content = String(req.body.content);
  if (req.body.language !== undefined) file.language = String(req.body.language);
  file.updated_at = new Date();
  await file.save();
  await touchProject(projectId);

  res.json(serializeFile(file));
}));

app.delete('/api/projects/:id/files/:fileId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const fileId = parseNumericId(req.params.fileId);
  if (projectId === null || fileId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  await ProjectFile.deleteOne({ id: fileId, project_id: projectId });
  await touchProject(projectId);
  res.status(204).end();
}));

app.get('/api/projects/:id/conversations', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const conversations = await Conversation.find({ project_id: projectId }).sort({ created_at: -1 });
  res.json(conversations.map(serializeConversation));
}));

app.post('/api/projects/:id/conversations', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const title = String(req.body.title ?? 'Chat').trim() || 'Chat';
  const conversation = await Conversation.create({
    id: await nextSequence('conversations'),
    project_id: projectId,
    title,
  });
  await touchProject(projectId);
  res.status(201).json(serializeConversation(conversation));
}));

app.get('/api/conversations/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const conversationId = parseNumericId(req.params.id);
  if (conversationId === null) {
    res.status(400).json({ error: 'Invalid conversation id' });
    return;
  }
  const conversation = await getOwnedConversation(conversationId, req.user._id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  const messages = await Message.find({ conversation_id: conversationId }).sort({ created_at: 1 });
  res.json(messages.map(serializeMessage));
}));

app.post('/api/conversations/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const conversationId = parseNumericId(req.params.id);
  if (conversationId === null) {
    res.status(400).json({ error: 'Invalid conversation id' });
    return;
  }
  const conversation = await getOwnedConversation(conversationId, req.user._id);
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const role = String(req.body.role ?? '').trim();
  const content = String(req.body.content ?? '');
  if (!role) {
    res.status(400).json({ error: 'Message role is required' });
    return;
  }

  const message = await Message.create({
    id: await nextSequence('messages'),
    conversation_id: conversationId,
    role,
    content,
  });
  await touchProject(conversation.project_id);
  res.status(201).json(serializeMessage(message));
}));

app.get('/api/projects/:id/docs', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const docs = await ProjectDoc.find({ project_id: projectId }).sort({ created_at: 1 });
  res.json(docs.map(serializeProjectDoc));
}));

app.post('/api/projects/:id/docs', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const title = String(req.body.title ?? '').trim();
  const content = String(req.body.content ?? '');
  if (!title) {
    res.status(400).json({ error: 'Doc title is required' });
    return;
  }
  const doc = await ProjectDoc.create({
    id: await nextSequence('project_docs'),
    project_id: projectId,
    title,
    content,
    source_type: 'manual',
    source_ref: '',
    updated_at: new Date(),
  });
  await touchProject(projectId);
  res.status(201).json(serializeProjectDoc(doc));
}));

app.post('/api/projects/:id/docs/import', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const imported = await importProjectConnectorDoc({
    sourceType: req.body.sourceType,
    url: req.body.url,
    title: req.body.title,
    token: req.body.token,
    projectSecrets: await getProjectSecretMap(projectId, req.user._id),
  });

  let doc = await ProjectDoc.findOne({
    project_id: projectId,
    source_type: imported.sourceType,
    source_ref: imported.sourceRef,
  });

  if (doc) {
    doc.title = imported.title;
    doc.content = imported.content;
    doc.updated_at = new Date();
    await doc.save();
  } else {
    doc = await ProjectDoc.create({
      id: await nextSequence('project_docs'),
      project_id: projectId,
      title: imported.title,
      content: imported.content,
      source_type: imported.sourceType,
      source_ref: imported.sourceRef,
      updated_at: new Date(),
    });
  }

  await touchProject(projectId);
  res.status(201).json(serializeProjectDoc(doc));
}));

app.patch('/api/docs/:id', requireAuth, asyncRoute(async (req, res) => {
  const docId = parseNumericId(req.params.id);
  if (docId === null) {
    res.status(400).json({ error: 'Invalid doc id' });
    return;
  }
  const doc = await getOwnedDoc(docId, req.user._id);
  if (!doc) {
    res.status(404).json({ error: 'Doc not found' });
    return;
  }
  if (req.body.title !== undefined) doc.title = String(req.body.title);
  if (req.body.content !== undefined) doc.content = String(req.body.content);
  doc.updated_at = new Date();
  await doc.save();
  await touchProject(doc.project_id);
  res.json(serializeProjectDoc(doc));
}));

app.delete('/api/docs/:id', requireAuth, asyncRoute(async (req, res) => {
  const docId = parseNumericId(req.params.id);
  if (docId === null) {
    res.status(400).json({ error: 'Invalid doc id' });
    return;
  }
  const doc = await getOwnedDoc(docId, req.user._id);
  if (!doc) {
    res.status(404).json({ error: 'Doc not found' });
    return;
  }
  await ProjectDoc.deleteOne({ _id: doc._id });
  await touchProject(doc.project_id);
  res.status(204).end();
}));

app.get('/api/projects/:id/memory', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const [files, docs] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }).then((rows) => rows.map(serializeFile)),
    ProjectDoc.find({ project_id: projectId }).sort({ created_at: 1 }),
  ]);
  const memoryDoc = await ensureProjectMemoryDoc(project, files, docs);
  res.json(serializeProjectDoc(memoryDoc));
}));

app.post('/api/projects/:id/memory/refresh', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const [files, docs] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }).then((rows) => rows.map(serializeFile)),
    ProjectDoc.find({ project_id: projectId }).sort({ created_at: 1 }),
  ]);
  const memoryDoc = await ensureProjectMemoryDoc(project, files, docs);
  res.json(serializeProjectDoc(memoryDoc));
}));

app.all('/api/oast/:token', asyncRoute(async (req, res) => {
  const token = String(req.params.token ?? '').trim();
  if (!token) {
    res.status(400).json({ error: 'Invalid token' });
    return;
  }

  const payload = typeof req.body === 'string'
    ? req.body
    : req.body && Object.keys(req.body).length > 0
      ? JSON.stringify(req.body)
      : '';

  const session = await recordOastHit(token, {
    method: req.method,
    path: req.path,
    query: JSON.stringify(req.query ?? {}),
    headers: req.headers,
    body_preview: String(payload ?? '').slice(0, 4000),
    ip: req.ip,
  });

  if (!session) {
    res.status(404).json({ error: 'OAST token not found' });
    return;
  }

  res.status(204).end();
}));

app.get('/api/projects/:id/security/context', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const context = await loadProjectSecurityContext(projectId, req.user._id);
  res.json(context);
}));

app.get('/api/projects/:id/security/profile', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const profile = await ensureProjectSecurityProfile(projectId, req.user._id);
  res.json(serializeProjectSecurityProfile(profile));
}));

app.put('/api/projects/:id/security/profile', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const profile = await ensureProjectSecurityProfile(projectId, req.user._id);
  profile.scope = normalizeSecurityScope(req.body.scope ?? {});
  profile.auth_profiles = normalizeAuthProfiles(req.body.auth_profiles ?? req.body.authProfiles);
  profile.continuous_scans = normalizeContinuousScans(req.body.continuous_scans ?? req.body.continuousScans);
  profile.updated_at = new Date();
  await profile.save();
  await touchProject(projectId);
  res.json(serializeProjectSecurityProfile(profile));
}));

app.get('/api/projects/:id/security/checks', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const checks = await SecurityCustomCheck.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 });
  res.json(checks.map(serializeSecurityCustomCheck));
}));

app.post('/api/projects/:id/security/checks', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const payload = normalizeCustomCheckPayload(req.body);
  if (!payload.name) {
    res.status(400).json({ error: 'Check name is required' });
    return;
  }

  const check = await SecurityCustomCheck.create({
    id: await nextSequence('security_custom_checks'),
    project_id: projectId,
    user_id: req.user._id,
    ...payload,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await touchProject(projectId);
  res.status(201).json(serializeSecurityCustomCheck(check));
}));

app.patch('/api/projects/:id/security/checks/:checkId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const checkId = parseNumericId(req.params.checkId);
  if (projectId === null || checkId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const check = await getOwnedSecurityCheck(checkId, projectId, req.user._id);
  if (!check) {
    res.status(404).json({ error: 'Check not found' });
    return;
  }

  Object.assign(check, normalizeCustomCheckPayload({
    ...serializeSecurityCustomCheck(check),
    ...req.body,
  }), { updated_at: new Date() });
  await check.save();
  await touchProject(projectId);
  res.json(serializeSecurityCustomCheck(check));
}));

app.delete('/api/projects/:id/security/checks/:checkId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const checkId = parseNumericId(req.params.checkId);
  if (projectId === null || checkId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const check = await getOwnedSecurityCheck(checkId, projectId, req.user._id);
  if (!check) {
    res.status(404).json({ error: 'Check not found' });
    return;
  }

  await SecurityCustomCheck.deleteOne({ _id: check._id });
  await touchProject(projectId);
  res.status(204).end();
}));

app.post('/api/projects/:id/security/scan', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const [files, docs, checks, trafficCaptures, profile] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }).then((rows) => rows.map(serializeFile)),
    ProjectDoc.find({ project_id: projectId }).sort({ created_at: 1 }),
    SecurityCustomCheck.find({ project_id: projectId, user_id: req.user._id, enabled: true }).sort({ updated_at: -1 }),
    TrafficCapture.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(10),
    ensureProjectSecurityProfile(projectId, req.user._id),
  ]);

  const scanResult = await runSecurityScan(project, files, docs, {
    customChecks: checks.map(serializeSecurityCustomCheck),
    trafficCaptures: trafficCaptures.map(serializeTrafficCapture),
  });
  const persist = req.body.persist !== false;
  const persisted = persist
    ? await persistSecurityFindings(projectId, req.user._id, scanResult.findings, {
      source: 'scan',
      taskId: req.body.taskId,
    })
    : [];

  const continuousScanId = String(req.body.continuous_scan_id ?? req.body.continuousScanId ?? '').trim();
  if (continuousScanId && Array.isArray(profile.continuous_scans)) {
    profile.continuous_scans = profile.continuous_scans.map((entry) => (
      entry.id === continuousScanId
        ? { ...entry, last_run_at: new Date() }
        : entry
    ));
    profile.updated_at = new Date();
    await profile.save();
  }

  res.json({
    ...scanResult,
    profile: serializeProjectSecurityProfile(profile),
    persisted_findings: persisted,
  });
}));

app.get('/api/projects/:id/security/reverse-engineering', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const [files, docs, trafficCaptures] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }).then((rows) => rows.map(serializeFile)),
    ProjectDoc.find({ project_id: projectId }).sort({ created_at: 1 }),
    TrafficCapture.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(10),
  ]);

  res.json(analyzeProjectReverseEngineering(project, files, docs, trafficCaptures));
}));

app.get('/api/projects/:id/findings', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const findings = await SecurityFinding.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(200);
  res.json(findings.map(serializeSecurityFinding));
}));

app.post('/api/projects/:id/findings', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const title = String(req.body.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: 'Finding title is required' });
    return;
  }

  const persisted = await persistSecurityFindings(projectId, req.user._id, [{
    title,
    category: String(req.body.category ?? 'security').trim(),
    severity: normalizeSecuritySeverity(req.body.severity),
    status: normalizeFindingStatus(req.body.status),
    summary: String(req.body.summary ?? '').trim(),
    impact: String(req.body.impact ?? '').trim(),
    recommendation: String(req.body.recommendation ?? '').trim(),
    affected_paths: req.body.affected_paths ?? req.body.affectedPaths,
    affected_urls: req.body.affected_urls ?? req.body.affectedUrls,
    standards: req.body.standards,
    tags: req.body.tags,
    evidence: Array.isArray(req.body.evidence) ? req.body.evidence : [],
    reproduction_steps: req.body.reproduction_steps ?? req.body.reproductionSteps,
    regression_check: String(req.body.regression_check ?? req.body.regressionCheck ?? '').trim(),
    fix_validation: String(req.body.fix_validation ?? req.body.fixValidation ?? '').trim(),
    triage_owner: String(req.body.triage_owner ?? req.body.triageOwner ?? '').trim(),
    source: String(req.body.source ?? 'manual').trim() || 'manual',
    dedupe_key: String(req.body.dedupe_key ?? req.body.dedupeKey ?? '').trim(),
    task_id: Number.isFinite(Number(req.body.task_id ?? req.body.taskId)) ? Number(req.body.task_id ?? req.body.taskId) : null,
  }], {
    source: 'manual',
    taskId: req.body.task_id ?? req.body.taskId,
  });

  await touchProject(projectId);
  res.status(201).json(persisted[0]);
}));

app.patch('/api/projects/:id/findings/:findingId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const findingId = parseNumericId(req.params.findingId);
  if (projectId === null || findingId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const finding = await getOwnedSecurityFinding(findingId, projectId, req.user._id);
  if (!finding) {
    res.status(404).json({ error: 'Finding not found' });
    return;
  }

  if (req.body.title !== undefined) finding.title = String(req.body.title).trim();
  if (req.body.category !== undefined) finding.category = String(req.body.category).trim();
  if (req.body.severity !== undefined) finding.severity = normalizeSecuritySeverity(req.body.severity);
  if (req.body.status !== undefined) {
    finding.status = normalizeFindingStatus(req.body.status);
    if (finding.status === 'fixed' && !finding.fixed_at) finding.fixed_at = new Date();
  }
  if (req.body.summary !== undefined) finding.summary = String(req.body.summary).trim();
  if (req.body.impact !== undefined) finding.impact = String(req.body.impact).trim();
  if (req.body.recommendation !== undefined) finding.recommendation = String(req.body.recommendation).trim();
  if (req.body.affected_paths !== undefined || req.body.affectedPaths !== undefined) {
    finding.affected_paths = Array.isArray(req.body.affected_paths ?? req.body.affectedPaths)
      ? req.body.affected_paths ?? req.body.affectedPaths
      : String(req.body.affected_paths ?? req.body.affectedPaths ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
  if (req.body.affected_urls !== undefined || req.body.affectedUrls !== undefined) {
    finding.affected_urls = Array.isArray(req.body.affected_urls ?? req.body.affectedUrls)
      ? req.body.affected_urls ?? req.body.affectedUrls
      : String(req.body.affected_urls ?? req.body.affectedUrls ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
  if (req.body.standards !== undefined) finding.standards = Array.isArray(req.body.standards) ? req.body.standards : String(req.body.standards ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean);
  if (req.body.tags !== undefined) finding.tags = Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean);
  if (req.body.evidence !== undefined) finding.evidence = Array.isArray(req.body.evidence) ? req.body.evidence : [];
  if (req.body.reproduction_steps !== undefined || req.body.reproductionSteps !== undefined) {
    finding.reproduction_steps = Array.isArray(req.body.reproduction_steps ?? req.body.reproductionSteps)
      ? req.body.reproduction_steps ?? req.body.reproductionSteps
      : String(req.body.reproduction_steps ?? req.body.reproductionSteps ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
  if (req.body.regression_check !== undefined || req.body.regressionCheck !== undefined) {
    finding.regression_check = String(req.body.regression_check ?? req.body.regressionCheck ?? '').trim();
  }
  if (req.body.fix_validation !== undefined || req.body.fixValidation !== undefined) {
    finding.fix_validation = String(req.body.fix_validation ?? req.body.fixValidation ?? '').trim();
  }
  if (req.body.triage_owner !== undefined || req.body.triageOwner !== undefined) {
    finding.triage_owner = String(req.body.triage_owner ?? req.body.triageOwner ?? '').trim();
  }
  finding.updated_at = new Date();
  await finding.save();
  await touchProject(projectId);
  res.json(serializeSecurityFinding(finding));
}));

app.get('/api/projects/:id/reports', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const reports = await SecurityReport.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(50);
  res.json(reports.map(serializeSecurityReport));
}));

app.post('/api/projects/:id/reports/generate', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const [files, docs, trafficCaptures] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }).then((rows) => rows.map(serializeFile)),
    ProjectDoc.find({ project_id: projectId }).sort({ created_at: 1 }),
    TrafficCapture.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(10).then((rows) => rows.map(serializeTrafficCapture)),
  ]);
  const report = await createSecurityReport(project, req.user._id, {
    title: req.body.title,
    summary: req.body.summary,
    status: req.body.status,
    finding_ids: req.body.finding_ids ?? req.body.findingIds,
    attack_surface: buildAttackSurfaceSummary(project, files, docs, trafficCaptures),
    api_specs: summarizeApiSpecs(files, docs),
    traffic_captures: trafficCaptures,
  });
  await touchProject(projectId);
  res.status(201).json(report);
}));

app.get('/api/projects/:id/oast/sessions', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const sessions = await SecurityOastSession.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(30);
  res.json(sessions.map(serializeSecurityOastSession));
}));

app.post('/api/projects/:id/oast/sessions', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const session = await createSecurityOastSession(projectId, req.user._id, req.body.label, inferBaseUrl(req));
  await touchProject(projectId);
  res.status(201).json(session);
}));

app.get('/api/projects/:id/security/traffic', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const captures = await TrafficCapture.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(50);
  res.json(captures.map(serializeTrafficCapture));
}));

app.post('/api/projects/:id/security/traffic/import', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const capture = await importTrafficCapture(projectId, req.user._id, req.body);
  await touchProject(projectId);
  res.status(201).json(capture);
}));

app.get('/api/projects/:id/security/traffic/:captureId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const captureId = parseNumericId(req.params.captureId);
  if (projectId === null || captureId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const capture = await getOwnedTrafficCapture(captureId, projectId, req.user._id);
  if (!capture) {
    res.status(404).json({ error: 'Traffic capture not found' });
    return;
  }

  res.json(buildTrafficCaptureDetail(capture));
}));

app.post('/api/projects/:id/security/traffic/:captureId/replay', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const captureId = parseNumericId(req.params.captureId);
  if (projectId === null || captureId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const capture = await getOwnedTrafficCapture(captureId, projectId, req.user._id);
  if (!capture) {
    res.status(404).json({ error: 'Traffic capture not found' });
    return;
  }

  const profile = await ensureProjectSecurityProfile(projectId, req.user._id);
  const replay = await replayTrafficCaptureEntry(
    capture,
    req.body.entryId ?? req.body.entry_id ?? req.body.entry ?? req.body.order,
    profile,
    { timeoutMs: req.body.timeoutMs ?? req.body.timeout },
  );
  res.json(replay);
}));

app.post('/api/projects/:id/security/traffic/:captureId/replay-flow', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const captureId = parseNumericId(req.params.captureId);
  if (projectId === null || captureId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const capture = await getOwnedTrafficCapture(captureId, projectId, req.user._id);
  if (!capture) {
    res.status(404).json({ error: 'Traffic capture not found' });
    return;
  }

  const profile = await ensureProjectSecurityProfile(projectId, req.user._id);
  const result = await replayTrafficCaptureFlow(capture, profile, {
    chainIndex: req.body.chainIndex ?? req.body.chain_index,
    entryIds: req.body.entryIds ?? req.body.entry_ids,
    startOrder: req.body.startOrder ?? req.body.start_order ?? req.body.fromOrder ?? req.body.from_order,
    endOrder: req.body.endOrder ?? req.body.end_order ?? req.body.toOrder ?? req.body.to_order,
    carryCookies: req.body.carryCookies ?? req.body.carry_cookies,
    stopOnFailure: req.body.stopOnFailure ?? req.body.stop_on_failure,
    timeoutMs: req.body.timeoutMs ?? req.body.timeout,
  });
  res.json(result);
}));

app.get('/api/projects/:id/security/traffic/:captureId/flow', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const captureId = parseNumericId(req.params.captureId);
  if (projectId === null || captureId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const capture = await getOwnedTrafficCapture(captureId, projectId, req.user._id);
  if (!capture) {
    res.status(404).json({ error: 'Traffic capture not found' });
    return;
  }

  res.json(buildTrafficFlowGraph(capture));
}));

app.post('/api/projects/:id/security/traffic/:captureId/mutate', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const captureId = parseNumericId(req.params.captureId);
  if (projectId === null || captureId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const capture = await getOwnedTrafficCapture(captureId, projectId, req.user._id);
  if (!capture) {
    res.status(404).json({ error: 'Traffic capture not found' });
    return;
  }

  const profile = await ensureProjectSecurityProfile(projectId, req.user._id);
  const result = await mutateTrafficCaptureEntry(
    capture,
    req.body.entryId ?? req.body.entry_id ?? req.body.entry ?? req.body.order,
    profile,
    req.body.mutations ?? req.body,
    { timeoutMs: req.body.timeoutMs ?? req.body.timeout },
  );
  res.json(result);
}));

app.get('/api/projects/:id/tasks', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const tasks = await ProjectTask.find({ project_id: projectId, user_id: req.user._id }).sort({ updated_at: -1 }).limit(50);
  res.json(tasks.map(serializeProjectTask));
}));

app.post('/api/projects/:id/tasks', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const title = String(req.body.title ?? '').trim();
  const request = String(req.body.request ?? '').trim();
  const acceptanceCriteria = normalizeAcceptanceCriteria(req.body.acceptance_criteria ?? req.body.acceptanceCriteria);
  if (!title) {
    res.status(400).json({ error: 'Task title is required' });
    return;
  }

  const baseCheckpoint = await createProjectCheckpointSnapshot(projectId, req.user._id, `Before task: ${title}`);
  const taskId = await nextSequence('project_tasks');
  const task = await ProjectTask.create({
    id: taskId,
    project_id: projectId,
    user_id: req.user._id,
    title,
    request,
    acceptance_criteria: acceptanceCriteria,
    status: 'active',
    workspace_key: buildTaskWorkspaceKey(projectId, taskId),
    base_checkpoint_id: baseCheckpoint.id,
    changed_paths: [],
    created_at: new Date(),
    updated_at: new Date(),
    last_activity_at: new Date(),
  });

  await seedTaskFilesFromProject(taskId, projectId);
  res.status(201).json(serializeProjectTask(task));
}));

app.get('/api/projects/:id/tasks/:taskId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const taskId = parseNumericId(req.params.taskId);
  if (projectId === null || taskId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const task = await getOwnedTask(projectId, taskId, req.user._id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(serializeProjectTask(task));
}));

app.get('/api/projects/:id/tasks/:taskId/review', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const taskId = parseNumericId(req.params.taskId);
  if (projectId === null || taskId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const task = await getOwnedTask(projectId, taskId, req.user._id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const review = await buildTaskReview(projectId, taskId);
  await touchTask(task, {
    status: review.changed_paths.length > 0 ? 'review-ready' : 'active',
    changed_paths: review.changed_paths,
    last_review: review.summary,
  });
  res.json({
    task: serializeProjectTask(task),
    review,
  });
}));

app.post('/api/projects/:id/tasks/:taskId/apply', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const taskId = parseNumericId(req.params.taskId);
  if (projectId === null || taskId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const task = await getOwnedTask(projectId, taskId, req.user._id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const checkpoint = await createProjectCheckpointSnapshot(projectId, req.user._id, `Before applying task: ${task.title}`);
  const review = await buildTaskReview(projectId, taskId);
  const applyResult = await applyTaskFilesToProject(projectId, taskId);
  await touchProject(projectId);

  if (review.removed.length > 0) {
    try {
      const rmCommand = review.removed.map((filePath) => `rm -f ${shellQuote(filePath)}`).join(' && ');
      if (rmCommand) {
        await runRunnerShellCommand(projectId, rmCommand, { timeout: 15000 });
      }
    } catch {}
  }

  try {
    const files = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
    await syncProjectFilesToRunner(projectId, files.map(serializeFile));
  } catch {}

  await touchTask(task, {
    status: 'applied',
    changed_paths: applyResult.changed_paths,
    last_review: review.summary,
    last_summary: `Applied task changes (${applyResult.created} created, ${applyResult.updated} updated, ${applyResult.removed} removed).`,
    applied_at: new Date(),
  });

  res.json({
    ok: true,
    checkpoint_id: checkpoint.id,
    task: serializeProjectTask(task),
    review,
    apply: applyResult,
  });
}));

app.post('/api/projects/:id/tasks/:taskId/discard', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const taskId = parseNumericId(req.params.taskId);
  if (projectId === null || taskId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const task = await getOwnedTask(projectId, taskId, req.user._id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  try {
    await runRunnerShellCommand(task.workspace_key, 'find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +', { timeout: 30000 });
  } catch {}

  await touchTask(task, {
    status: 'discarded',
    discarded_at: new Date(),
  });
  res.json({
    ok: true,
    task: serializeProjectTask(task),
  });
}));

app.get('/api/projects/:id/checkpoints', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const checkpoints = await ProjectCheckpoint.find({ project_id: projectId, user_id: req.user._id }).sort({ created_at: -1 }).limit(20);
  res.json(checkpoints.map(serializeProjectCheckpoint));
}));

app.post('/api/projects/:id/checkpoints', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const reason = String(req.body.reason ?? '').trim();
  const checkpoint = await createProjectCheckpointSnapshot(projectId, req.user._id, reason);
  res.status(201).json(serializeProjectCheckpoint(checkpoint));
}));

app.post('/api/projects/:id/checkpoints/:checkpointId/restore', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const checkpointId = parseNumericId(req.params.checkpointId);
  if (projectId === null || checkpointId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const checkpoint = await getOwnedCheckpoint(checkpointId, projectId, req.user._id);
  if (!checkpoint) {
    res.status(404).json({ error: 'Checkpoint not found' });
    return;
  }
  await restoreProjectCheckpointSnapshot(projectId, checkpoint);
  res.status(204).end();
}));

app.delete('/api/projects/:id/checkpoints/:checkpointId', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  const checkpointId = parseNumericId(req.params.checkpointId);
  if (projectId === null || checkpointId === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const checkpoint = await getOwnedCheckpoint(checkpointId, projectId, req.user._id);
  if (!checkpoint) {
    res.status(404).json({ error: 'Checkpoint not found' });
    return;
  }
  await ProjectCheckpoint.deleteOne({ _id: checkpoint._id });
  res.status(204).end();
}));

app.get('/api/projects/:id/secrets', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const secretDoc = await ProjectSecret.findOne({ project_id: projectId, user_id: req.user._id });
  res.json((secretDoc?.secrets ?? []).map((secret) => ({
    key: secret.key,
    value: decryptSecret(secret.value),
  })));
}));

app.put('/api/projects/:id/secrets', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const secrets = Array.isArray(req.body.secrets)
    ? req.body.secrets.map((secret) => ({
        key: String(secret.key ?? '').trim(),
        value: encryptSecret(secret.value),
      })).filter((secret) => secret.key)
    : [];

  await ProjectSecret.findOneAndUpdate(
    { project_id: projectId, user_id: req.user._id },
    { project_id: projectId, user_id: req.user._id, secrets, updated_at: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.status(204).end();
}));

app.get('/api/me/credits', requireAuth, asyncRoute(async (req, res) => {
  res.json({
    balance: req.user.credit_balance ?? 0,
    subscription_tier: req.user.subscription_tier ?? 'free',
  });
}));

app.get('/api/runner/config', requireAuth, asyncRoute(async (_req, res) => {
  const config = await getRunnerClientConfig();
  let reachable = false;
  let browser_available = false;
  let error = '';

  if (config.configured) {
    try {
      const health = await runnerHealthCheck();
      reachable = true;
      browser_available = health?.puppeteer === 'available';
    } catch (runnerError) {
      error = runnerError instanceof Error ? runnerError.message : String(runnerError);
    }
  }

  res.json({
    ...config,
    reachable,
    browser_available,
    error,
  });
}));

app.post('/api/projects/:id/runner/run', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const timeout = Math.max(1000, Number(req.body.timeout ?? 30000));
  if (req.body.stream) {
    await streamRunnerForProject(req, res, projectId, '/run', req.body, timeout + 5000);
    return;
  }

  const data = await runnerJsonForProject(projectId, '/run', req.body, timeout + 5000);
  res.json(data);
}));

app.post('/api/projects/:id/runner/write', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const data = await runnerJsonForProject(projectId, '/write', req.body, 30000);
  res.json(data);
}));

app.post('/api/projects/:id/runner/read', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const data = await runnerJsonForProject(projectId, '/read', req.body, 30000);
  res.json(data);
}));

app.post('/api/projects/:id/runner/install', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const timeout = Math.max(1000, Number(req.body.timeout ?? 120000));
  const data = await runnerJsonForProject(projectId, '/install', req.body, timeout);
  res.json(data);
}));

app.post('/api/projects/:id/runner/ls', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const data = await runnerJsonForProject(projectId, '/ls', req.body, 30000);
  res.json(data);
}));

app.post('/api/projects/:id/runner/browser', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const timeout = Math.max(1000, Number(req.body.timeout ?? 30000));
  const data = await runnerJsonForProject(projectId, '/browser', req.body, timeout + 5000);
  res.json(data);
}));

app.get('/api/projects/:id/git', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const emptyState = {
    connected: false,
    branch: '',
    upstream: '',
    ahead: 0,
    behind: 0,
    clean: true,
    changes: [],
    remoteUrl: '',
    lastCommitHash: '',
    lastCommitMessage: '',
    lastCommitAt: '',
  };

  try {
    const files = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
    await syncProjectFilesToRunner(projectId, files.map(serializeFile));
    const gitState = await getProjectGitState(projectId);
    if (gitState.connected) {
      await persistProjectGitMetadata(project, gitState, { repo_last_error: '' });
    }
    res.json(buildGitResponse(project, gitState));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistProjectGitMetadata(project, {}, { repo_last_error: message });
    res.json(buildGitResponse(project, emptyState, { error: message }));
  }
}));

app.post('/api/projects/:id/git/connect', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const repoUrl = normalizeRepoUrl(req.body.repoUrl ?? req.body.repo_url ?? '');
  const branch = String(req.body.branch ?? '').trim();
  if (!repoUrl) {
    res.status(400).json({ error: 'Repository URL is required' });
    return;
  }

  let checkpoint = null;
  try {
    const existingFileCount = await ProjectFile.countDocuments({ project_id: projectId });
    if (existingFileCount > 0) {
      checkpoint = await createProjectCheckpointSnapshot(projectId, req.user._id, `Before cloning ${repoUrl}`);
    }

    await runRunnerShellCommand(projectId, 'find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +', { timeout: 30000 });

    const cloneCommand = `git clone --depth=1${branch ? ` --branch ${shellQuote(branch)}` : ''} ${shellQuote(repoUrl)} .`;
    const cloneResult = await runGitCommand(projectId, req.user._id, repoUrl, cloneCommand, { timeout: 180000 });
    if (cloneResult.exitCode !== 0) {
      throw new Error(String(cloneResult.stderr || cloneResult.stdout || 'git clone failed').trim());
    }

    const gitState = await getProjectGitState(projectId);
    const sync = await syncRunnerWorkspaceToProject(projectId);
    await touchProject(projectId);
    await persistProjectGitMetadata(project, gitState, {
      repo_connected_at: project.repo_connected_at || new Date(),
      repo_last_sync_at: new Date(),
      repo_last_error: '',
    });

    res.json(buildGitResponse(project, gitState, {
      ok: true,
      checkpoint_id: checkpoint?.id ?? null,
      sync,
      output: String(cloneResult.stdout ?? cloneResult.stderr ?? '').slice(0, 8000),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistProjectGitMetadata(project, {
      remoteUrl: repoUrl,
      branch,
    }, {
      repo_connected_at: project.repo_connected_at || null,
      repo_last_error: message,
    });
    res.status(400).json({ error: message, checkpoint_id: checkpoint?.id ?? null });
  }
}));

app.post('/api/projects/:id/git/pull', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const repoUrl = project.repo_url || String(req.body.repoUrl ?? req.body.repo_url ?? '').trim();
  const branch = String(req.body.branch ?? project.repo_branch ?? '').trim();
  let checkpoint = null;

  try {
    checkpoint = await createProjectCheckpointSnapshot(projectId, req.user._id, 'Before git pull');
    const files = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
    await syncProjectFilesToRunner(projectId, files.map(serializeFile));
    const pullCommand = branch
      ? `git pull --rebase --autostash origin ${shellQuote(branch)}`
      : 'git pull --rebase --autostash';
    const pullResult = await runGitCommand(projectId, req.user._id, repoUrl, pullCommand, { timeout: 180000 });
    if (pullResult.exitCode !== 0) {
      throw new Error(String(pullResult.stderr || pullResult.stdout || 'git pull failed').trim());
    }

    const gitState = await getProjectGitState(projectId);
    const sync = await syncRunnerWorkspaceToProject(projectId);
    await touchProject(projectId);
    await persistProjectGitMetadata(project, gitState, {
      repo_last_sync_at: new Date(),
      repo_last_error: '',
    });

    res.json(buildGitResponse(project, gitState, {
      ok: true,
      checkpoint_id: checkpoint?.id ?? null,
      sync,
      output: String(pullResult.stdout ?? pullResult.stderr ?? '').slice(0, 8000),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistProjectGitMetadata(project, {}, { repo_last_error: message });
    res.status(400).json({ error: message, checkpoint_id: checkpoint?.id ?? null });
  }
}));

app.post('/api/projects/:id/git/push', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const repoUrl = project.repo_url || String(req.body.repoUrl ?? req.body.repo_url ?? '').trim();
  const branch = String(req.body.branch ?? project.repo_branch ?? '').trim();
  const message = String(req.body.message ?? 'Update from LUXI IDE').trim() || 'Update from LUXI IDE';
  const authorName = String(req.user.display_name ?? req.user.email?.split?.('@')?.[0] ?? 'LUXI User').trim();
  const authorEmail = String(req.user.email ?? 'luxi@example.com').trim();

  try {
    const files = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
    await syncProjectFilesToRunner(projectId, files.map(serializeFile));
    const pushTarget = branch ? shellQuote(`HEAD:${branch}`) : 'HEAD';
    const pushCommand = [
      `if ! git config user.name >/dev/null; then git config user.name ${shellQuote(authorName)}; fi`,
      `if ! git config user.email >/dev/null; then git config user.email ${shellQuote(authorEmail)}; fi`,
      'git add -A',
      `if git diff --cached --quiet; then echo "__LUXI_NO_CHANGES__"; else git commit -m ${shellQuote(message)}; fi`,
      `git push origin ${pushTarget}`,
    ].join(' && ');
    const pushResult = await runGitCommand(projectId, req.user._id, repoUrl, pushCommand, { timeout: 180000 });
    if (pushResult.exitCode !== 0) {
      throw new Error(String(pushResult.stderr || pushResult.stdout || 'git push failed').trim());
    }

    const gitState = await getProjectGitState(projectId);
    await persistProjectGitMetadata(project, gitState, {
      repo_last_sync_at: new Date(),
      repo_last_error: '',
    });

    res.json(buildGitResponse(project, gitState, {
      ok: true,
      output: String(pushResult.stdout ?? pushResult.stderr ?? '').slice(0, 8000),
      committed: !String(pushResult.stdout ?? '').includes('__LUXI_NO_CHANGES__'),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistProjectGitMetadata(project, {}, { repo_last_error: message });
    res.status(400).json({ error: message });
  }
}));

app.post('/api/projects/:id/git/sync', requireAuth, asyncRoute(async (req, res) => {
  const projectId = parseNumericId(req.params.id);
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const project = await getOwnedProject(projectId, req.user._id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const sync = await syncRunnerWorkspaceToProject(projectId);
    await touchProject(projectId);
    let gitState = {
      connected: false,
      branch: '',
      upstream: '',
      ahead: 0,
      behind: 0,
      clean: true,
      changes: [],
      remoteUrl: '',
      lastCommitHash: '',
      lastCommitMessage: '',
      lastCommitAt: '',
    };
    try {
      gitState = await getProjectGitState(projectId);
    } catch {}
    await persistProjectGitMetadata(project, gitState, {
      repo_last_sync_at: new Date(),
      repo_last_error: '',
    });
    res.json(buildGitResponse(project, gitState, { ok: true, sync }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistProjectGitMetadata(project, {}, { repo_last_error: message });
    res.status(400).json({ error: message });
  }
}));

app.get('/api/admin/settings', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const settings = getPlatformSettingsWithEnvFallback(
    await getSettings(['provider', 'model', 'gemini_key', 'anthropic_key', 'openai_key', 'vertex_key', 'kimi_key']),
  );
  res.json({
    provider: settings.provider || 'gemini',
    model: settings.model || 'gemini-2.5-flash',
    geminiKeyConfigured: !!settings.gemini_key,
    anthropicKeyConfigured: !!settings.anthropic_key,
    openaiKeyConfigured: !!settings.openai_key,
    vertexKeyConfigured: !!settings.vertex_key,
    kimiKeyConfigured: !!settings.kimi_key,
  });
}));

app.put('/api/admin/settings', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const updates = {
    provider: req.body.provider,
    model: req.body.model,
    gemini_key: req.body.geminiApiKey,
    anthropic_key: req.body.anthropicApiKey,
    openai_key: req.body.openaiApiKey,
    vertex_key: req.body.vertexApiKey,
    kimi_key: req.body.kimiApiKey,
  };
  await upsertSettings(updates);
  res.status(204).end();
}));

app.get('/api/admin/stats', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const [projectCount, fileCount, userCount] = await Promise.all([
    Project.countDocuments(),
    ProjectFile.countDocuments(),
    User.countDocuments(),
  ]);
  res.json({ projectCount, fileCount, userCount });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const users = await User.find().sort({ created_at: -1 });
  res.json(users.map((user) => serializeUser(user)));
}));

app.post('/api/admin/users/:id/credits', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const amount = Number(req.body.amount ?? 0);
  const note = String(req.body.note ?? '');
  if (!Number.isFinite(amount) || amount === 0) {
    res.status(400).json({ error: 'A non-zero credit amount is required' });
    return;
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  user.credit_balance = (user.credit_balance ?? 0) + amount;
  user.total_purchased = (user.total_purchased ?? 0) + (amount > 0 ? amount : 0);
  await user.save();

  await CreditTransaction.create({
    user_id: user._id,
    amount,
    reason: 'admin_grant',
    note,
  });

  res.status(204).end();
}));

app.patch('/api/admin/users/:id/tier', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const tier = String(req.body.tier ?? '').trim();
  if (!tier) {
    res.status(400).json({ error: 'Tier is required' });
    return;
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  user.subscription_tier = tier;
  await user.save();
  res.status(204).end();
}));

app.get('/api/admin/runner', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const config = await getRunnerConfig();
  res.json(config);
}));

app.put('/api/admin/runner', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  await saveRunnerConfig(String(req.body.runner_url ?? ''), String(req.body.runner_secret ?? ''));
  res.status(204).end();
}));

app.get('/api/admin/runner/test', requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const data = await runnerHealthCheck();
  res.json(data);
}));

app.post('/api/admin/runner/test', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const runner_url = String(req.body.runner_url ?? '').trim();
  const runner_secret = String(req.body.runner_secret ?? '').trim();
  const override = runner_url || runner_secret
    ? { runner_url, runner_secret }
    : null;
  const data = await runnerHealthCheck(8000, override);
  res.json(data);
}));

app.post('/api/ai/stream', requireAuth, asyncRoute(handleAIStream));

app.use(optionalAuth);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.use(express.static(distPath));
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

await connectToDatabase();
app.listen(port, () => {
  console.log(`LUXI Mongo API listening on http://localhost:${port}`);
});
