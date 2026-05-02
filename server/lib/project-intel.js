import { decryptSecret } from './secrets.js';
import { ProjectDoc, ProjectSecret, ProjectTask, SecurityFinding, nextSequence } from './models.js';
import { getSettings } from './runner.js';

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return null;
  }
}

function detectProjectStack(files) {
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = safeJsonParse(packageFile?.content ?? '');
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const depNames = new Set(Object.keys(dependencies).map((name) => name.toLowerCase()));
  const filePaths = new Set(files.map((file) => String(file.path ?? '').toLowerCase()));
  const stack = [];

  if (depNames.has('next')) stack.push('Next.js');
  if (depNames.has('react')) stack.push('React');
  if (depNames.has('vue')) stack.push('Vue');
  if (depNames.has('svelte') || depNames.has('@sveltejs/kit')) stack.push('Svelte');
  if (depNames.has('astro')) stack.push('Astro');
  if (depNames.has('vite')) stack.push('Vite');
  if (depNames.has('express') || filePaths.has('server/index.js')) stack.push('Node backend');
  if (depNames.has('mongoose')) stack.push('MongoDB');
  if (depNames.has('puppeteer') || depNames.has('puppeteer-core')) stack.push('Browser automation');
  if (filePaths.has('runner/server.js')) stack.push('Remote runner');
  return Array.from(new Set(stack));
}

function summarizeScripts(files) {
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = safeJsonParse(packageFile?.content ?? '');
  if (!packageJson?.scripts || typeof packageJson.scripts !== 'object') return [];
  return Object.entries(packageJson.scripts)
    .slice(0, 8)
    .map(([key, value]) => `${key}=${String(value)}`);
}

function findKeyFiles(files) {
  const preferred = [
    'package.json',
    'src/main.tsx',
    'src/App.tsx',
    'src/pages/IDE.tsx',
    'src/pages/Home.tsx',
    'server/index.js',
    'server/lib/ai.js',
    'runner/server.js',
    '.luxi.md',
  ];
  const paths = new Set(files.map((file) => file.path));
  const matches = preferred.filter((candidate) => paths.has(candidate));
  return matches.slice(0, 10);
}

function summarizeTests(files) {
  return files
    .map((file) => file.path)
    .filter((filePath) => /(__tests__|\/tests\/|\/spec\/|\.test\.|\.spec\.)/i.test(filePath))
    .slice(0, 10);
}

function extractRepoSlug(repoUrl = '') {
  const value = String(repoUrl ?? '').trim();
  if (!value) return null;

  const httpsMatch = value.match(/github\.com[:/]+([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;

  const sshMatch = value.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

  return null;
}

async function getGitHubToken(projectId, userId) {
  const [secretDoc, settings] = await Promise.all([
    ProjectSecret.findOne({ project_id: projectId, user_id: userId }),
    getSettings(['github_token']),
  ]);

  for (const secret of secretDoc?.secrets ?? []) {
    const key = String(secret.key ?? '').trim().toUpperCase();
    if (key === 'GITHUB_TOKEN' || key === 'GH_TOKEN') {
      const value = decryptSecret(secret.value);
      if (value) return value;
    }
  }

  return String(settings.github_token ?? '').trim();
}

export async function buildProjectMemorySummary(project, files, docs = []) {
  const activeTasks = await ProjectTask.find({
    project_id: project.id,
    user_id: project.user_id,
    status: { $in: ['active', 'review-ready'] },
  }).sort({ updated_at: -1 }).limit(5);
  const openFindings = await SecurityFinding.find({
    project_id: project.id,
    user_id: project.user_id,
    status: { $nin: ['fixed', 'false_positive', 'duplicate'] },
  }).sort({ updated_at: -1 }).limit(5);

  const nonMemoryDocs = docs.filter((doc) => doc.title !== '.luxi.memory.md');
  const stack = detectProjectStack(files);
  const scripts = summarizeScripts(files);
  const tests = summarizeTests(files);
  const keyFiles = findKeyFiles(files);
  const recentFiles = files
    .slice()
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .slice(0, 8)
    .map((file) => file.path);

  return [
    '# Project Memory',
    '',
    '## Identity',
    `- Project: ${project.name}`,
    project.description ? `- Description: ${project.description}` : null,
    `- Language: ${project.language ?? 'unknown'}`,
    project.repo_url ? `- Repo: ${project.repo_url}` : '- Repo: not connected',
    '',
    '## Architecture',
    stack.length > 0 ? `- Stack: ${stack.join(', ')}` : '- Stack: not detected',
    keyFiles.length > 0 ? `- Key files: ${keyFiles.join(', ')}` : '- Key files: none detected',
    scripts.length > 0 ? `- Scripts: ${scripts.join(' | ')}` : '- Scripts: none detected',
    tests.length > 0 ? `- Tests: ${tests.join(', ')}` : '- Tests: none detected',
    '',
    '## Working Context',
    recentFiles.length > 0 ? `- Recently touched files: ${recentFiles.join(', ')}` : '- Recently touched files: none',
    nonMemoryDocs.length > 0 ? `- Docs: ${nonMemoryDocs.slice(0, 8).map((doc) => doc.title).join(', ')}` : '- Docs: none',
    activeTasks.length > 0
      ? `- Active tasks: ${activeTasks.map((task) => `${task.title} (${task.status})`).join(' | ')}`
      : '- Active tasks: none',
    openFindings.length > 0
      ? `- Open security findings: ${openFindings.map((finding) => `${finding.title} (${finding.severity})`).join(' | ')}`
      : '- Open security findings: none',
    '',
    '## Use This Memory For',
    '- Start with the listed scripts, key files, and tests before guessing.',
    '- Treat active tasks as isolated work until they are reviewed and applied.',
    '- Prefer the connected repo and docs over inventing structure.',
  ].filter(Boolean).join('\n');
}

export async function ensureProjectMemoryDoc(project, files, docs = []) {
  const summary = await buildProjectMemorySummary(project, files, docs);
  const existing = await ProjectDoc.findOne({ project_id: project.id, title: '.luxi.memory.md' });
  if (!existing) {
    const created = await ProjectDoc.create({
      id: await nextSequence('project_docs'),
      project_id: project.id,
      title: '.luxi.memory.md',
      content: summary,
      created_at: new Date(),
    });
    return created;
  }

  if ((existing.content ?? '') !== summary) {
    existing.content = summary;
    await existing.save();
  }
  return existing;
}

export async function loadGitHubContext(project, userId, options = {}) {
  const repoSlug = extractRepoSlug(project.repo_url);
  if (!repoSlug) {
    throw new Error('GitHub context requires a connected GitHub repository URL.');
  }

  const token = await getGitHubToken(project.id, userId);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LUXI-Agent/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const kind = String(options.kind ?? 'pulls').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(options.limit ?? 5), 10));
  const state = String(options.state ?? 'open').trim().toLowerCase();
  const itemNumber = Number(options.number);
  const ref = String(options.ref ?? project.repo_branch ?? '').trim();
  const baseUrl = `https://api.github.com/repos/${repoSlug}`;

  if (kind === 'pulls' || kind === 'issues') {
    const resource = kind === 'pulls' ? 'pulls' : 'issues';
    const url = Number.isFinite(itemNumber) && itemNumber > 0
      ? `${baseUrl}/${resource}/${Math.trunc(itemNumber)}`
      : `${baseUrl}/${resource}?state=${encodeURIComponent(state)}&per_page=${limit}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub ${resource} request failed (${response.status})${text ? `: ${text}` : ''}`);
    }
    const data = await response.json();
    const items = Array.isArray(data) ? data : [data];
    return items.map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      url: item.html_url,
      author: item.user?.login ?? '',
      updated_at: item.updated_at,
      draft: item.draft ?? false,
      merged_at: item.merged_at ?? null,
      body: String(item.body ?? '').slice(0, 2000),
    }));
  }

  if (kind === 'checks') {
    let sha = ref;
    if (!sha) {
      const branchResponse = await fetch(`${baseUrl}/branches/${encodeURIComponent(project.repo_branch || 'main')}`, { headers });
      if (!branchResponse.ok) {
        const text = await branchResponse.text().catch(() => '');
        throw new Error(`GitHub branch request failed (${branchResponse.status})${text ? `: ${text}` : ''}`);
      }
      const branchData = await branchResponse.json();
      sha = branchData.commit?.sha ?? '';
    }
    if (!sha) throw new Error('Could not determine a commit SHA for GitHub checks.');

    const response = await fetch(`${baseUrl}/commits/${encodeURIComponent(sha)}/check-runs?per_page=${limit}`, { headers });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub checks request failed (${response.status})${text ? `: ${text}` : ''}`);
    }
    const data = await response.json();
    return (data.check_runs ?? []).map((checkRun) => ({
      name: checkRun.name,
      status: checkRun.status,
      conclusion: checkRun.conclusion,
      url: checkRun.html_url,
      started_at: checkRun.started_at,
      completed_at: checkRun.completed_at,
      summary: String(checkRun.output?.summary ?? '').slice(0, 2000),
      text: String(checkRun.output?.text ?? '').slice(0, 2000),
    }));
  }

  if (kind === 'commits') {
    const response = await fetch(`${baseUrl}/commits?sha=${encodeURIComponent(ref || project.repo_branch || 'main')}&per_page=${limit}`, { headers });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitHub commits request failed (${response.status})${text ? `: ${text}` : ''}`);
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map((commit) => ({
      sha: commit.sha,
      author: commit.commit?.author?.name ?? commit.author?.login ?? '',
      date: commit.commit?.author?.date ?? '',
      message: String(commit.commit?.message ?? '').slice(0, 500),
      url: commit.html_url,
    }));
  }

  throw new Error(`Unsupported github_context kind: ${kind}`);
}
