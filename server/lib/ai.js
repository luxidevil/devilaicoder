import {
  CreditTransaction,
  Project,
  ProjectCheckpoint,
  ProjectFile,
  ProjectSecurityProfile,
  SecurityCustomCheck,
  SecurityFinding,
  SecurityOastSession,
  SecurityReport,
  ProjectTask,
  ProjectTaskFile,
  TrafficCapture,
  User,
  nextSequence,
  serializeFile,
} from './models.js';
import { buildProjectMemorySummary, ensureProjectMemoryDoc, loadGitHubContext } from './project-intel.js';
import {
  analyzeProjectReverseEngineering,
  buildAttackSurfaceSummary,
  buildTrafficFlowGraph,
  buildTrafficCaptureDetail,
  buildSecurityReportMarkdown,
  createSecurityOastSession,
  createSecurityReport,
  ensureProjectSecurityProfile,
  mutateTrafficCaptureEntry,
  normalizeFindingStatus,
  normalizeSecuritySeverity,
  persistSecurityFindings,
  replayTrafficCaptureFlow,
  replayTrafficCaptureEntry,
  runSecurityScan,
  summarizeApiSpecs,
} from './security.js';
import {
  syncProjectFilesToRunner as syncProjectFilesToRunnerHelper,
  syncRunnerWorkspaceToProject as syncRunnerWorkspaceToProjectHelper,
} from './project-sync.js';
import { getRunnerConfig, getSettings, runnerFetch, runnerHealthCheck } from './runner.js';
import {
  getOwnedTask,
  listTaskFiles,
  seedTaskFilesFromProject,
  upsertTaskFile,
} from './tasks.js';

function send(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function detectLanguage(path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', css: 'css', scss: 'css', sass: 'css',
    html: 'html', json: 'json', md: 'markdown', mdx: 'markdown',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'shell', bash: 'shell',
    sql: 'sql', graphql: 'graphql', vue: 'vue', svelte: 'svelte',
    rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', cpp: 'cpp', cs: 'csharp', dockerfile: 'dockerfile',
  };
  return map[ext] ?? 'plaintext';
}

function looksLikeLiveWebsiteTask(message) {
  const text = String(message ?? '').toLowerCase();
  if (!text) return false;

  const explicitNavigation = /\b(open|visit|browse|navigate|go to)\b/.test(text);
  const browserInteraction = /\b(click|type|fill|submit|log in|login|otp|captcha)\b/.test(text);
  const publicSiteNoun = /\b(website|site|page|form)\b/.test(text);

  return (
    (explicitNavigation && publicSiteNoun)
    || (browserInteraction && publicSiteNoun)
    || /\b(sign up|signup)\b/.test(text) && publicSiteNoun
    || /https?:\/\//.test(text)
    || /\b[a-z0-9-]+\.(com|net|org|io|app|ai|co|dev|in|edu|gov)\b/.test(text)
  );
}

function formatRuntimeContext(runtimeContext) {
  const lines = [];

  if (runtimeContext.runnerConfigured) {
    lines.push(`- Runner: configured at ${runtimeContext.runnerUrl || 'the saved URL'}.`);
  } else {
    lines.push('- Runner: not configured.');
  }

  if (runtimeContext.runnerReachable) {
    lines.push('- Runner status: reachable.');
  } else if (runtimeContext.runnerError) {
    lines.push(`- Runner status: unavailable (${runtimeContext.runnerError}).`);
  }

  if (runtimeContext.browserAvailable) {
    lines.push('- Browser automation: available via browser_action.');
  } else if (runtimeContext.runnerConfigured) {
    lines.push('- Browser automation: unavailable right now.');
  }

  if (runtimeContext.websiteTask) {
    lines.push('- Website mode: enabled for this request.');
  }

  if (runtimeContext.browserSessionId) {
    lines.push(`- Browser sessionId: ${runtimeContext.browserSessionId}.`);
  }

  if (runtimeContext.manualBrowser) {
    lines.push('- Manual browser handoff: enabled. Visible browser launch is allowed when automation needs a human step.');
  }

  if (runtimeContext.visualBrowserAnalysis) {
    lines.push('- Visual browser analysis: enabled when screenshots are available.');
  }

  return lines.join('\n');
}

function normalizeFilePolicy(policy) {
  return {
    targets: Array.isArray(policy?.targets) ? policy.targets.map((entry) => String(entry).trim()).filter(Boolean) : [],
    locked: Array.isArray(policy?.locked) ? policy.locked.map((entry) => String(entry).trim()).filter(Boolean) : [],
    ignored: Array.isArray(policy?.ignored) ? policy.ignored.map((entry) => String(entry).trim()).filter(Boolean) : [],
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathMatchesRule(path, rule) {
  const normalizedPath = String(path ?? '').trim();
  const normalizedRule = String(rule ?? '').trim();
  if (!normalizedPath || !normalizedRule) return false;

  if (normalizedRule.includes('*')) {
    const regex = new RegExp(`^${escapeRegex(normalizedRule).replace(/\\\*/g, '.*')}$`);
    return regex.test(normalizedPath);
  }

  if (normalizedPath === normalizedRule) return true;
  const withSlash = normalizedRule.endsWith('/') ? normalizedRule : `${normalizedRule}/`;
  return normalizedPath.startsWith(withSlash);
}

function pathMatchesAnyRule(path, rules = []) {
  return rules.some((rule) => pathMatchesRule(path, rule));
}

function isHiddenByPolicy(path, filePolicy) {
  return pathMatchesAnyRule(path, filePolicy.ignored);
}

function canModifyPath(path, filePolicy) {
  if (pathMatchesAnyRule(path, filePolicy.ignored)) {
    return { allowed: false, reason: `Path ${path} is ignored by the current file policy.` };
  }
  if (pathMatchesAnyRule(path, filePolicy.locked)) {
    return { allowed: false, reason: `Path ${path} is locked and may not be modified.` };
  }
  if (filePolicy.targets.length > 0 && !pathMatchesAnyRule(path, filePolicy.targets)) {
    return { allowed: false, reason: `Path ${path} is outside the allowed target files and folders.` };
  }
  return { allowed: true };
}

function filterVisibleFiles(files, filePolicy) {
  return files.filter((file) => !isHiddenByPolicy(file.path, filePolicy));
}

function formatFilePolicy(filePolicy) {
  const lines = [];
  if (filePolicy.targets.length > 0) lines.push(`- Allowed write targets: ${filePolicy.targets.join(', ')}`);
  if (filePolicy.locked.length > 0) lines.push(`- Locked from edits: ${filePolicy.locked.join(', ')}`);
  if (filePolicy.ignored.length > 0) lines.push(`- Ignore entirely: ${filePolicy.ignored.join(', ')}`);
  return lines.join('\n');
}

const CONTEXT_STOPWORDS = new Set([
  'a', 'an', 'and', 'app', 'are', 'as', 'at', 'be', 'build', 'by', 'can', 'change', 'code', 'component', 'create',
  'data', 'do', 'end', 'feature', 'file', 'files', 'fix', 'for', 'from', 'get', 'have', 'how', 'i', 'if', 'implement',
  'in', 'into', 'is', 'it', 'make', 'me', 'my', 'need', 'of', 'on', 'or', 'our', 'page', 'please', 'project', 'route',
  'screen', 'server', 'should', 'task', 'that', 'the', 'this', 'to', 'update', 'use', 'want', 'we', 'with', 'you', 'your',
]);

function extractContextTokens(text) {
  const rawTokens = String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  const derived = [];
  for (const token of rawTokens) {
    const parts = token.split(/[/:._-]+/g).filter(Boolean);
    derived.push(token, ...parts);
  }
  return Array.from(new Set(derived.filter((token) => token.length >= 2 && !CONTEXT_STOPWORDS.has(token)))).slice(0, 30);
}

function fileLooksImportant(path) {
  const normalized = String(path ?? '').toLowerCase();
  const base = normalized.split('/').pop() ?? normalized;
  if ([
    'package.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'vite.config.js',
    'next.config.js',
    'next.config.mjs',
    'nuxt.config.ts',
    'svelte.config.js',
    'astro.config.mjs',
    'tailwind.config.js',
    'tailwind.config.ts',
    'playwright.config.ts',
    'vitest.config.ts',
    'jest.config.js',
    'dockerfile',
    'docker-compose.yml',
    'readme.md',
    '.luxi.md',
  ].includes(base)) {
    return true;
  }

  return (
    normalized === 'src/main.tsx'
    || normalized === 'src/main.jsx'
    || normalized === 'src/app.tsx'
    || normalized === 'src/app.jsx'
    || normalized === 'src/app.vue'
    || normalized === 'src/app.svelte'
    || normalized === 'src/index.tsx'
    || normalized === 'src/index.jsx'
    || normalized === 'server/index.js'
    || normalized === 'server.js'
    || normalized === 'app/page.tsx'
    || normalized === 'pages/index.tsx'
    || normalized === 'runner/server.js'
  );
}

function fileLooksLikeTest(path) {
  const normalized = String(path ?? '').toLowerCase();
  return (
    normalized.includes('__tests__/')
    || normalized.includes('/test/')
    || normalized.includes('/tests/')
    || normalized.includes('/spec/')
    || /\.test\./.test(normalized)
    || /\.spec\./.test(normalized)
  );
}

function summarizeVisibleFilePaths(files, limit = 160) {
  const visible = files.slice(0, limit).map((file) => file.path);
  const remaining = files.length - visible.length;
  return `${visible.join('\n')}${remaining > 0 ? `\n... and ${remaining} more files` : ''}`;
}

function detectProjectStack(files) {
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = safeJsonParse(packageFile?.content ?? '');
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const depNames = new Set(Object.keys(dependencies).map((name) => name.toLowerCase()));
  const filePaths = new Set(files.map((file) => file.path.toLowerCase()));
  const stack = [];

  if (depNames.has('next')) stack.push('Next.js');
  if (depNames.has('react') || filePaths.has('src/app.tsx') || filePaths.has('src/main.tsx')) stack.push('React');
  if (depNames.has('vue')) stack.push('Vue');
  if (depNames.has('svelte') || depNames.has('@sveltejs/kit')) stack.push('Svelte');
  if (depNames.has('astro')) stack.push('Astro');
  if (depNames.has('vite') || Array.from(filePaths).some((path) => path.startsWith('vite.config.'))) stack.push('Vite');
  if (depNames.has('express') || depNames.has('fastify') || depNames.has('koa') || depNames.has('hono')) stack.push('Node API');
  if (filePaths.has('server/index.js') || filePaths.has('server.js')) stack.push('Node backend');
  if (depNames.has('mongoose') || depNames.has('@supabase/supabase-js') || depNames.has('prisma')) stack.push('Database integration');
  if (depNames.has('puppeteer') || depNames.has('puppeteer-core') || depNames.has('playwright')) stack.push('Browser automation');
  if (filePaths.has('runner/server.js')) stack.push('Remote runner');
  if (filePaths.has('dockerfile') || filePaths.has('docker-compose.yml')) stack.push('Docker');
  if (filePaths.has('pyproject.toml') || filePaths.has('requirements.txt')) stack.push('Python');
  if (filePaths.has('cargo.toml')) stack.push('Rust');
  if (filePaths.has('go.mod')) stack.push('Go');

  return Array.from(new Set(stack));
}

function summarizePackageJson(files) {
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = safeJsonParse(packageFile?.content ?? '');
  if (!packageJson || typeof packageJson !== 'object') return '';

  const scripts = Object.entries(packageJson.scripts ?? {}).slice(0, 8);
  const dependencies = Object.keys(packageJson.dependencies ?? {}).slice(0, 10);
  const devDependencies = Object.keys(packageJson.devDependencies ?? {}).slice(0, 10);
  const lines = [];
  if (scripts.length > 0) lines.push(`- Scripts: ${scripts.map(([key, value]) => `${key}=${String(value)}`).join(' | ')}`);
  if (dependencies.length > 0) lines.push(`- Dependencies: ${dependencies.join(', ')}`);
  if (devDependencies.length > 0) lines.push(`- Dev dependencies: ${devDependencies.join(', ')}`);
  return lines.join('\n');
}

function getLikelyEntryPaths(files) {
  const filePaths = files.map((file) => file.path);
  const preferred = [
    'package.json',
    'src/main.tsx',
    'src/main.jsx',
    'src/App.tsx',
    'src/App.jsx',
    'src/app.tsx',
    'src/app.jsx',
    'src/index.tsx',
    'src/index.jsx',
    'src/pages/IDE.tsx',
    'src/pages/Home.tsx',
    'app/page.tsx',
    'pages/index.tsx',
    'server/index.js',
    'server/lib/ai.js',
    'runner/server.js',
  ];
  const matches = preferred.filter((candidate) => filePaths.includes(candidate));
  for (const file of filePaths) {
    if (matches.length >= 10) break;
    if ((/^(src\/(pages|components|lib)\/)/.test(file) || /^(server|runner)\//.test(file)) && !matches.includes(file)) {
      matches.push(file);
    }
  }
  return matches.slice(0, 10);
}

function scoreFileForContext(file, tokens, filePolicy = normalizeFilePolicy()) {
  const path = String(file.path ?? '').toLowerCase();
  const base = String(file.name ?? path.split('/').pop() ?? '').toLowerCase();
  let score = 0;

  if (fileLooksImportant(path)) score += 40;
  if (fileLooksLikeTest(path)) score += 12;
  if (pathMatchesAnyRule(file.path, filePolicy.targets)) score += 160;

  for (const token of tokens) {
    if (path === token || base === token) score += 180;
    else if (base === `${token}.ts` || base === `${token}.tsx` || base === `${token}.js` || base === `${token}.jsx`) score += 140;
    else if (base.includes(token)) score += 90;
    else if (path.includes(`/${token}/`) || path.includes(`/${token}.`) || path.includes(`/${token}-`) || path.includes(`/${token}_`)) score += 70;
    else if (path.includes(token)) score += 35;
  }

  if (tokens.some((token) => ['test', 'tests', 'spec', 'bug', 'fix', 'failing', 'failure', 'verify', 'validation'].includes(token)) && fileLooksLikeTest(path)) {
    score += 50;
  }
  if (tokens.some((token) => ['auth', 'login', 'signup', 'session', 'token', 'secret'].includes(token)) && /auth|login|session|token|secret/.test(path)) {
    score += 45;
  }
  if (tokens.some((token) => ['ui', 'page', 'component', 'layout', 'style', 'css', 'tailwind'].includes(token)) && /(src\/|pages\/|app\/|components\/|styles\/|\.css$|\.tsx$|\.jsx$|\.vue$|\.svelte$)/.test(path)) {
    score += 30;
  }
  if (tokens.some((token) => ['api', 'server', 'backend', 'route', 'endpoint', 'runner'].includes(token)) && /^(server|runner)\//.test(path)) {
    score += 35;
  }

  return score;
}

function selectContextFiles(files, message, filePolicy = normalizeFilePolicy(), maxFiles = 12) {
  const totalChars = files.reduce((sum, file) => sum + String(file.content ?? '').length, 0);
  if (files.length <= 8 && totalChars <= 45000) {
    return { inlineAll: true, selected: files };
  }

  const tokens = extractContextTokens(message);
  const scored = files
    .map((file) => ({ file, score: scoreFileForContext(file, tokens, filePolicy) }))
    .sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path));

  const selected = [];
  for (const entry of scored) {
    if (selected.length >= maxFiles) break;
    if (entry.score <= 0 && selected.length >= 6) break;
    selected.push(entry.file);
  }

  if (selected.length === 0) {
    selected.push(...files.filter((file) => fileLooksImportant(file.path)).slice(0, maxFiles));
  }

  return {
    inlineAll: false,
    selected: Array.from(new Map(selected.map((file) => [file.path, file])).values()).slice(0, maxFiles),
  };
}

function formatFileSnippet(file, maxChars = 5000) {
  return `--- ${file.path} (${file.language}) ---\n${String(file.content ?? '').slice(0, maxChars)}`;
}

function buildProjectMapSummary(message, files, docs, filePolicy = normalizeFilePolicy()) {
  const visibleFiles = filterVisibleFiles(files, filePolicy);
  const stack = detectProjectStack(visibleFiles);
  const entryPaths = getLikelyEntryPaths(visibleFiles);
  const testFiles = visibleFiles.filter((file) => fileLooksLikeTest(file.path)).slice(0, 8).map((file) => file.path);
  const tokens = extractContextTokens(message);
  const relevant = selectContextFiles(visibleFiles, message, filePolicy, 8).selected.map((file) => file.path);
  const docTitles = docs.slice(0, 8).map((doc) => doc.title).filter(Boolean);
  const lines = [
    `- Visible files: ${visibleFiles.length}`,
    stack.length > 0 ? `- Likely stack: ${stack.join(', ')}` : null,
    entryPaths.length > 0 ? `- Likely entrypoints / key files: ${entryPaths.join(', ')}` : null,
    summarizePackageJson(visibleFiles) || null,
    testFiles.length > 0 ? `- Tests / specs: ${testFiles.join(', ')}` : '- Tests / specs: none detected',
    docTitles.length > 0 ? `- Docs loaded: ${docTitles.join(', ')}` : null,
    tokens.length > 0 ? `- Request keywords: ${tokens.join(', ')}` : null,
    relevant.length > 0 ? `- Files most relevant to this request: ${relevant.join(', ')}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatTaskSection(task) {
  if (!task) return '';
  const criteria = Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0
    ? task.acceptance_criteria.map((entry) => `- ${entry}`).join('\n')
    : '- No explicit acceptance criteria yet. You must still verify the behavior before finishing.';
  const changedPaths = Array.isArray(task.changed_paths) && task.changed_paths.length > 0
    ? task.changed_paths.slice(0, 10).join(', ')
    : 'none yet';
  return [
    'ACTIVE TASK WORKSPACE:',
    `- Title: ${task.title}`,
    task.request ? `- Request: ${task.request}` : null,
    `- Status: ${task.status ?? 'active'}`,
    `- Workspace: ${task.workspace_key ?? ''}`,
    `- Changed paths so far: ${changedPaths}`,
    '- This task is isolated from the main project until it is reviewed and applied.',
    'ACCEPTANCE CRITERIA:',
    criteria,
  ].filter(Boolean).join('\n');
}

function buildEnhancedPrompt(message, files, docs, mode, appTesting = false, runtimeContext = null, filePolicy = normalizeFilePolicy(), extraContext = {}) {
  const fastMode = !!extraContext.fastMode;
  const autonomy = normalizeAgentAutonomy(extraContext.autonomy);
  const visibleFiles = filterVisibleFiles(files, filePolicy);
  const steeringDocs = docs.filter((doc) => doc.title === '.luxi.md');
  const regularDocs = docs.filter((doc) => doc.title !== '.luxi.md');
  const selectedContext = selectContextFiles(
    visibleFiles,
    message,
    filePolicy,
    fastMode ? 7 : autonomy === 'max' ? 16 : 12,
  );
  const parts = [];
  parts.push(`USER REQUEST:\n${message}`);
  if (fastMode) {
    parts.push('\nOPERATING MODE:\n- Fast mode is enabled. Prefer the shortest reliable path, keep context narrow, and avoid unnecessary detours.');
  }
  if (autonomy === 'guided') {
    parts.push('\nAUTONOMY:\n- Guided autonomy is enabled. Favor smaller safe steps, surface blockers quickly, and avoid broad speculative work.');
  } else if (autonomy === 'max') {
    parts.push('\nAUTONOMY:\n- Max autonomy is enabled. Behave like a veteran principal engineer: challenge weak assumptions, inspect root causes deeply, and keep iterating until the task is truly complete or externally blocked.');
  }
  if (extraContext.projectMemory) {
    parts.push(`\nPROJECT MEMORY:\n${extraContext.projectMemory}`);
  }
  if (extraContext.securityProfile) {
    parts.push(`\nSECURITY SCOPE:\n${extraContext.securityProfile}`);
  }
  if (extraContext.securityFindings) {
    parts.push(`\nRECENT SECURITY FINDINGS:\n${extraContext.securityFindings}`);
  }
  if (extraContext.task) {
    parts.push(`\n${formatTaskSection(extraContext.task)}`);
  }
  if (steeringDocs.length > 0) {
    parts.push(`\nPROJECT STEERING (.luxi.md):\n${steeringDocs.map((doc) => String(doc.content ?? '').slice(0, fastMode ? 7000 : 12000)).join('\n\n')}`);
  }
  if (regularDocs.length > 0) {
    parts.push(`\nPROJECT DOCUMENTATION:\n${regularDocs.map((d) => `### ${d.title}\n${String(d.content ?? '').slice(0, fastMode ? 3500 : 6000)}`).join('\n\n')}`);
  }
  if (visibleFiles.length > 0) {
    parts.push(`\nPROJECT MAP:\n${buildProjectMapSummary(message, visibleFiles, docs, filePolicy)}`);
    if (selectedContext.inlineAll) {
      parts.push(`\nCURRENT PROJECT FILES:\n${selectedContext.selected.map((file) => formatFileSnippet(file, fastMode ? 5000 : 8000)).join('\n\n')}`);
    } else {
      parts.push(`\nRELEVANT FILE CONTENT:\n${selectedContext.selected.map((file) => formatFileSnippet(file, fastMode ? 3200 : 5000)).join('\n\n')}`);
      parts.push(`\nVISIBLE FILE LIST:\n${summarizeVisibleFilePaths(visibleFiles, fastMode ? 90 : 160)}`);
    }
  } else {
    parts.push('\nNo files in project yet. Start fresh.');
  }
  const filePolicySummary = formatFilePolicy(filePolicy);
  if (filePolicySummary) {
    parts.push(`\nFILE POLICY:\n${filePolicySummary}`);
  }
  if (runtimeContext) {
    parts.push(`\nCURRENT RUNTIME CAPABILITIES:\n${formatRuntimeContext(runtimeContext)}`);
  }
  if (mode === 'agent') {
    parts.push('\nINSTRUCTIONS: Use the available tools to fulfill the request. Be thorough, write complete working code, create all necessary files. Never truncate file contents.');
  }
  if (runtimeContext?.websiteTask) {
    parts.push('\nLIVE WEBSITE TASK RULES: This request involves a public website or browser flow. Always use the persistent browser sessionId from the runtime context. Inspect before acting with page_snapshot, screenshot, logs, challenge_status, frame_tree, or query_all. After each important action, verify the page state changed as expected. If an action fails, diagnose the failure and retry with a changed plan instead of repeating the same step. If visual analysis is available, use it to understand the page before deciding the next click or fill. If the task is blocked, explain the exact blocker you hit, such as missing credentials, missing inbox access, OTP confirmation, CAPTCHA, anti-bot protection, or an unavailable selector.');
  }
  if (appTesting) {
    parts.push('\nAPP TESTING MODE: Before you declare success on any runnable app or UI change, you must validate it yourself. Start or reuse the dev server with start_background_command when it needs to stay alive, open the app with browser_action, exercise the requested flow, inspect any failures, fix them, and re-test. If browser testing is impossible because the runner or Puppeteer is unavailable, explicitly say so and fall back to the best available runtime checks.');
  }
  return parts.join('\n');
}

function normalizeAgentProfile(profile) {
  return profile === 'design' || profile === 'research' || profile === 'autofix' || profile === 'security' ? profile : 'builder';
}

function normalizeAgentAutonomy(autonomy) {
  return autonomy === 'guided' || autonomy === 'max' ? autonomy : 'standard';
}

function buildProfilePrompt(agentProfile) {
  if (agentProfile === 'design') {
    return `\n\n## DESIGN MODE
- Behave like a senior product designer-engineer, not a generic coder.
- Preserve the existing design system when one exists. If the UI is weak or inconsistent, improve hierarchy, spacing, states, copy, and interaction polish intentionally.
- Treat imported Figma, design docs, and screenshots as product constraints, not vague inspiration.
- For UI work, prefer visual verification through browser inspection and refine until the result looks deliberate.`;
  }

  if (agentProfile === 'security') {
    return `\n\n## SECURITY RESEARCH MODE
- Behave like a security engineer, not a generic assistant.
- Start by mapping scope, attack surface, auth/session flows, API specs, and sensitive files before proposing fixes.
- Prefer concrete evidence: failing requests, vulnerable sinks, reproduction steps, screenshots, console logs, callback hits, and exact affected paths.
- When you find an issue, save it as a finding with severity, impact, recommendation, repro, and regression_check instead of keeping it only in free text.
- When you patch a vulnerability, prove the exploit path is gone and capture that proof in fix_validation or a report.
- Use security_scope, surface_map, run_security_scan, list_findings, save_finding, generate_security_report, and create_oast_session when they materially help complete the task.`;
  }

  if (agentProfile === 'research') {
    return `\n\n## RESEARCH MODE
- Prefer project docs, web_search, and browse_website before you settle on libraries, APIs, or implementation choices.
- When the user is choosing between options, compare tradeoffs clearly and keep code changes intentional.
- In your final summary, mention the facts or references that drove the decision.`;
  }

  if (agentProfile === 'autofix') {
    return `\n\n## AUTOFIX MODE
- Reproduce the bug or broken flow first.
- Make the smallest safe fix that addresses the root cause.
- Run commands or browser checks after each fix and keep iterating until the issue is resolved or a concrete blocker remains.
- In your final summary, explain the root cause and the exact validation you performed.`;
  }

  return `\n\n## BUILD MODE
- Default to shipping the requested feature end to end.
- Create missing files, wire up dependencies, and validate the result when tools are available.`;
}

function buildPlanEvent(message, files, docs, appTesting = false, agentProfile = 'builder', runtimeContext = null, filePolicy = normalizeFilePolicy(), extraContext = {}) {
  const text = String(message ?? '').toLowerCase();
  const steps = [];
  const normalizedProfile = normalizeAgentProfile(agentProfile);
  const autonomy = normalizeAgentAutonomy(extraContext.autonomy);
  const fastMode = !!extraContext.fastMode;

  steps.push(
    files.length > 0
      ? 'Inspect the current project files and understand the request.'
      : 'Start from a clean project and create the needed files.',
  );

  if (/\b(fix|bug|broken|issue|error|failing|debug)\b/.test(text)) {
    steps.push('Trace the problem to the relevant files and apply the smallest safe fix.');
  } else if (/\b(build|create|make|add|implement|scaffold|generate|feature|page|component|api|backend|frontend)\b/.test(text)) {
    steps.push('Create or update the files needed for the requested feature.');
  } else {
    steps.push('Make the requested project changes in the relevant files.');
  }

  if (runtimeContext?.websiteTask || looksLikeLiveWebsiteTask(message)) {
    steps.push('Launch or reuse the website session, inspect the page, and verify each browser action instead of guessing.');
    steps.push('If the browser step fails, inspect logs, snapshots, blockers, and visual output before retrying with a changed plan.');
  }

  if (normalizedProfile === 'research') {
    steps.push('Gather the key docs or web context before settling on the solution.');
  }

  if (normalizedProfile === 'design') {
    steps.push('Inspect the current UI, design references, and user flow before making visual or interaction changes.');
    steps.push('Use design docs or Figma imports when available, then verify the result visually instead of treating UI work as text only.');
  }

  if (normalizedProfile === 'security') {
    steps.push('Map the scope, auth surface, API specs, and attack surface before choosing the highest-risk paths.');
    steps.push('Capture or update findings with severity, evidence, repro, and remediation instead of keeping security notes ephemeral.');
  }

  if (normalizedProfile === 'autofix') {
    steps.push('Reproduce the problem, apply a focused fix, and keep validating until it passes.');
  }

  if (extraContext.task) {
    steps.push('Work inside the isolated task workspace so the main project stays unchanged until review/apply.');
    if (Array.isArray(extraContext.task.acceptance_criteria) && extraContext.task.acceptance_criteria.length > 0) {
      steps.push(`Satisfy the acceptance criteria: ${extraContext.task.acceptance_criteria.join(' | ')}`);
    }
  }

  if (docs.length > 0) {
    steps.push('Use the attached project docs as context while making changes.');
  }

  const filePolicySummary = formatFilePolicy(filePolicy);
  if (filePolicySummary) {
    steps.push('Respect the current file policy and avoid modifying locked or ignored paths.');
  }

  if (appTesting) {
    steps.push('Run commands and browser checks to validate the result end to end.');
  } else if (/\b(test|build|run|start|install|dev|server|deploy|validate|check)\b/.test(text)) {
    steps.push('Run the relevant commands to validate the result.');
  }

  if (fastMode) {
    steps.push('Stay on the shortest reliable path and avoid unnecessary exploration or over-scaffolding.');
  }

  if (autonomy === 'max') {
    steps.push('Own the outcome like a veteran engineer: challenge weak assumptions, diagnose root causes, and keep iterating until the task is actually complete.');
  }

  steps.push('Report what changed, why it changed, and any remaining blockers.');

  return {
    type: 'plan',
    title: normalizedProfile === 'research'
      ? 'Research plan'
      : normalizedProfile === 'design'
      ? 'Design plan'
      : normalizedProfile === 'autofix'
      ? 'Autofix plan'
      : normalizedProfile === 'security'
      ? 'Security plan'
      : 'Build plan',
    steps,
  };
}

function describeToolIntent(name, args) {
  const path = args?.path ? String(args.path) : '';
  const cwd = args?.cwd ? String(args.cwd) : '';
  const command = args?.command ? String(args.command) : '';

  if (name === 'write_file') return `Creating ${path} to implement the requested change.`;
  if (name === 'patch_file') return `Applying a structured patch to ${path} for targeted multi-step edits.`;
  if (name === 'edit_file') return `Updating ${path} to apply the requested change.`;
  if (name === 'batch_write_files') {
    const count = Array.isArray(args?.files) ? args.files.length : 0;
    return `Writing ${count || 'multiple'} file${count === 1 ? '' : 's'} so the requested feature is fully scaffolded.`;
  }
  if (name === 'read_file') return `Reading ${path} to inspect the current implementation.`;
  if (name === 'delete_file') return `Removing ${path} because it is no longer needed for the requested change.`;
  if (name === 'rename_file') return `Renaming ${String(args?.old_path ?? '')} to ${String(args?.new_path ?? '')}.`;
  if (name === 'list_files') return 'Reviewing the current project file tree before making changes.';
  if (name === 'project_map') return `Building a project map${args?.query ? ` for ${String(args.query)}` : ''} to find the most relevant files and entrypoints.`;
  if (name === 'project_memory') return 'Loading persistent repo memory, active tasks, and working commands before deciding the next step.';
  if (name === 'search_files') return `Searching the project files for ${String(args?.query ?? '')}.`;
  if (name === 'grep') return `Searching code content for ${String(args?.pattern ?? '')}.`;
  if (name === 'browse_website') return `Opening ${String(args?.url ?? '')} to gather the needed reference material.`;
  if (name === 'web_search') return `Searching the web for ${String(args?.query ?? '')}.`;
  if (name === 'github_context') return `Loading GitHub ${String(args?.kind ?? 'repo')} context so the agent can reason with real PR, issue, commit, or check data.`;
  if (name === 'security_scope') return 'Loading the current allowed hosts, auth profiles, and continuous scan rules before touching a target.';
  if (name === 'surface_map') return 'Mapping routes, auth flows, forms, API specs, and external hosts to understand the attack surface.';
  if (name === 'api_spec_summary') return 'Summarizing the discovered API specification so tests can target real endpoints and schemas.';
  if (name === 'run_security_scan') return 'Running built-in and custom security checks against the current repo context.';
  if (name === 'list_findings') return 'Loading saved findings so the agent can avoid duplicate work and build on existing evidence.';
  if (name === 'save_finding') return `Saving a structured security finding for ${String(args?.title ?? 'the current issue')}.`;
  if (name === 'generate_security_report') return 'Generating an evidence pack and report from the current security findings.';
  if (name === 'create_oast_session') return 'Creating a callback URL for blind SSRF, webhook, or out-of-band verification.';
  if (name === 'traffic_capture_summary') return 'Loading a replayable HAR capture with reverse-engineering hints, auth indicators, and exact request templates.';
  if (name === 'replay_traffic_request') return 'Replaying a HAR-derived request as faithfully as possible so the agent can compare live behavior to the original capture.';
  if (name === 'replay_traffic_flow') return 'Replaying a multi-step HAR flow with cookie carryover so the agent can mimic sessioned behavior, logins, and stateful testers flows.';
  if (name === 'reverse_engineer_project') return 'Reverse engineering the codebase and bundles to extract hidden endpoints, auth clues, source maps, GraphQL operations, and websocket targets.';
  if (name === 'traffic_flow_graph') return 'Reconstructing the request chain from captured traffic so the agent can follow stateful multi-step flows.';
  if (name === 'mutate_traffic_request') return 'Mutating a captured request and replaying it to probe validation edges, auth behavior, and hidden backend branches.';
  if (name === 'run_command') return `Running ${command}${cwd ? ` in ${cwd}` : ''} to validate or operate on the project.`;
  if (name === 'start_background_command') return `Starting ${command}${cwd ? ` in ${cwd}` : ''} as a reusable background process for app testing.`;
  if (name === 'check_background_command') return `Checking background process ${String(args?.sessionId ?? '')} for readiness or recent logs.`;
  if (name === 'stop_background_command') return `Stopping background process ${String(args?.sessionId ?? '')}.`;
  if (name === 'install_package') return `Installing dependencies${cwd ? ` in ${cwd}` : ''} so the project can run correctly.`;
  if (name === 'execute_code') return `Executing ${String(args?.language ?? 'code')} to verify behavior directly.`;
  if (name === 'read_local_file') return `Reading a local runner file: ${String(args?.path ?? '')}.`;
  if (name === 'write_local_file') return `Writing a local runner file: ${String(args?.path ?? '')}.`;
  if (name === 'list_local_dir') return `Inspecting the runner directory ${String(args?.dir ?? '.')}.`;
  if (name === 'sync_runner_workspace') return 'Importing runner-side file changes back into the project so the IDE and agent stay aligned.';
  if (name === 'browser_action') {
    const action = String(args?.action ?? 'unknown');
    const retries = args?.retries !== undefined ? ` with retries=${args.retries}` : '';
    return `Using browser automation (${action}${retries}) to verify or modify the live UI flow.`;
  }
  return `Using ${name} to move the task forward.`;
}

const AGENT_SYSTEM_PROMPT = `You are LUXI, a world-class AI software engineer. You understand plain English and do exactly what the user asks — no setup required, no technical knowledge needed.

## HOW TO RESPOND — FOLLOW THIS WITHOUT EXCEPTION

**Decide what the user wants:**
- If they want something BUILT, CHANGED, or FIXED → use tools to make it happen. Write code to files, run commands, search the web. Never explain what you're going to do, just do it.
- If they're asking a QUESTION or want an EXPLANATION → answer clearly in plain English. You may show code in chat for explanations only.
- If it's AMBIGUOUS → default to taking action (build it).

**Code always goes into files, never chat:**
When building or modifying code, use write_file / patch_file / edit_file / batch_write_files. Never paste implementation code into the chat response — the user wants it done, not described.

**Critique weak solutions instead of obeying them blindly:**
- If the user suggests an approach, evaluate it critically.
- If it is solid, use it.
- If a better solution exists, explain why and choose the better solution.

**Failure recovery is part of the task:**
- If a step fails, inspect the actual error, logs, page state, or runtime output.
- Change the plan before retrying.
- Do not repeat the same failed action unchanged.
- Do not declare success until the result is verified or a concrete external blocker remains.

## Your Capabilities (Tools Available)

### File Operations
- **write_file(path, content)** — Create or overwrite any file with complete content
- **read_file(path)** — Read the full content of a file
- **patch_file(path, operations)** — Apply multiple targeted edits like replace, replace_all, insert_before, insert_after, prepend, or append
- **edit_file(path, old_str, new_str)** — Make targeted edits by replacing exact text
- **delete_file(path)** — Remove a file
- **rename_file(old_path, new_path)** — Rename or move a file
- **list_files()** — List all project files
- **project_map(query?)** — Summarize the project stack, likely entrypoints, important scripts, tests, and the files most relevant to a request
- **project_memory()** — Load persistent repo memory, active tasks, known commands, and high-level architecture notes
- **search_files(query)** — Search file names by pattern
- **grep(pattern, path?)** — Search file contents for a pattern
- **batch_write_files(files)** — Write multiple files at once efficiently

### Web & Research
- **browse_website(url)** — Fetch and read any website, API docs, GitHub repo, or web page (static HTML fetch)
- **web_search(query, num_results?)** — Search the web for current information, documentation, tutorials, packages, APIs, research papers. Use this BEFORE browsing to find the right URL.
- **github_context(kind, ...)** — Load real GitHub pull request, issue, commit, or CI check context when the project is connected to GitHub.

### Security Workflow
- **security_scope()** — Load the allowed hosts, auth profiles, blocked hosts, and continuous scan config for this project.
- **surface_map()** — Build an attack-surface summary: routes, auth files, forms, API specs, external hosts, CI/IaC files, and scripts.
- **api_spec_summary()** — Extract a concise API-spec summary from OpenAPI or Swagger files/docs when they exist.
- **run_security_scan(persist?)** — Run built-in repo heuristics plus custom checks for secrets, risky sinks, command injection patterns, path traversal, CI/IaC issues, and other security smells.
- **list_findings(status?)** — Load saved structured findings with severity, repro, evidence, and remediation.
- **save_finding(...)** — Persist a structured finding so security work survives retries and can be reviewed later.
- **generate_security_report(title?, finding_ids?)** — Build a markdown evidence pack and report from the current findings and scope.
- **create_oast_session(label?)** — Generate a unique callback URL for blind SSRF, webhook, XXE, or other out-of-band verification.
- **traffic_capture_summary(capture_id)** — Load an imported HAR capture with reverse-engineering notes, replayable entries, and cURL/fetch templates.
- **replay_traffic_request(capture_id, entry_id)** — Replay one HAR entry with the captured method, headers, cookies, and body, then compare the live result to the original response.
- **replay_traffic_flow(capture_id, chain_index?)** — Replay a multi-step HAR flow with cookie carryover and return a reusable Node replay script for the chain.
- **reverse_engineer_project()** — Analyze source and bundled client code for hidden endpoints, auth/storage clues, source maps, GraphQL operations, dynamic imports, and websocket targets.
- **traffic_flow_graph(capture_id)** — Reconstruct request chains, cookie handoffs, referer edges, and same-host flow segments from a HAR capture.
- **mutate_traffic_request(capture_id, entry_id, mutations)** — Apply controlled header/query/body mutations to a HAR-derived request and replay it.

### Real Command Execution (if runner is connected)
- **run_command(command, cwd?, timeout?)** — Execute REAL shell commands. Returns actual output. Use for: npm install, pip install, git commands, running tests, building projects, starting servers, ANY shell operation. NOT simulated.
- **start_background_command(command, cwd?, sessionId?, port?/url?)** — Start a long-running dev server or watcher and keep it alive for later browser checks.
- **check_background_command(sessionId, port?/url?)** — Inspect a background process, tail recent logs, and optionally check whether its local URL is responding.
- **stop_background_command(sessionId)** — Stop a background process cleanly when you no longer need it.
- **install_package(packages, manager?)** — Install npm/pip/yarn packages. Faster than run_command for package installs.
- **execute_code(code, language, stdin?)** — Execute code directly and get real output. Supports: python, javascript, bash, ruby, go, rust (if installed).
- **read_local_file(path)** — Read a file from the runner's local filesystem (outside project sandbox).
- **write_local_file(path, content)** — Write a file to the runner's local filesystem.
- **list_local_dir(dir?)** — List files in the runner's local filesystem.
- **sync_runner_workspace()** — Import files changed on the runner back into the project database. Use this after git/scaffold/codegen/shell commands that modified files outside write_file/edit_file/patch_file.

### Browser Automation (if runner + Puppeteer installed)
- **browser_action(action, ...)** — Control a REAL Chromium browser. Common actions: navigate, click, smart_click, type, fill, smart_fill_form, dom_mutate, wait_for, wait_for_text, get_text, get_html, screenshot, current_url, evaluate, dom_map, frame_tree, page_snapshot, logs, challenge_status, element_info.
- For forms, prefer label when a stable CSS selector is unknown. For buttons or links, prefer visible text.
- If the page uses iframes, inspect with frame_tree or page_snapshot and target a frame with frameName, frameUrl, or frameIndex.
- For navigation, you can pass waitUntil such as domcontentloaded when a site never becomes fully idle.
- For DOM-heavy pages, inspect first with page_snapshot, dom_map, get_html, or query_all, then use evaluate for direct DOM mutation when needed.
- You can pass retries and retryDelayMs to auto-retry flaky browser steps. For forms, use smart_fill_form with fields[] and optional submit.
- If a browser step fails, use logs to read console errors, page errors, and request failures before concluding the site is broken.
- If challenge_status reports a blocker (CAPTCHA/anti-bot/human verification), stop blind retries and report that blocker clearly.
- If browser_action is available, you CAN interact with live public websites. Do not claim you fundamentally lack browser capability when this tool is available.
- If a task is blocked by missing runner/browser setup, email inbox access, CAPTCHAs, OTP confirmation, or credentials the user has not provided, explain that specific blocker plainly instead of claiming a universal inability.
- After run_command or other runner-side operations that modify files directly, call sync_runner_workspace before reading files again or declaring success.

## Capability Honesty
- Do not use generic canned disclaimers like "I do not have a web browser", "I only work inside this project", or "I cannot interact with websites" unless the runtime status for this request explicitly shows those tools are unavailable.
- If the user asks about a public website and browser automation is available, try browser_action before you conclude the task is blocked.
- When the task is blocked, report the exact blocker you encountered after trying, not a broad statement about your architecture.

## How You Work
1. Read the request. Understand the intent. Act immediately.
2. For builds/changes: use batch_write_files for new projects, patch_file for multi-step targeted edits, edit_file for simple exact replacements
2a. When the repo is large or unfamiliar, use project_map first to orient yourself before reading files one by one.
2b. When available, use project_memory before a large task, retry, or refactor so you do not repeat old mistakes or forget repo-specific commands.
3. Research when needed: web_search → browse_website to find docs, APIs, packages
3a. When the repo is on GitHub and the task mentions PRs, issues, CI, failing checks, regressions, or recent changes, use github_context instead of guessing.
3b. For security tasks, load security_scope and surface_map early, then save findings as you learn instead of keeping security evidence only in your free-text summary.
3c. When HAR traffic exists, use traffic_capture_summary before guessing an API flow, and replay_traffic_request when you need to mimic the original client behavior closely.
3d. For multi-step sessioned behavior like login, checkout, or onboarding, use traffic_flow_graph and replay_traffic_flow instead of replaying isolated requests one by one.
3e. For minified frontends or unknown clients, use reverse_engineer_project and traffic_flow_graph before guessing hidden endpoints, auth refresh flows, or GraphQL behavior.
4. Run real commands when runner is connected: install packages, run tests, start servers
4a. For local app testing, prefer start_background_command + check_background_command over one-shot dev server commands so the browser can reuse the running app.
4b. If shell commands, git operations, or generators changed files on the runner, sync them back with sync_runner_workspace so your next reads and summaries use the real current project state.
5. Never truncate — write complete, full implementations
6. After doing something, give a SHORT plain-English summary (what changed, any next steps)
7. For build/change tasks, your final summary must explicitly cover: what changed, why it changed, and how you verified it.
8. When you changed files, prefer this short wrap-up format:
   Changed: ...
   Why: ...
   Verification: ...
9. Respect project steering instructions and file policy constraints when they are present.
10. For website tasks, use a persistent browser session, inspect visually first, verify each major step, and keep iterating until success or a concrete blocker remains.
11. If an isolated task workspace is active, keep all edits there until review/apply. Do not describe the task as complete until its acceptance criteria and validations are satisfied.
12. For security work, do not stop at “I found something.” Capture evidence, severity, remediation, and the regression proof that shows whether the issue still reproduces after a fix.

## Code Standards
- Production-quality, idiomatic code for the language/framework in use
- Proper error handling and types
- Always install required packages before using them

## Tone
- Talk to users like a smart colleague, not a manual
- Short summaries after actions ("Done — added dark mode toggle to the header")
- For questions: clear, direct answers in plain English`;

function buildSystemPrompt(mode, appTesting = false, runtimeContext = null, agentProfile = 'builder') {
  const runtimeSection = runtimeContext
    ? `\n\n## Runtime Status For This Request\n${formatRuntimeContext(runtimeContext)}`
    : '';
  const profileSection = buildProfilePrompt(normalizeAgentProfile(agentProfile));
  const autonomy = normalizeAgentAutonomy(runtimeContext?.autonomy);
  const autonomySection = autonomy === 'guided'
    ? `\n\n## GUIDED AUTONOMY\n- Prefer smaller, safer steps.\n- Surface blockers quickly.\n- Avoid sprawling refactors unless the evidence clearly requires them.`
    : autonomy === 'max'
    ? `\n\n## MAX AUTONOMY\n- Behave like a seasoned principal engineer with deep product judgment.\n- Take ownership of the task outcome, not just the first plausible patch.\n- Challenge weak approaches, investigate root causes, and keep going until the result is verified or the blocker is truly external.`
    : '';
  const fastSection = runtimeContext?.fastMode
    ? `\n\n## FAST MODE\n- Bias toward the shortest reliable path.\n- Keep context tight, avoid unnecessary prose, and prefer direct validation over long explanation.`
    : '';

  if (mode !== 'agent' || !appTesting) return `${AGENT_SYSTEM_PROMPT}${runtimeSection}${profileSection}${autonomySection}${fastSection}`;

  return `${AGENT_SYSTEM_PROMPT}${runtimeSection}${profileSection}${autonomySection}${fastSection}

## APP TESTING MODE
- Treat browser validation as part of the task, not an optional extra.
- After changing a runnable app, you MUST verify the user-facing behavior yourself before finishing.
- Preferred flow:
  1. Inspect the project and determine how to run it.
  2. Install missing dependencies if needed.
  3. Start or reuse the app/dev server with start_background_command when it needs to stay alive, or run_command when it exits quickly.
  4. Use browser_action with a persistent sessionId to open the app and exercise the requested flow.
  5. If the browser shows errors, broken UI, failing interactions, or unexpected output, fix the code and test again.
  6. Only stop when the requested behavior works or when you can clearly explain the concrete blocker.
- Always mention the browser/runtime checks you actually performed in the final summary.
- If runner/browser automation is unavailable, say that clearly and fall back to the best available validation.`;
}

function shouldForceToolCalls(mode, userMessage, agentProfile = 'builder', options = {}) {
  if (mode !== 'agent') return false;

  const normalizedProfile = normalizeAgentProfile(agentProfile);
  if (normalizedProfile === 'design' || normalizedProfile === 'research' || normalizedProfile === 'autofix' || normalizedProfile === 'security') return true;
  if (normalizeAgentAutonomy(options.autonomy) === 'max') return true;
  if (options.websiteMode || options.appTesting) return true;

  const text = String(userMessage ?? '').trim().toLowerCase();
  if (!text) return false;

  const endsAsQuestion = text.endsWith('?');
  const imperativePattern = /\b(build|create|make|add|write|update|edit|change|fix|delete|remove|rename|refactor|scaffold|install|run|start|setup|set up|implement|generate|test)\b/;
  const artifactPattern = /\b(file|files|project|app|api|component|page|screen|route|endpoint|backend|frontend|server|database|schema|migration|readme|package\.json)\b/;
  const websiteTaskPattern = /\b(open|visit|browse|navigate|go to|click|type|fill|submit|sign up|signup|log in|login|otp|captcha|website|site|form)\b/;
  const urlPattern = /https?:\/\/|\b[a-z0-9-]+\.(com|net|org|io|app|ai|co|dev|in|edu|gov)\b/;

  if (endsAsQuestion && !imperativePattern.test(text) && !websiteTaskPattern.test(text) && !urlPattern.test(text)) {
    return false;
  }

  return imperativePattern.test(text)
    || artifactPattern.test(text)
    || websiteTaskPattern.test(text)
    || urlPattern.test(text);
}

async function getRuntimeContext(message, options = {}) {
  const runtimeContext = {
    runnerConfigured: false,
    runnerReachable: false,
    browserAvailable: false,
    runnerUrl: '',
    runnerError: '',
    websiteTask: !!options.websiteMode || looksLikeLiveWebsiteTask(message),
    browserSessionId: String(options.browserSessionId ?? '').trim(),
    manualBrowser: !!options.manualBrowser,
    visualBrowserAnalysis: false,
  };

  try {
    const runner = await getRunnerConfig();
    runtimeContext.runnerConfigured = !!runner.runner_url;
    runtimeContext.runnerUrl = runner.runner_url || '';
    if (runner.runner_url) {
      const health = await runnerHealthCheck();
      runtimeContext.runnerReachable = true;
      runtimeContext.browserAvailable = health?.puppeteer === 'available';
    }
  } catch (error) {
    runtimeContext.runnerError = String(error);
  }

  return runtimeContext;
}

function buildGeminiToolConfig(forceToolCalls) {
  if (!forceToolCalls) return undefined;

  return {
    functionCallingConfig: {
      mode: 'ANY',
      allowedFunctionNames: GEMINI_TOOL_DECLARATIONS.map((tool) => tool.name),
    },
  };
}

function describeGeminiNoContent(prefix, candidates = [], promptFeedback) {
  const finishReason = candidates.find((candidate) => candidate?.finishReason)?.finishReason;
  const blockReason = promptFeedback?.blockReason;
  const details = [finishReason ? `finishReason=${finishReason}` : null, blockReason ? `blockReason=${blockReason}` : null]
    .filter(Boolean)
    .join(', ');
  return details ? `${prefix} (${details})` : prefix;
}

function formatToolError(error) {
  if (error instanceof Error) {
    const cause = error.cause ? ` | cause: ${String(error.cause)}` : '';
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

const RETRYABLE_BROWSER_ACTIONS = new Set([
  'navigate',
  'goto',
  'click',
  'smart_click',
  'type',
  'fill',
  'smart_fill_form',
  'wait_for',
  'wait_for_text',
  'query_all',
  'dom_map',
  'page_snapshot',
  'frame_tree',
  'element_info',
  'dom_mutate',
]);

function toInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function toNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isChallengeBlockerMessage(message) {
  const text = String(message ?? '').toLowerCase();
  if (!text) return false;

  return (
    text.includes('captcha')
    || text.includes('hcaptcha')
    || text.includes('recaptcha')
    || text.includes('turnstile')
    || text.includes('verify you are human')
    || text.includes('human verification')
    || text.includes('press and hold')
    || text.includes('press & hold')
    || text.includes('cloudflare')
    || text.includes('blocked by anti-bot')
    || text.includes('access denied')
    || text.includes('request blocked')
    || text.includes('[blocked:')
  );
}

function extractJsonObjectFromText(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const candidate = raw.slice(start);
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractBlockerFromBrowserFailure(message) {
  const parsed = extractJsonObjectFromText(message);
  if (!parsed || typeof parsed !== 'object') return null;
  const blocker = parsed.blocker ?? parsed.challenge;
  if (!blocker || typeof blocker !== 'object') return null;
  return blocker.detected ? blocker : null;
}

function formatBlockerSummary(blocker) {
  if (!blocker || typeof blocker !== 'object') return '';
  const summary = String(blocker.summary ?? 'Automation appears blocked by site protection.');
  const kind = blocker.kind ? ` (${blocker.kind})` : '';
  const hints = Array.isArray(blocker.hints) ? blocker.hints.filter(Boolean).slice(0, 2) : [];
  const hintText = hints.length > 0 ? ` Hints: ${hints.join(' ')}` : '';
  return `${summary}${kind}${hintText}`;
}

function isRetryableBrowserErrorMessage(message) {
  const text = String(message ?? '').toLowerCase();
  if (!text) return false;
  if (isChallengeBlockerMessage(text)) return false;

  return (
    text.includes('timeout')
    || text.includes('err_connection_refused')
    || text.includes('err_connection_reset')
    || text.includes('err_name_not_resolved')
    || text.includes('execution context was destroyed')
    || text.includes('node is detached from document')
    || text.includes('target closed')
    || text.includes('cannot find context with specified id')
    || text.includes('could not find a matching element')
    || text.includes('navigation timed out')
    || text.includes('failed to fetch')
    || text.includes('socket hang up')
  );
}

function getBrowserRetryCount(action, args) {
  const explicit = args.retries;
  if (explicit !== undefined) {
    return toInt(explicit, 0, 0, 4);
  }

  const normalized = String(action ?? '').toLowerCase();
  if (normalized === 'navigate' || normalized === 'goto') return 2;
  if (normalized === 'smart_fill_form' || normalized === 'smart_click') return 2;
  if (normalized === 'click' || normalized === 'fill' || normalized === 'type' || normalized === 'wait_for' || normalized === 'wait_for_text') return 1;
  return 0;
}

function getBrowserAttemptPayload(basePayload, action, attemptIndex) {
  if (attemptIndex === 0) return basePayload;

  const nextPayload = { ...basePayload };
  const currentTimeout = toNumber(nextPayload.timeout, 30000, 1000, 180000);
  nextPayload.timeout = toInt(Math.round(currentTimeout * (1 + 0.25 * attemptIndex)), currentTimeout, 1000, 180000);

  if ((action === 'navigate' || action === 'goto') && !nextPayload.waitUntil) {
    nextPayload.waitUntil = attemptIndex === 1 ? 'domcontentloaded' : 'load';
  }

  if ((action === 'click' || action === 'smart_click') && nextPayload.selector && attemptIndex >= 1) {
    nextPayload.action = 'smart_click';
  }

  return nextPayload;
}

function summarizeBrowserLogs(logs) {
  if (!logs || typeof logs !== 'object') return '';
  const consoleCount = Array.isArray(logs.console) ? logs.console.length : 0;
  const pageErrorCount = Array.isArray(logs.pageErrors) ? logs.pageErrors.length : 0;
  const requestFailureCount = Array.isArray(logs.requestFailures) ? logs.requestFailures.length : 0;
  if (!consoleCount && !pageErrorCount && !requestFailureCount) return '';
  return `Recent logs: console=${consoleCount}, pageErrors=${pageErrorCount}, requestFailures=${requestFailureCount}`;
}

const SAFE_MAX_OUTPUT_TOKENS = 8192;
const FAST_MAX_OUTPUT_TOKENS = 4096;
const MAX_AUTONOMY_OUTPUT_TOKENS = 12288;
const EXCLUSIVE_MAX_OUTPUT_TOKENS_LIMIT = 65536;
const PROVIDER_REQUEST_TIMEOUT_MS = 90000;
const PROVIDER_MAX_RETRIES = 2;

function getAgentHistoryWindow(agentRuntime = null) {
  if (agentRuntime?.fastMode) return 6;
  if (normalizeAgentAutonomy(agentRuntime?.autonomy) === 'max') return 14;
  if (normalizeAgentAutonomy(agentRuntime?.autonomy) === 'guided') return 8;
  return 10;
}

function getAgentLoopLimit(agentRuntime = null) {
  const autonomy = normalizeAgentAutonomy(agentRuntime?.autonomy);
  if (agentRuntime?.fastMode) return autonomy === 'max' ? 14 : 8;
  if (autonomy === 'guided') return 10;
  if (autonomy === 'max') return 28;
  return 20;
}

function getAgentMaxOutputTokens(agentRuntime = null) {
  const autonomy = normalizeAgentAutonomy(agentRuntime?.autonomy);
  if (agentRuntime?.fastMode) return FAST_MAX_OUTPUT_TOKENS;
  if (autonomy === 'max') return MAX_AUTONOMY_OUTPUT_TOKENS;
  return SAFE_MAX_OUTPUT_TOKENS;
}

function buildGenerationConfig(agentRuntime = null) {
  const autonomy = normalizeAgentAutonomy(agentRuntime?.autonomy);
  return {
    temperature: agentRuntime?.fastMode ? 0.35 : autonomy === 'guided' ? 0.45 : 0.7,
    maxOutputTokens: Math.min(getAgentMaxOutputTokens(agentRuntime), EXCLUSIVE_MAX_OUTPUT_TOKENS_LIMIT - 1),
  };
}

async function getPlatformSettings() {
  const settings = await getSettings(['provider', 'model', 'gemini_key', 'anthropic_key', 'openai_key', 'vertex_key', 'kimi_key']);
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

function isRetryableProviderError(error) {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  if (!text) return false;
  return (
    text.includes('timed out')
    || text.includes('timeout')
    || text.includes('network')
    || text.includes('fetch failed')
    || text.includes('socket hang up')
    || text.includes('econnreset')
    || text.includes('temporarily unavailable')
    || text.includes('503')
    || text.includes('502')
    || text.includes('504')
    || text.includes('429')
  );
}

async function providerFetchJson(url, init, label, res, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS) {
  let lastError = null;
  for (let attempt = 0; attempt <= PROVIDER_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`${label} request timed out after ${timeoutMs}ms`)), timeoutMs);
    let heartbeatId = null;
    if (res) {
      heartbeatId = setInterval(() => {
        send(res, {
          type: 'thinking',
          content: `${label} is still thinking. Waiting on the provider response instead of hanging silently.`,
        });
      }, 8000);
    }
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (heartbeatId) clearInterval(heartbeatId);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${label} API error (${response.status})${text ? `: ${text}` : ''}`);
      }
      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
       if (heartbeatId) clearInterval(heartbeatId);
      lastError = error;
      if (attempt >= PROVIDER_MAX_RETRIES || !isRetryableProviderError(error)) {
        throw error;
      }
      send(res, {
        type: 'thinking',
        content: `${label} request failed (${attempt + 1}/${PROVIDER_MAX_RETRIES + 1}). Retrying with a fresh attempt instead of hanging.`,
      });
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`${label} request failed`);
}

async function providerFetchText(url, init, label, res, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS) {
  let lastError = null;
  for (let attempt = 0; attempt <= PROVIDER_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`${label} request timed out after ${timeoutMs}ms`)), timeoutMs);
    let heartbeatId = null;
    if (res) {
      heartbeatId = setInterval(() => {
        send(res, {
          type: 'thinking',
          content: `${label} is still thinking. Waiting on the provider response instead of hanging silently.`,
        });
      }, 8000);
    }
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (heartbeatId) clearInterval(heartbeatId);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${label} API error (${response.status})${text ? `: ${text}` : ''}`);
      }
      return response.text();
    } catch (error) {
      clearTimeout(timeoutId);
      if (heartbeatId) clearInterval(heartbeatId);
      lastError = error;
      if (attempt >= PROVIDER_MAX_RETRIES || !isRetryableProviderError(error)) {
        throw error;
      }
      send(res, {
        type: 'thinking',
        content: `${label} request failed (${attempt + 1}/${PROVIDER_MAX_RETRIES + 1}). Retrying with a fresh attempt instead of hanging.`,
      });
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`${label} request failed`);
}

function getOpenAICompatibleConfig(agentRuntime) {
  if (agentRuntime.provider === 'openai') {
    return {
      label: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      key: agentRuntime.resolvedKeys.openai,
    };
  }

  if (agentRuntime.provider === 'kimi') {
    return {
      label: 'Kimi',
      url: 'https://api.moonshot.ai/v1/chat/completions',
      key: agentRuntime.resolvedKeys.kimi,
    };
  }

  return null;
}

async function checkCreditAvailability(userId) {
  const user = await User.findById(userId);
  if (!user) {
    return { allowed: false, reason: 'You must be signed in to use the AI assistant.' };
  }

  const tier = user.subscription_tier ?? 'free';
  if (tier === 'unlimited') return { allowed: true };

  const balance = user.credit_balance ?? 0;
  if (balance <= 0) {
    return {
      allowed: false,
      reason: 'You have 0 credits remaining. Add your own API key or ask the admin for more platform credits.',
    };
  }

  return { allowed: true };
}

async function deductCredit(userId) {
  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, reason: 'User not found.' };
  }

  const tier = user.subscription_tier ?? 'free';
  if (tier === 'unlimited') return { ok: true };

  const balance = user.credit_balance ?? 0;
  if (balance <= 0) {
    return {
      ok: false,
      reason: 'You have 0 credits remaining. Add your own API key or ask the admin for more platform credits.',
    };
  }

  user.credit_balance = balance - 1;
  await user.save();
  await CreditTransaction.create({
    user_id: user._id,
    amount: -1,
    reason: 'ai_request',
    note: 'Platform AI usage',
  });

  return { ok: true };
}

async function refundCredit(userId, note = 'Platform AI refund') {
  const user = await User.findById(userId);
  if (!user) return;

  user.credit_balance = (user.credit_balance ?? 0) + 1;
  await user.save();
  await CreditTransaction.create({
    user_id: user._id,
    amount: 1,
    reason: 'ai_refund',
    note,
  });
}

function buildCheckpointReason(message) {
  const summary = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return summary ? `Before AI task: ${summary}` : 'Before AI task';
}

async function createProjectCheckpointSnapshot(projectId, userId, reason = '') {
  const snapshotFiles = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
  return ProjectCheckpoint.create({
    id: await nextSequence('project_checkpoints'),
    project_id: projectId,
    user_id: userId,
    reason,
    files: snapshotFiles.map((file) => ({
      path: file.path,
      name: file.name,
      language: file.language ?? 'plaintext',
      content: file.content ?? '',
    })),
  });
}

async function upsertProjectFile(projectId, path, content, files) {
  const existing = await ProjectFile.findOne({ project_id: projectId, path });
  if (existing) {
    existing.content = content;
    existing.name = path.split('/').pop() || path;
    existing.language = detectLanguage(path);
    existing.updated_at = new Date();
    await existing.save();

    const localExisting = files.find((file) => file.id === existing.id || file.path === path || file.name === path);
    if (localExisting) {
      localExisting.name = existing.name;
      localExisting.path = existing.path;
      localExisting.content = existing.content;
      localExisting.language = existing.language;
      localExisting.updated_at = existing.updated_at.toISOString();
    }
    return { action: 'updated', file: serializeFile(existing) };
  }

  const file = await ProjectFile.create({
    id: await nextSequence('project_files'),
    project_id: projectId,
    name: path.split('/').pop() || path,
    path,
    content,
    language: detectLanguage(path),
  });
  files.push(serializeFile(file));
  return { action: 'created', file: serializeFile(file) };
}

async function deleteTaskFile(taskId, path, files) {
  const existing = await ProjectTaskFile.findOne({ task_id: taskId, path });
  if (!existing) return false;
  await ProjectTaskFile.deleteOne({ _id: existing._id });
  const index = files.findIndex((entry) => entry.id === existing.id || entry.path === path);
  if (index >= 0) files.splice(index, 1);
  return true;
}

function getExecutionProjectId(projectId, agentRuntime) {
  return String(agentRuntime?.executionProjectId ?? projectId);
}

async function upsertActiveFile(projectId, path, content, files, agentRuntime) {
  if (agentRuntime?.task) {
    return upsertTaskFile(agentRuntime.task.id, projectId, path, content, files);
  }
  return upsertProjectFile(projectId, path, content, files);
}

async function deleteActiveFile(projectId, path, files, agentRuntime) {
  if (agentRuntime?.task) {
    return deleteTaskFile(agentRuntime.task.id, path, files);
  }

  const file = await ProjectFile.findOne({ project_id: projectId, path });
  if (!file) return false;
  await ProjectFile.deleteOne({ _id: file._id });
  const index = files.findIndex((entry) => entry.id === file.id || entry.path === path);
  if (index >= 0) files.splice(index, 1);
  return true;
}

async function getRunnerOrNull() {
  const runner = await getRunnerConfig();
  if (!runner.runner_url) return null;
  return {
    url: runner.runner_url.replace(/\/$/, ''),
    secret: runner.runner_secret ?? '',
  };
}

async function syncProjectFilesToRunner(projectId, files) {
  const runner = await getRunnerOrNull();
  if (!runner || files.length === 0) return false;
  return syncProjectFilesToRunnerHelper(projectId, files);
}

const TASK_SYNC_SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.cache', '.vite', '.venv', 'venv', '__pycache__']);
const TASK_SYNC_SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.mp3', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm']);

function shouldSkipTaskSyncPath(relativePath, type = 'file') {
  const normalized = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
  if (!normalized || normalized === '.') return false;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => TASK_SYNC_SKIP_DIRS.has(part))) return true;
  if (type !== 'dir') {
    const ext = parts.length > 0 ? `.${parts[parts.length - 1].split('.').pop()}` : '';
    if (TASK_SYNC_SKIP_EXTENSIONS.has(ext.toLowerCase())) return true;
  }
  return false;
}

async function collectTaskWorkspaceSnapshot(executionProjectId, dir = '.', state = null) {
  const summary = state ?? { paths: [], skipped: 0, truncated: false, limit: 600 };
  if (summary.truncated) return summary;

  const result = await runnerFetch('/ls', {
    projectId: String(executionProjectId),
    dir,
  }, 30000);
  const entries = Array.isArray(result?.entries) ? result.entries : [];

  for (const entry of entries) {
    const relativePath = String(entry.path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
    if (!relativePath || relativePath === '.') continue;
    if (shouldSkipTaskSyncPath(relativePath, entry.type)) {
      summary.skipped += 1;
      continue;
    }
    if (entry.type === 'dir') {
      await collectTaskWorkspaceSnapshot(executionProjectId, relativePath, summary);
      if (summary.truncated) break;
      continue;
    }
    summary.paths.push(relativePath);
    if (summary.paths.length >= summary.limit) {
      summary.truncated = true;
      break;
    }
  }

  return summary;
}

async function syncRunnerWorkspaceFromRunner(projectId, files, agentRuntime = null) {
  const runner = await getRunnerOrNull();
  if (!runner) return null;
  if (agentRuntime?.task) {
    const taskId = agentRuntime.task.id;
    const executionProjectId = getExecutionProjectId(projectId, agentRuntime);
    const collected = await collectTaskWorkspaceSnapshot(executionProjectId, '.', {
      paths: [],
      skipped: 0,
      truncated: false,
      limit: 600,
    });
    const workspaceFiles = [];
    let totalChars = 0;
    for (const relativePath of collected.paths) {
      try {
        const result = await runnerFetch('/read', {
          projectId: String(executionProjectId),
          filePath: relativePath,
        }, 30000);
        const content = String(result?.content ?? '');
        if (content.includes('\u0000')) {
          collected.skipped += 1;
          continue;
        }
        totalChars += content.length;
        workspaceFiles.push({
          name: relativePath.split('/').pop() || relativePath,
          path: relativePath,
          content,
          language: detectLanguage(relativePath),
        });
      } catch {
        collected.skipped += 1;
      }
    }

    await ProjectTaskFile.deleteMany({ task_id: taskId });
    files.splice(0, files.length);
    for (const file of workspaceFiles) {
      const created = await ProjectTaskFile.create({
        id: await nextSequence('project_task_files'),
        task_id: taskId,
        project_id: projectId,
        name: file.name,
        path: file.path,
        content: file.content ?? '',
        language: file.language ?? detectLanguage(file.path),
      });
      files.push(serializeFile(created));
    }

    return {
      ok: true,
      imported: workspaceFiles.length,
      created: workspaceFiles.length,
      updated: 0,
      unchanged: 0,
      removed: 0,
      skipped: collected.skipped,
      truncated: collected.truncated,
      totalChars,
      paths: workspaceFiles.map((file) => file.path),
    };
  }
  return syncRunnerWorkspaceToProjectHelper(projectId, { filesCache: files });
}

function canUseVisualBrowserAnalysis(agentRuntime) {
  if (!agentRuntime || !(agentRuntime.websiteMode || agentRuntime.appTesting)) return false;
  const provider = agentRuntime.provider;
  if (provider === 'gemini') return !!agentRuntime.resolvedKeys?.gemini;
  if (provider === 'anthropic') return !!agentRuntime.resolvedKeys?.anthropic;
  if (provider === 'openai') return !!agentRuntime.resolvedKeys?.openai;
  if (provider === 'kimi') return !!agentRuntime.resolvedKeys?.kimi;
  if (provider === 'vertex') return !!agentRuntime.resolvedKeys?.vertex;
  return false;
}

async function describeBrowserScreenshot(agentRuntime, screenshotBase64, context = '') {
  if (!canUseVisualBrowserAnalysis(agentRuntime) || !screenshotBase64) return '';

  const prompt = [
    'You are helping a coding agent control a live browser.',
    'Summarize only what is visually important for the next browser action.',
    'Mention the page purpose, obvious inputs/buttons, visible errors, challenge/CAPTCHA/OTP blockers, and anything that suggests success or failure.',
    'Keep it under 120 words.',
    context ? `Context: ${context}` : '',
  ].filter(Boolean).join('\n');

  try {
    if (agentRuntime.provider === 'gemini') {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${agentRuntime.model}:generateContent?key=${agentRuntime.resolvedKeys.gemini}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        }),
      });
      if (!response.ok) return '';
      const data = await response.json();
      return (data.candidates?.[0]?.content?.parts ?? []).filter((part) => part.text).map((part) => part.text).join('').trim();
    }

    if (agentRuntime.provider === 'vertex') {
      const response = await fetch(`https://aiplatform.googleapis.com/v1/publishers/google/models/${agentRuntime.model}:streamGenerateContent?key=${agentRuntime.resolvedKeys.vertex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        }),
      });
      if (!response.ok) return '';
      const raw = await response.text();
      const parsed = JSON.parse(raw);
      const chunks = Array.isArray(parsed) ? parsed : [parsed];
      return chunks
        .flatMap((chunk) => chunk.candidates?.[0]?.content?.parts ?? [])
        .filter((part) => part.text)
        .map((part) => part.text)
        .join('')
        .trim();
    }

    if (agentRuntime.provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': agentRuntime.resolvedKeys.anthropic,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: agentRuntime.model,
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: screenshotBase64,
                },
              },
            ],
          }],
        }),
      });
      if (!response.ok) return '';
      const data = await response.json();
      return (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
    }

    if (agentRuntime.provider === 'openai' || agentRuntime.provider === 'kimi') {
      const providerConfig = getOpenAICompatibleConfig(agentRuntime);
      const response = await fetch(providerConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${providerConfig.key}`,
        },
        body: JSON.stringify({
          model: agentRuntime.model,
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
            ],
          }],
        }),
      });
      if (!response.ok) return '';
      const data = await response.json();
      return String(data.choices?.[0]?.message?.content ?? '').trim();
    }
  } catch {}

  return '';
}

async function maybeCollectBrowserVisualSummary(agentRuntime, sessionId, action, result) {
  if (!canUseVisualBrowserAnalysis(agentRuntime)) return '';

  const normalizedAction = String(action ?? '').toLowerCase();
  const analysisActions = new Set(['navigate', 'goto', 'screenshot', 'click', 'smart_click', 'smart_fill_form']);
  if (!analysisActions.has(normalizedAction)) return '';

  try {
    const screenshotBase64 = result?.screenshot
      ? String(result.screenshot)
      : String((await runnerFetch('/browser', {
          action: 'screenshot',
          projectId: String(agentRuntime?.executionProjectId ?? agentRuntime?.project?.id ?? 'default'),
          sessionId,
          fullPage: false,
        }, 15000)).screenshot ?? '');
    if (!screenshotBase64) return '';

    const summary = await describeBrowserScreenshot(
      agentRuntime,
      screenshotBase64,
      `Browser action: ${normalizedAction}. URL: ${String(result?.url ?? '')}. Title: ${String(result?.title ?? '')}.`,
    );
    return summary ? `Visual summary: ${summary}` : '';
  } catch {
    return '';
  }
}

function browserResultNeedsRecovery(result) {
  const text = String(result ?? '').toLowerCase();
  return text.startsWith('browser action failed') || text.startsWith('browser action blocked');
}

function browserResultRequiresManualHandoff(result) {
  const text = String(result ?? '');
  return text.includes('[MANUAL_BROWSER_HANDOFF]');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return null;
  }
}

function guessNodePackageManager(files) {
  const paths = new Set(files.map((file) => file.path));
  if (paths.has('pnpm-lock.yaml')) return 'pnpm';
  if (paths.has('yarn.lock')) return 'yarn';
  return 'npm';
}

function buildNodeScriptCommand(manager, script) {
  if (!script) return '';
  if (manager === 'yarn') return `yarn ${script}`;
  if (manager === 'pnpm') return `pnpm ${script}`;
  if (script === 'start' || script === 'test') return `npm ${script}`;
  return `npm run ${script}`;
}

function guessLocalAppUrl(files, packageJson = null) {
  const pkg = packageJson ?? safeJsonParse(files.find((file) => file.path === 'package.json')?.content ?? '');
  const scripts = pkg?.scripts ?? {};
  const scriptText = Object.values(scripts).map((value) => String(value ?? '')).join(' ').toLowerCase();
  const paths = new Set(files.map((file) => file.path.toLowerCase()));

  if (scriptText.includes('vite') || Array.from(paths).some((path) => path.startsWith('vite.config.'))) {
    return 'http://127.0.0.1:5173';
  }
  if (scriptText.includes('next dev') || scriptText.includes('react-scripts start') || scriptText.includes('webpack serve')) {
    return 'http://127.0.0.1:3000';
  }
  if (scriptText.includes('nuxt') || scriptText.includes('svelte-kit')) {
    return 'http://127.0.0.1:3000';
  }
  if (paths.has('manage.py')) return 'http://127.0.0.1:8000';
  if (Array.from(paths).some((path) => path.endsWith('app.py') || path.endsWith('main.py'))) {
    return 'http://127.0.0.1:5000';
  }
  return '';
}

function getVerificationHints(files) {
  const packageFile = files.find((file) => file.path === 'package.json');
  if (packageFile) {
    const parsed = safeJsonParse(packageFile.content);
    const scripts = parsed?.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
    const manager = guessNodePackageManager(files);
    const devCommand = scripts.dev ? buildNodeScriptCommand(manager, 'dev') : scripts.start ? buildNodeScriptCommand(manager, 'start') : '';
    const validationCommands = [
      scripts.build ? buildNodeScriptCommand(manager, 'build') : '',
      scripts.test && !String(scripts.test).toLowerCase().includes('no test specified') ? buildNodeScriptCommand(manager, 'test') : '',
      scripts.lint ? buildNodeScriptCommand(manager, 'lint') : '',
      scripts.typecheck ? buildNodeScriptCommand(manager, 'typecheck') : '',
      scripts.check ? buildNodeScriptCommand(manager, 'check') : '',
    ].filter(Boolean);
    return {
      kind: 'node',
      devCommand,
      validationCommands,
      defaultUrl: guessLocalAppUrl(files, parsed),
    };
  }

  const paths = new Set(files.map((file) => file.path));
  if (paths.has('pyproject.toml') || paths.has('requirements.txt') || paths.has('requirements-dev.txt')) {
    return {
      kind: 'python',
      devCommand: paths.has('manage.py') ? 'python manage.py runserver' : '',
      validationCommands: ['pytest'],
      defaultUrl: guessLocalAppUrl(files),
    };
  }
  if (paths.has('Cargo.toml')) {
    return {
      kind: 'rust',
      devCommand: '',
      validationCommands: ['cargo test', 'cargo build'],
      defaultUrl: '',
    };
  }
  if (paths.has('go.mod')) {
    return {
      kind: 'go',
      devCommand: '',
      validationCommands: ['go test ./...', 'go build ./...'],
      defaultUrl: '',
    };
  }

  return {
    kind: 'generic',
    devCommand: '',
    validationCommands: [],
    defaultUrl: '',
  };
}

function pathNeedsVerification(path) {
  const normalized = String(path ?? '').trim().toLowerCase();
  if (!normalized) return false;
  const baseName = normalized.split('/').pop() ?? normalized;

  if ([
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'pyproject.toml',
    'requirements.txt',
    'requirements-dev.txt',
    'cargo.toml',
    'go.mod',
    'vite.config.ts',
    'vite.config.js',
    'next.config.js',
    'next.config.mjs',
  ].includes(baseName)) {
    return true;
  }

  return /\.(tsx?|jsx?|mjs|cjs|vue|svelte|css|scss|sass|less|html|py|rb|php|java|kt|swift|go|rs|c|cpp|cs|sql|graphql|json|ya?ml|toml|sh)$/i.test(normalized);
}

function commandLooksLikeValidation(command) {
  const text = String(command ?? '').trim().toLowerCase();
  if (!text) return false;
  return /\b(test|build|lint|typecheck|check|validate|verify|pytest|cargo test|cargo build|go test|go build|mvn test|gradle test|npm test|npm run build|pnpm test|pnpm build|yarn test|yarn build)\b/.test(text);
}

function commandLooksLikeRunnerFileMutation(command) {
  const text = String(command ?? '').trim().toLowerCase();
  if (!text) return false;
  return /\b(git\s+(clone|pull|checkout|switch|restore|reset|merge|rebase|cherry-pick)|npm\s+(install|init)|pnpm\s+(install|create)|yarn\s+(install|create)|npx\s+create-|mkdir|touch|rm\s|mv\s|cp\s|sed\s|perl\s)\b/.test(text);
}

function normalizeBrowserActionName(action) {
  return String(action ?? '').trim().toLowerCase();
}

const BROWSER_NAVIGATION_ACTIONS = new Set([
  'navigate',
  'goto',
]);

const BROWSER_INTERACTION_ACTIONS = new Set([
  'navigate',
  'goto',
  'click',
  'smart_click',
  'type',
  'fill',
  'smart_fill_form',
  'dom_mutate',
]);

const BROWSER_ASSERTION_ACTIONS = new Set([
  'wait_for',
  'wait_for_text',
  'get_text',
  'current_url',
  'element_info',
  'query_all',
  'get_html',
  'evaluate',
]);

function browserActionCountsAsVerification(state, action) {
  const normalized = normalizeBrowserActionName(action);
  if (!BROWSER_ASSERTION_ACTIONS.has(normalized)) return false;
  return state.browserInteractionCount > 0 || state.browserNavigationCount > 0 || !state.filesChanged;
}

function messageSuggestsSecurityRecon(message = '', agentProfile = 'builder') {
  if (normalizeAgentProfile(agentProfile) === 'security') return true;
  const text = String(message ?? '').toLowerCase();
  if (!text) return false;
  return /\b(security|vuln|vulnerability|audit|pentest|penetration|xss|sqli|sql injection|ssrf|csrf|idor|rce|lfi|rfi|xxe|auth bypass|token|cookie|session|secret|oast|headers|csp|cors)\b/.test(text);
}

function messageSuggestsTrafficRecon(message = '') {
  const text = String(message ?? '').toLowerCase();
  if (!text) return false;
  return /\b(har|traffic|capture|replay|mimic|reverse engineer|reverse-engineer|request chain|request flow|graphql|websocket|ws\b|source map|sourcemap|minified|bundle|obfuscated|hidden endpoint|api flow)\b/.test(text);
}

function messageSuggestsVisualBuild(message = '', agentProfile = 'builder') {
  if (normalizeAgentProfile(agentProfile) === 'design') return true;
  const text = String(message ?? '').toLowerCase();
  if (!text) return false;
  return /\b(website|web page|webpage|landing page|homepage|ui|ux|frontend|front-end|screen|component|design|animation|motion|hero|layout|css|tailwind|pendulum|canvas|svg)\b/.test(text);
}

function toolResultIndicatesSuccess(toolName, result) {
  const text = String(result ?? '');
  const normalized = text.toLowerCase();
  if (!text) return false;

  if (toolName === 'run_command' || toolName === 'execute_code') {
    return /exit code:\s*0\b/i.test(text);
  }
  if (toolName === 'browser_action') {
    return normalized.startsWith('action:') && !normalized.includes('blocked') && !normalized.startsWith('browser action failed');
  }
  if (toolName === 'check_background_command') {
    return normalized.includes('ready: yes');
  }
  if (toolName === 'start_background_command') {
    return normalized.includes('status: running');
  }
  return !normalized.includes('failed') && !normalized.includes('error:') && !normalized.includes('blocked');
}

function pushChangedPath(state, path) {
  const normalized = String(path ?? '').trim();
  if (!normalized) return;
  if (!state.changedPaths.includes(normalized)) state.changedPaths.push(normalized);
  if (pathNeedsVerification(normalized)) state.verificationRequired = true;
}

function buildVerificationPrompt(state, agentRuntime) {
  if (!state.filesChanged || state.verificationSatisfied || !state.verificationRequired || state.remainingVerificationPrompts <= 0) {
    return null;
  }

  state.remainingVerificationPrompts -= 1;
  const changed = state.changedPaths.slice(0, 6).join(', ');
  const hints = state.verificationHints ?? { validationCommands: [], devCommand: '', defaultUrl: '' };
  const suggestionLines = [];

  if (agentRuntime?.appTesting && agentRuntime?.runtimeContext?.runnerReachable && agentRuntime?.runtimeContext?.browserAvailable) {
    if (hints.devCommand) {
      suggestionLines.push(`- Start the app with start_background_command using: ${hints.devCommand}`);
      suggestionLines.push('- Wait for readiness with check_background_command before browser testing.');
    }
    const targetUrl = hints.defaultUrl || 'the local app URL';
    suggestionLines.push(`- Use browser_action with sessionId ${agentRuntime.browserSessionId || 'default'} to open ${targetUrl} and exercise the user flow.`);
    suggestionLines.push('- After navigation or interaction, prove a concrete UI condition with wait_for_text, get_text, query_all, element_info, current_url, or evaluate. A screenshot or snapshot alone is not enough verification.');
  } else if (agentRuntime?.runtimeContext?.runnerReachable) {
    const commands = hints.validationCommands.slice(0, 3);
    if (commands.length > 0) {
      for (const command of commands) suggestionLines.push(`- Run verification: ${command}`);
    } else {
      suggestionLines.push('- Run at least one real validation command now with run_command or execute_code.');
    }
  } else {
    state.remainingVerificationPrompts = 0;
    suggestionLines.push('- Runner verification is unavailable. Do the best static implementation you can, then include one concise note that preview/build validation is blocked because the runner is offline.');
    suggestionLines.push('- Do not repeat the same blocker multiple times and do not pretend the result was verified.');
  }

  return [
    'You changed implementation files but have not verified the result yet.',
    changed ? `Changed paths: ${changed}` : null,
    state.acceptanceCriteria.length > 0 ? `Acceptance criteria still to satisfy: ${state.acceptanceCriteria.join(' | ')}` : null,
    ...suggestionLines,
    'Do not stop at code edits alone. Verify the behavior, inspect failures, fix them, and re-test before you finish.',
  ].filter(Boolean).join('\n');
}

function buildReconPrompt(state) {
  if (state.remainingReconPrompts <= 0 || state.filesChanged) return null;

  if (state.needsSecurityRecon && !state.securityReconUsed) {
    state.remainingReconPrompts -= 1;
    return [
      'This request looks security-driven, and you have not mapped the target properly yet.',
      'Use security_scope and surface_map now so you know the allowed hosts, auth profiles, routes, forms, APIs, and risky files before guessing.',
      'If you still need a first-pass audit after that, run_security_scan and then continue from the evidence.',
    ].join('\n');
  }

  if (state.needsTrafficRecon && !state.trafficReconUsed) {
    state.remainingReconPrompts -= 1;
    return [
      'This request depends on reverse engineering captured or hidden behavior.',
      'Use traffic_capture_summary or traffic_flow_graph first when HAR traffic exists, and use reverse_engineer_project for bundled/minified clients or hidden endpoints.',
      'Only start replaying or mutating requests after you understand the request chain and auth flow.',
    ].join('\n');
  }

  return null;
}

function createAgentLoopState(agentRuntime, files = []) {
  const autonomy = normalizeAgentAutonomy(agentRuntime?.autonomy);
  const fastMode = !!agentRuntime?.fastMode;
  const websiteRecoveryBudget = autonomy === 'max' ? 5 : autonomy === 'guided' ? 2 : 3;
  const actionBudget = autonomy === 'max' ? 3 : 2;
  const generalBudget = autonomy === 'max' ? 6 : autonomy === 'guided' ? 3 : 4;
  const verificationBudget = autonomy === 'max' ? 5 : autonomy === 'guided' ? 2 : 3;
  const reconBudget = autonomy === 'max' ? 4 : autonomy === 'guided' ? 1 : 2;

  return {
    websiteMode: !!(agentRuntime?.websiteMode || agentRuntime?.appTesting || agentRuntime?.runtimeContext?.websiteTask),
    appTesting: !!agentRuntime?.appTesting,
    browserUsed: false,
    lastBrowserResult: '',
    toolUsed: false,
    lastFailedTool: '',
    lastFailureSummary: '',
    filesChanged: false,
    changedPaths: [],
    verificationRequired: false,
    verificationSatisfied: false,
    verificationHints: getVerificationHints(files),
    browserNavigationCount: 0,
    browserInteractionCount: 0,
    browserAssertionCount: 0,
    needsSecurityRecon: messageSuggestsSecurityRecon(agentRuntime?.requestMessage, agentRuntime?.agentProfile),
    needsTrafficRecon: messageSuggestsTrafficRecon(agentRuntime?.requestMessage),
    securityReconUsed: false,
    trafficReconUsed: false,
    remainingRecoveryPrompts: agentRuntime?.websiteMode || agentRuntime?.appTesting ? Math.max(1, websiteRecoveryBudget - (fastMode ? 1 : 0)) : 0,
    remainingActionPrompts: Math.max(1, actionBudget - (fastMode ? 1 : 0)),
    remainingGeneralRecoveryPrompts: Math.max(1, generalBudget - (fastMode ? 1 : 0)),
    remainingVerificationPrompts: Math.max(1, verificationBudget - (fastMode ? 1 : 0)),
    remainingReconPrompts: Math.max(1, reconBudget - (fastMode ? 1 : 0)),
    pendingRunnerSync: false,
    acceptanceCriteria: Array.isArray(agentRuntime?.task?.acceptance_criteria) ? agentRuntime.task.acceptance_criteria : [],
  };
}

function summarizeToolFailure(toolName, result) {
  const text = String(result ?? '').trim();
  if (!text) return '';
  if (toolName === 'browser_action' && browserResultRequiresManualHandoff(text)) return '';

  const normalized = text.toLowerCase();
  const failedSearch = toolName === 'web_search' && (
    normalized.startsWith('search failed')
    || normalized.startsWith('search error')
    || normalized.includes('no results found')
  );
  const failedBrowse = toolName === 'browse_website' && (
    normalized.startsWith('failed to fetch')
    || normalized.startsWith('http ')
  );
  const failedExitCode = (toolName === 'run_command' || toolName === 'execute_code' || toolName === 'install_package')
    && /exit code:\s*(-?\d+)/i.test(text)
    && !/exit code:\s*0\b/i.test(text);
  const failureMarkers = [
    ' failed',
    'failed:',
    'error:',
    'blocked',
    '[runner not connected]',
    'unsupported language',
    'file not found',
    'could not find',
    'could not fetch',
  ];
  const isFailure = failedSearch || failedBrowse || failedExitCode || failureMarkers.some((marker) => normalized.includes(marker));
  if (!isFailure) return '';

  return `${toolName}: ${text.slice(0, 1500)}`;
}

function updateAgentLoopState(state, toolName, args, result) {
  state.toolUsed = true;
  if (toolName === 'browser_action') {
    state.browserUsed = true;
    state.lastBrowserResult = String(result ?? '');
    const action = normalizeBrowserActionName(args?.action);
    if (toolResultIndicatesSuccess(toolName, result)) {
      if (BROWSER_NAVIGATION_ACTIONS.has(action)) state.browserNavigationCount += 1;
      if (BROWSER_INTERACTION_ACTIONS.has(action)) state.browserInteractionCount += 1;
      if (BROWSER_ASSERTION_ACTIONS.has(action)) state.browserAssertionCount += 1;
    }
  } else if (toolName === 'security_scope' || toolName === 'surface_map' || toolName === 'run_security_scan' || toolName === 'list_findings') {
    state.securityReconUsed = true;
  } else if (
    toolName === 'traffic_capture_summary'
    || toolName === 'traffic_flow_graph'
    || toolName === 'replay_traffic_request'
    || toolName === 'replay_traffic_flow'
    || toolName === 'reverse_engineer_project'
    || toolName === 'mutate_traffic_request'
    || toolName === 'api_spec_summary'
  ) {
    state.trafficReconUsed = true;
  }

  if (toolName === 'write_file') {
    state.filesChanged = true;
    state.verificationSatisfied = false;
    pushChangedPath(state, args?.path);
  } else if (toolName === 'patch_file') {
    state.filesChanged = true;
    state.verificationSatisfied = false;
    pushChangedPath(state, args?.path);
  } else if (toolName === 'edit_file') {
    state.filesChanged = true;
    state.verificationSatisfied = false;
    pushChangedPath(state, args?.path);
  } else if (toolName === 'batch_write_files') {
    state.filesChanged = true;
    state.verificationSatisfied = false;
    for (const file of Array.isArray(args?.files) ? args.files : []) {
      pushChangedPath(state, file?.path);
    }
  } else if (toolName === 'rename_file') {
    state.filesChanged = true;
    state.verificationSatisfied = false;
    pushChangedPath(state, args?.old_path);
    pushChangedPath(state, args?.new_path);
  } else if (toolName === 'delete_file') {
    state.filesChanged = true;
    state.verificationSatisfied = false;
    pushChangedPath(state, args?.path);
  } else if (toolName === 'sync_runner_workspace' && /Created:\s*[1-9]|Updated:\s*[1-9]|Removed:\s*[1-9]/i.test(String(result ?? ''))) {
    state.filesChanged = true;
    state.verificationSatisfied = false;
  } else if (toolName === 'install_package') {
    state.filesChanged = true;
    state.verificationRequired = true;
    state.verificationSatisfied = false;
  }

  if (toolName === 'browser_action' && (state.appTesting || state.websiteMode) && toolResultIndicatesSuccess(toolName, result)) {
    state.verificationSatisfied = browserActionCountsAsVerification(state, args?.action);
  } else if (toolName === 'run_command' && toolResultIndicatesSuccess(toolName, result) && commandLooksLikeValidation(args?.command)) {
    state.verificationSatisfied = true;
  } else if (toolName === 'execute_code' && toolResultIndicatesSuccess(toolName, result)) {
    state.verificationSatisfied = true;
  }

  if (toolName === 'run_command' && toolResultIndicatesSuccess(toolName, result) && commandLooksLikeRunnerFileMutation(args?.command)) {
    state.pendingRunnerSync = true;
  } else if (toolName === 'sync_runner_workspace' && toolResultIndicatesSuccess(toolName, result)) {
    state.pendingRunnerSync = false;
  }

  const failureSummary = summarizeToolFailure(toolName, result);
  if (failureSummary) {
    state.lastFailedTool = toolName;
    state.lastFailureSummary = failureSummary;
    return;
  }

  state.lastFailedTool = '';
  state.lastFailureSummary = '';
}

function buildFailureGuidance(toolName) {
  if (toolName === 'web_search') {
    return 'Try a narrower query, a package/library name, or switch to browse_website with a likely official docs URL instead of stopping.';
  }

  if (toolName === 'browse_website') {
    return 'Try a more direct docs/API URL, or use web_search to find the official page before browsing again.';
  }

  if (toolName === 'browser_action') {
    return 'Inspect page_snapshot, screenshot, logs, challenge_status, and visible errors before trying a different browser action.';
  }

  if (toolName === 'run_command' || toolName === 'install_package' || toolName === 'execute_code') {
    return 'Read the stderr/output, identify the root cause, edit or change the command, and rerun verification.';
  }

  return 'Inspect the failing tool output, change the plan, and try a materially different next step before finishing.';
}

function buildAgentRecoveryPrompt(state, agentRuntime) {
  if (!state.toolUsed && state.remainingActionPrompts > 0) {
    state.remainingActionPrompts -= 1;
    return [
      'This is an execution task, not a theory-only answer.',
      'Use tools now to inspect the repo, change code, run checks, or verify the flow instead of stopping early.',
      'Start with project_map, read_file, list_files, grep, or another concrete tool if you still need orientation.',
    ].join('\n');
  }

  const verificationPrompt = buildVerificationPrompt(state, agentRuntime);
  if (verificationPrompt) {
    return verificationPrompt;
  }

  const reconPrompt = buildReconPrompt(state);
  if (reconPrompt) {
    return reconPrompt;
  }

  if (state.pendingRunnerSync && state.remainingGeneralRecoveryPrompts > 0) {
    state.remainingGeneralRecoveryPrompts -= 1;
    return [
      'A runner-side command likely changed files outside the project database.',
      'Use sync_runner_workspace now so your next reads, edits, and summary use the real current project state.',
      'Do this before you continue or finish.',
    ].join('\n');
  }

  if (state.websiteMode && state.remainingRecoveryPrompts > 0 && !state.browserUsed) {
    state.remainingRecoveryPrompts -= 1;
    return [
      'This request is in website/app-testing mode.',
      agentRuntime?.appTesting
        ? 'If the app must be started locally, launch or reuse it with start_background_command or an appropriate run_command before browser_action.'
        : null,
      `Use browser_action with the persistent sessionId ${agentRuntime.browserSessionId || 'default'} before you answer.`,
      'Inspect first with page_snapshot, screenshot, logs, challenge_status, query_all, or frame_tree. Then act. Then verify the result.',
    ].filter(Boolean).join(' ');
  }

  if (
    state.websiteMode
    && state.remainingRecoveryPrompts > 0
    && state.lastBrowserResult
    && browserResultNeedsRecovery(state.lastBrowserResult)
    && !browserResultRequiresManualHandoff(state.lastBrowserResult)
  ) {
    state.remainingRecoveryPrompts -= 1;
    const excerpt = state.lastBrowserResult.slice(0, 1500);
    state.lastBrowserResult = '';
    return [
      'The last browser step did not complete the task.',
      'Diagnose the failure using page_snapshot, screenshot, logs, and challenge_status in the same session before retrying.',
      'Change the plan instead of repeating the same failing action.',
      `Failure summary: ${excerpt}`,
    ].join('\n');
  }

  if (state.lastFailureSummary && state.remainingGeneralRecoveryPrompts > 0) {
    state.remainingGeneralRecoveryPrompts -= 1;
    const summary = state.lastFailureSummary.slice(0, 1500);
    const toolName = state.lastFailedTool;
    state.lastFailureSummary = '';
    state.lastFailedTool = '';
    return [
      'The last tool step failed or came back empty in a way that does not satisfy the task yet.',
      `Failure summary: ${summary}`,
      buildFailureGuidance(toolName),
      'Do not stop yet. Diagnose the root cause from the actual output and continue until the task works or a concrete external blocker remains.',
    ].join('\n');
  }

  return null;
}

function formatBackgroundProcessResult(label, data, readiness = null) {
  const parts = [label];
  if (data?.sessionId) parts.push(`Session: ${data.sessionId}`);
  if (data?.status) parts.push(`Status: ${data.status}`);
  if (data?.pid) parts.push(`PID: ${data.pid}`);
  if (data?.cwd) parts.push(`CWD: ${data.cwd}`);
  if (data?.exitCode !== undefined && data?.exitCode !== null) parts.push(`Exit code: ${data.exitCode}`);
  if (readiness?.url) {
    parts.push(`Check URL: ${readiness.url}`);
    parts.push(`Ready: ${readiness.ready ? 'yes' : 'no'}`);
    if (readiness.status !== undefined) parts.push(`HTTP status: ${readiness.status}`);
    if (readiness.error) parts.push(`Readiness error: ${readiness.error}`);
  }
  if (data?.stdout) parts.push(`Recent stdout:\n${String(data.stdout).slice(0, 8000)}`);
  if (data?.stderr) parts.push(`Recent stderr:\n${String(data.stderr).slice(0, 8000)}`);
  return parts.join('\n');
}

function findNthOccurrence(haystack, needle, occurrence = 1) {
  if (!needle) return -1;
  let fromIndex = 0;
  let count = 0;
  while (fromIndex <= haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index < 0) return -1;
    count += 1;
    if (count === occurrence) return index;
    fromIndex = index + needle.length;
  }
  return -1;
}

function applyPatchOperationsToContent(content, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    return { ok: false, error: 'patch_file requires a non-empty operations array.' };
  }

  let nextContent = String(content ?? '');
  const summaries = [];

  for (const [index, rawOperation] of operations.entries()) {
    const operation = rawOperation && typeof rawOperation === 'object' ? rawOperation : {};
    const type = String(operation.type ?? 'replace').trim().toLowerCase();
    const occurrence = Math.max(1, Number(operation.occurrence ?? 1) || 1);
    const oldStr = String(operation.old_str ?? operation.target ?? operation.anchor ?? '');
    const newStr = String(operation.new_str ?? operation.content ?? '');

    if (type === 'replace') {
      if (!oldStr) {
        return { ok: false, error: `Patch operation ${index + 1} requires old_str.` };
      }
      const start = findNthOccurrence(nextContent, oldStr, occurrence);
      if (start < 0) {
        return { ok: false, error: `Could not find patch target for replace operation ${index + 1}.` };
      }
      nextContent = `${nextContent.slice(0, start)}${newStr}${nextContent.slice(start + oldStr.length)}`;
      summaries.push(`replace#${occurrence}`);
      continue;
    }

    if (type === 'replace_all') {
      if (!oldStr) {
        return { ok: false, error: `Patch operation ${index + 1} requires old_str.` };
      }
      if (!nextContent.includes(oldStr)) {
        return { ok: false, error: `Could not find patch target for replace_all operation ${index + 1}.` };
      }
      nextContent = nextContent.split(oldStr).join(newStr);
      summaries.push('replace_all');
      continue;
    }

    if (type === 'insert_before' || type === 'insert_after') {
      if (!oldStr) {
        return { ok: false, error: `Patch operation ${index + 1} requires anchor.` };
      }
      const anchorIndex = findNthOccurrence(nextContent, oldStr, occurrence);
      if (anchorIndex < 0) {
        return { ok: false, error: `Could not find patch anchor for ${type} operation ${index + 1}.` };
      }
      const insertAt = type === 'insert_before' ? anchorIndex : anchorIndex + oldStr.length;
      nextContent = `${nextContent.slice(0, insertAt)}${newStr}${nextContent.slice(insertAt)}`;
      summaries.push(`${type}#${occurrence}`);
      continue;
    }

    if (type === 'prepend') {
      nextContent = `${newStr}${nextContent}`;
      summaries.push('prepend');
      continue;
    }

    if (type === 'append') {
      nextContent = `${nextContent}${newStr}`;
      summaries.push('append');
      continue;
    }

    return { ok: false, error: `Unsupported patch operation type: ${type}` };
  }

  return {
    ok: true,
    content: nextContent,
    summary: summaries.join(', '),
  };
}

async function executeTool(name, args, projectId, files, res, agentRuntime) {
  const filePolicy = normalizeFilePolicy(agentRuntime?.filePolicy);
  const visibleFiles = () => filterVisibleFiles(files, filePolicy);
  const executionProjectId = getExecutionProjectId(projectId, agentRuntime);
  const fileChangedEventType = agentRuntime?.task ? 'task_file_changed' : 'file_changed';

  if (name === 'write_file') {
    const path = String(args.path);
    const content = String(args.content);
    const permission = canModifyPath(path, filePolicy);
    if (!permission.allowed) return permission.reason;
    const result = await upsertActiveFile(projectId, path, content, files, agentRuntime);
    send(res, { type: fileChangedEventType, path, action: result.action, taskId: agentRuntime?.task?.id ?? null });
    return `File ${path} written successfully (${content.length} chars)`;
  }

  if (name === 'edit_file') {
    const path = String(args.path);
    const oldStr = String(args.old_str ?? args.old ?? '');
    const newStr = String(args.new_str ?? args.new ?? '');
    const permission = canModifyPath(path, filePolicy);
    if (!permission.allowed) return permission.reason;
    const file = agentRuntime?.task
      ? await ProjectTaskFile.findOne({ task_id: agentRuntime.task.id, path })
      : await ProjectFile.findOne({ project_id: projectId, path });
    if (!file) return `File not found: ${path}`;
    if (!String(file.content ?? '').includes(oldStr)) {
      return `Could not find the text to replace in ${path}. Use write_file to rewrite the entire file instead.`;
    }

    file.content = String(file.content).replace(oldStr, newStr);
    file.updated_at = new Date();
    await file.save();

    const localFile = files.find((entry) => entry.id === file.id || entry.path === path);
    if (localFile) {
      localFile.content = file.content;
      localFile.updated_at = file.updated_at.toISOString();
    }

    send(res, { type: fileChangedEventType, path, action: 'updated', taskId: agentRuntime?.task?.id ?? null });
    return `File ${path} edited successfully`;
  }

  if (name === 'patch_file') {
    const path = String(args.path ?? '');
    const permission = canModifyPath(path, filePolicy);
    if (!permission.allowed) return permission.reason;
    const file = agentRuntime?.task
      ? await ProjectTaskFile.findOne({ task_id: agentRuntime.task.id, path })
      : await ProjectFile.findOne({ project_id: projectId, path });
    if (!file) return `File not found: ${path}`;

    const patchResult = applyPatchOperationsToContent(file.content ?? '', args.operations);
    if (!patchResult.ok) {
      return patchResult.error;
    }

    file.content = patchResult.content;
    file.updated_at = new Date();
    await file.save();

    const localFile = files.find((entry) => entry.id === file.id || entry.path === path);
    if (localFile) {
      localFile.content = file.content;
      localFile.updated_at = file.updated_at.toISOString();
    }

    send(res, { type: fileChangedEventType, path, action: 'updated', taskId: agentRuntime?.task?.id ?? null });
    return `Patched ${path} successfully (${patchResult.summary || 'operations applied'})`;
  }

  if (name === 'batch_write_files') {
    const fileList = args.files;
    if (!Array.isArray(fileList)) return 'Invalid files argument — must be an array of {path, content}';
    const results = [];
    for (const entry of fileList) {
      const path = String(entry.path);
      const content = String(entry.content);
      const permission = canModifyPath(path, filePolicy);
      if (!permission.allowed) {
        results.push(`${path} (blocked: ${permission.reason})`);
        continue;
      }
      const result = await upsertActiveFile(projectId, path, content, files, agentRuntime);
      send(res, { type: fileChangedEventType, path, action: result.action, taskId: agentRuntime?.task?.id ?? null });
      results.push(`${path} (${result.action})`);
    }
    return `Written ${results.length} files: ${results.join(', ')}`;
  }

  if (name === 'read_file') {
    const path = String(args.path);
    if (isHiddenByPolicy(path, filePolicy)) {
      return `Path ${path} is ignored by the current file policy.`;
    }
    const file = visibleFiles().find((entry) => entry.path === path || entry.name === path);
    return file ? (file.content || '(empty file)') : `File not found: ${path}. Available files: ${visibleFiles().map((entry) => entry.path).join(', ') || 'none'}`;
  }

  if (name === 'delete_file') {
    const path = String(args.path);
    const permission = canModifyPath(path, filePolicy);
    if (!permission.allowed) return permission.reason;
    const deleted = await deleteActiveFile(projectId, path, files, agentRuntime);
    if (!deleted) return `File not found: ${path}`;
    send(res, { type: fileChangedEventType, path, action: 'deleted', taskId: agentRuntime?.task?.id ?? null });
    return `File ${path} deleted`;
  }

  if (name === 'rename_file') {
    const oldPath = String(args.old_path);
    const newPath = String(args.new_path);
    const oldPermission = canModifyPath(oldPath, filePolicy);
    if (!oldPermission.allowed) return oldPermission.reason;
    const newPermission = canModifyPath(newPath, filePolicy);
    if (!newPermission.allowed) return newPermission.reason;
    const file = agentRuntime?.task
      ? await ProjectTaskFile.findOne({ task_id: agentRuntime.task.id, path: oldPath })
      : await ProjectFile.findOne({ project_id: projectId, path: oldPath });
    if (!file) return `File not found: ${oldPath}`;

    const previousPath = file.path;
    file.path = newPath;
    file.name = newPath.split('/').pop() || newPath;
    file.language = detectLanguage(newPath);
    file.updated_at = new Date();
    await file.save();

    const localFile = files.find((entry) => entry.id === file.id || entry.path === oldPath);
    if (localFile) {
      localFile.path = file.path;
      localFile.name = file.name;
      localFile.language = file.language;
      localFile.updated_at = file.updated_at.toISOString();
    }

    send(res, { type: fileChangedEventType, path: previousPath, action: 'deleted', taskId: agentRuntime?.task?.id ?? null });
    send(res, { type: fileChangedEventType, path: newPath, action: 'created', taskId: agentRuntime?.task?.id ?? null });
    return `Renamed ${oldPath} to ${newPath}`;
  }

  if (name === 'list_files') {
    const currentFiles = visibleFiles();
    if (currentFiles.length === 0) return 'No visible files in project yet.';
    return currentFiles.map((file) => `${file.path} (${file.language})`).join('\n');
  }

  if (name === 'project_map') {
    const query = String(args.query ?? '').trim();
    const docs = Array.isArray(agentRuntime?.projectDocs) ? agentRuntime.projectDocs : [];
    const currentFiles = visibleFiles();
    const summary = buildProjectMapSummary(query || 'current task', currentFiles, docs, filePolicy);
    if (!args.include_content) {
      return summary;
    }
    const selected = selectContextFiles(currentFiles, query || 'current task', filePolicy, 8).selected;
    return `${summary}\n\nRelevant file content:\n${selected.map((file) => formatFileSnippet(file, 3500)).join('\n\n')}`;
  }

  if (name === 'project_memory') {
    return String(agentRuntime?.projectMemory ?? '');
  }

  if (name === 'search_files') {
    const query = String(args.query ?? args.pattern ?? '').toLowerCase();
    const matches = visibleFiles().filter((file) => file.path.toLowerCase().includes(query) || file.name.toLowerCase().includes(query));
    return matches.length > 0 ? matches.map((file) => file.path).join('\n') : `No files matching "${query}"`;
  }

  if (name === 'grep') {
    const pattern = String(args.pattern ?? args.query ?? '');
    const targetPath = args.path ? String(args.path) : null;
    if (targetPath && isHiddenByPolicy(targetPath, filePolicy)) {
      return `Path ${targetPath} is ignored by the current file policy.`;
    }
    const targetFiles = targetPath ? visibleFiles().filter((file) => file.path === targetPath || file.name === targetPath) : visibleFiles();
    const results = [];
    try {
      const regex = new RegExp(pattern, 'gi');
      for (const file of targetFiles) {
        const lines = String(file.content ?? '').split('\n');
        for (const [index, line] of lines.entries()) {
          if (regex.test(line)) results.push(`${file.path}:${index + 1}: ${line.trim()}`);
        }
      }
    } catch {
      for (const file of targetFiles) {
        const lines = String(file.content ?? '').split('\n');
        for (const [index, line] of lines.entries()) {
          if (line.toLowerCase().includes(pattern.toLowerCase())) results.push(`${file.path}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    return results.length > 0
      ? results.slice(0, 100).join('\n') + (results.length > 100 ? `\n... and ${results.length - 100} more matches` : '')
      : `No matches found for "${pattern}"`;
  }

  if (name === 'browse_website') {
    const url = String(args.url ?? args.path ?? '');
    if (!url) return 'Error: url parameter is required';
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) return `HTTP ${response.status} ${response.statusText} — could not fetch ${url}`;
      const contentType = response.headers.get('content-type') ?? '';
      const raw = await response.text();
      if (contentType.includes('application/json')) {
        return `URL: ${url}\nContent-Type: JSON\n\n${raw.slice(0, 20000)}`;
      }
      const stripped = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{3,}/g, '\n\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .trim();
      return `URL: ${url}\n\n${stripped.slice(0, 20000)}${stripped.length > 20000 ? '\n\n[...content truncated — use a more specific URL to see more...]' : ''}`;
    } catch (error) {
      return `Failed to fetch ${url}: ${String(error)}`;
    }
  }

  if (name === 'web_search') {
    const query = String(args.query ?? args.q ?? '');
    const numResults = Number(args.num_results ?? args.n ?? 8);
    if (!query) return 'Error: query parameter is required';
    try {
      const encoded = encodeURIComponent(query);
      const searchResponse = await fetch(`https://ddg-api.herokuapp.com/search?query=${encoded}&limit=${numResults}`, {
        headers: { 'User-Agent': 'LUXI-AI/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (searchResponse.ok) {
        const data = await searchResponse.json();
        if (Array.isArray(data) && data.length > 0) {
          return `Web search results for: "${query}"\n\n${data.map((result, index) => `${index + 1}. **${result.title}**\n   URL: ${result.link}\n   ${result.snippet}`).join('\n\n')}`;
        }
      }

      const fallbackResponse = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {
        headers: { 'User-Agent': 'LUXI-AI/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!fallbackResponse.ok) return `Search failed for: ${query}. Try browse_website with a direct URL.`;
      const fallback = await fallbackResponse.json();
      const results = [];
      if (fallback.AbstractText) results.push(`Summary: ${fallback.AbstractText}\nSource: ${fallback.AbstractURL}`);
      for (const topic of (fallback.RelatedTopics ?? []).slice(0, numResults)) {
        if (topic.Text && topic.FirstURL) results.push(`- ${topic.Text}\n  URL: ${topic.FirstURL}`);
        for (const sub of (topic.Topics ?? []).slice(0, 3)) {
          if (sub.Text && sub.FirstURL) results.push(`  - ${sub.Text}\n    URL: ${sub.FirstURL}`);
        }
      }
      if (results.length > 0) {
        return `Web search results for: "${query}"\n\n${results.join('\n\n')}`;
      }

      const htmlResponse = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (htmlResponse.ok) {
        const html = await htmlResponse.text();
        const links = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
          .slice(0, numResults);
        const snippets = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];
        const parsed = links.map((match, index) => {
          const rawUrl = match[1] ?? '';
          let finalUrl = rawUrl;
          try {
            const url = new URL(rawUrl, 'https://html.duckduckgo.com');
            finalUrl = url.searchParams.get('uddg') || rawUrl;
          } catch {}
          const title = decodeHtmlEntities(match[2] ?? '');
          const snippet = decodeHtmlEntities(snippets[index]?.[1] ?? snippets[index]?.[2] ?? '');
          return `- ${title}\n  URL: ${finalUrl}${snippet ? `\n  ${snippet}` : ''}`;
        }).filter(Boolean);
        if (parsed.length > 0) {
          return `Web search results for: "${query}"\n\n${parsed.join('\n\n')}`;
        }
      }

      return `No results found for: "${query}". Try browse_website with a known URL.`;
    } catch (error) {
      return `Search error: ${String(error)}. Try browse_website with a direct URL instead.`;
    }
  }

  if (name === 'github_context') {
    try {
      const data = await loadGitHubContext(agentRuntime.project, agentRuntime.userId, args);
      return `GitHub context (${String(args.kind ?? 'pulls')}):\n${JSON.stringify(data, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `GitHub context failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'security_scope') {
    try {
      const profile = await ensureProjectSecurityProfile(agentRuntime.project.id, agentRuntime.userId);
      const scopeSummary = {
        scope: profile.scope ?? {},
        auth_profiles: Array.isArray(profile.auth_profiles) ? profile.auth_profiles : [],
        continuous_scans: Array.isArray(profile.continuous_scans) ? profile.continuous_scans : [],
      };
      return `Security scope:\n${JSON.stringify(scopeSummary, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Security scope failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'surface_map') {
    try {
      const docs = Array.isArray(agentRuntime?.projectDocs) ? agentRuntime.projectDocs : [];
      const captures = await TrafficCapture.find({ project_id: agentRuntime.project.id, user_id: agentRuntime.userId }).sort({ updated_at: -1 }).limit(10);
      const surface = buildAttackSurfaceSummary(
        agentRuntime.project,
        visibleFiles(),
        docs,
        captures.map((capture) => ({
          id: capture.id,
          name: capture.name,
          request_count: capture.request_count,
          hosts: capture.hosts ?? [],
          endpoints: capture.endpoints ?? [],
        })),
      );
      return `Attack surface:\n${JSON.stringify(surface, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Surface mapping failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'api_spec_summary') {
    try {
      const specs = summarizeApiSpecs(visibleFiles(), Array.isArray(agentRuntime?.projectDocs) ? agentRuntime.projectDocs : []);
      if (specs.length === 0) return 'No OpenAPI or Swagger spec detected in the visible files or docs.';
      return `API specs:\n${JSON.stringify(specs, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `API spec summary failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'run_security_scan') {
    try {
      const docs = Array.isArray(agentRuntime?.projectDocs) ? agentRuntime.projectDocs : [];
      const [checks, captures] = await Promise.all([
        SecurityCustomCheck.find({ project_id: agentRuntime.project.id, user_id: agentRuntime.userId, enabled: true }).sort({ updated_at: -1 }),
        TrafficCapture.find({ project_id: agentRuntime.project.id, user_id: agentRuntime.userId }).sort({ updated_at: -1 }).limit(10),
      ]);
      const scan = await runSecurityScan(agentRuntime.project, visibleFiles(), docs, {
        customChecks: checks.map((check) => ({
          id: check.id,
          name: check.name,
          description: check.description,
          kind: check.kind,
          severity: check.severity,
          pattern: check.pattern,
          file_glob: check.file_glob,
          dependency_name: check.dependency_name,
          remediation: check.remediation,
          standards: check.standards,
          tags: check.tags,
          enabled: check.enabled !== false,
        })),
        trafficCaptures: captures.map((capture) => ({
          id: capture.id,
          name: capture.name,
          request_count: capture.request_count,
          hosts: capture.hosts ?? [],
          endpoints: capture.endpoints ?? [],
        })),
      });
      const persist = args.persist !== false;
      const persisted = persist
        ? await persistSecurityFindings(agentRuntime.project.id, agentRuntime.userId, scan.findings, {
          source: 'agent-scan',
          taskId: agentRuntime?.task?.id ?? null,
        })
        : [];
      return `Security scan complete.\nFindings: ${scan.findings.length}\nPersisted: ${persisted.length}\n\n${JSON.stringify({
        attack_surface: scan.attack_surface,
        api_specs: scan.api_specs,
        findings: scan.findings,
      }, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Security scan failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'list_findings') {
    try {
      const query = { project_id: agentRuntime.project.id, user_id: agentRuntime.userId };
      const findings = await SecurityFinding.find(query).sort({ updated_at: -1 }).limit(Math.max(1, Math.min(Number(args.limit ?? 50), 100)));
      const filtered = findings.filter((finding) => {
        if (args.status && String(args.status).trim().toLowerCase() !== String(finding.status ?? '').trim().toLowerCase()) return false;
        if (args.severity && String(args.severity).trim().toLowerCase() !== String(finding.severity ?? '').trim().toLowerCase()) return false;
        return true;
      });
      if (filtered.length === 0) return 'No findings found for the requested filters.';
      return `Findings:\n${JSON.stringify(filtered.map((finding) => ({
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        status: finding.status,
        category: finding.category,
        summary: finding.summary,
        affected_paths: finding.affected_paths ?? [],
        standards: finding.standards ?? [],
        updated_at: finding.updated_at,
      })), null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Listing findings failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'save_finding') {
    try {
      const title = String(args.title ?? '').trim();
      if (!title) return 'Error: title is required to save a finding.';
      const persisted = await persistSecurityFindings(agentRuntime.project.id, agentRuntime.userId, [{
        title,
        category: String(args.category ?? 'security').trim(),
        severity: normalizeSecuritySeverity(args.severity),
        status: normalizeFindingStatus(args.status),
        summary: String(args.summary ?? '').trim(),
        impact: String(args.impact ?? '').trim(),
        recommendation: String(args.recommendation ?? '').trim(),
        affected_paths: Array.isArray(args.affected_paths) ? args.affected_paths : String(args.affected_paths ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean),
        affected_urls: Array.isArray(args.affected_urls) ? args.affected_urls : String(args.affected_urls ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean),
        standards: Array.isArray(args.standards) ? args.standards : String(args.standards ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean),
        tags: Array.isArray(args.tags) ? args.tags : String(args.tags ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean),
        evidence: Array.isArray(args.evidence)
          ? args.evidence
          : String(args.evidence ?? '').trim()
            ? [{ label: 'Evidence', details: String(args.evidence).trim(), source: '' }]
            : [],
        reproduction_steps: Array.isArray(args.reproduction_steps) ? args.reproduction_steps : String(args.reproduction_steps ?? '').split(/\n|,/).map((entry) => entry.trim()).filter(Boolean),
        regression_check: String(args.regression_check ?? '').trim(),
        fix_validation: String(args.fix_validation ?? '').trim(),
        triage_owner: String(args.triage_owner ?? '').trim(),
        dedupe_key: String(args.dedupe_key ?? '').trim(),
        source: String(args.source ?? 'agent').trim() || 'agent',
        task_id: agentRuntime?.task?.id ?? null,
      }], {
        source: 'agent',
        taskId: agentRuntime?.task?.id ?? null,
      });
      return `Saved finding:\n${JSON.stringify(persisted[0], null, 2).slice(0, 12000)}`;
    } catch (error) {
      return `Saving finding failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'generate_security_report') {
    try {
      const docs = Array.isArray(agentRuntime?.projectDocs) ? agentRuntime.projectDocs : [];
      const filesForSecurity = visibleFiles();
      const trafficCaptures = await TrafficCapture.find({ project_id: agentRuntime.project.id, user_id: agentRuntime.userId }).sort({ updated_at: -1 }).limit(10);
      const report = await createSecurityReport(agentRuntime.project, agentRuntime.userId, {
        title: args.title,
        summary: args.summary,
        status: args.status,
        finding_ids: Array.isArray(args.finding_ids) ? args.finding_ids : [],
        attack_surface: buildAttackSurfaceSummary(agentRuntime.project, filesForSecurity, docs, trafficCaptures.map((capture) => ({
          id: capture.id,
          name: capture.name,
          request_count: capture.request_count,
          hosts: capture.hosts ?? [],
          endpoints: capture.endpoints ?? [],
        }))),
        api_specs: summarizeApiSpecs(filesForSecurity, docs),
        traffic_captures: trafficCaptures.map((capture) => ({
          id: capture.id,
          name: capture.name,
          request_count: capture.request_count,
          hosts: capture.hosts ?? [],
          endpoints: capture.endpoints ?? [],
        })),
      });
      return `Generated security report:\n${JSON.stringify(report, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Generating security report failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'create_oast_session') {
    try {
      const baseUrl = String(args.base_url ?? agentRuntime?.runtimeContext?.publicBaseUrl ?? '').trim();
      if (!baseUrl) {
        return 'OAST session creation failed: no public base URL is configured for this environment.';
      }
      const session = await createSecurityOastSession(agentRuntime.project.id, agentRuntime.userId, args.label, baseUrl);
      return `OAST session:\n${JSON.stringify(session, null, 2).slice(0, 12000)}`;
    } catch (error) {
      return `OAST session failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'traffic_capture_summary') {
    try {
      const captureId = Number(args.capture_id ?? args.captureId ?? args.id);
      if (!Number.isFinite(captureId)) return 'Error: capture_id is required.';
      const capture = await TrafficCapture.findOne({ id: captureId, project_id: agentRuntime.project.id, user_id: agentRuntime.userId });
      if (!capture) return `Traffic capture ${captureId} not found.`;
      const detail = buildTrafficCaptureDetail(capture);
      return `Traffic capture detail:\n${JSON.stringify(detail, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Traffic capture summary failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'replay_traffic_request') {
    try {
      const captureId = Number(args.capture_id ?? args.captureId ?? args.id);
      if (!Number.isFinite(captureId)) return 'Error: capture_id is required.';
      const capture = await TrafficCapture.findOne({ id: captureId, project_id: agentRuntime.project.id, user_id: agentRuntime.userId });
      if (!capture) return `Traffic capture ${captureId} not found.`;
      const profile = await ensureProjectSecurityProfile(agentRuntime.project.id, agentRuntime.userId);
      const replay = await replayTrafficCaptureEntry(
        capture,
        args.entry_id ?? args.entryId ?? args.entry ?? args.order,
        profile,
        { timeoutMs: args.timeoutMs ?? args.timeout },
      );
      return `Traffic replay:\n${JSON.stringify(replay, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Traffic replay failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'replay_traffic_flow') {
    try {
      const captureId = Number(args.capture_id ?? args.captureId ?? args.id);
      if (!Number.isFinite(captureId)) return 'Error: capture_id is required.';
      const capture = await TrafficCapture.findOne({ id: captureId, project_id: agentRuntime.project.id, user_id: agentRuntime.userId });
      if (!capture) return `Traffic capture ${captureId} not found.`;
      const profile = await ensureProjectSecurityProfile(agentRuntime.project.id, agentRuntime.userId);
      const replay = await replayTrafficCaptureFlow(capture, profile, {
        chainIndex: args.chain_index ?? args.chainIndex,
        entryIds: args.entry_ids ?? args.entryIds,
        startOrder: args.start_order ?? args.startOrder ?? args.from_order ?? args.fromOrder,
        endOrder: args.end_order ?? args.endOrder ?? args.to_order ?? args.toOrder,
        carryCookies: args.carry_cookies ?? args.carryCookies,
        stopOnFailure: args.stop_on_failure ?? args.stopOnFailure,
        timeoutMs: args.timeoutMs ?? args.timeout,
      });
      return `Traffic flow replay:\n${JSON.stringify(replay, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Traffic flow replay failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'reverse_engineer_project') {
    try {
      const docs = Array.isArray(agentRuntime?.projectDocs) ? agentRuntime.projectDocs : [];
      const captures = await TrafficCapture.find({ project_id: agentRuntime.project.id, user_id: agentRuntime.userId }).sort({ updated_at: -1 }).limit(10);
      const analysis = analyzeProjectReverseEngineering(agentRuntime.project, visibleFiles(), docs, captures);
      return `Reverse engineering summary:\n${JSON.stringify(analysis, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Reverse engineering failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'traffic_flow_graph') {
    try {
      const captureId = Number(args.capture_id ?? args.captureId ?? args.id);
      if (!Number.isFinite(captureId)) return 'Error: capture_id is required.';
      const capture = await TrafficCapture.findOne({ id: captureId, project_id: agentRuntime.project.id, user_id: agentRuntime.userId });
      if (!capture) return `Traffic capture ${captureId} not found.`;
      const flow = buildTrafficFlowGraph(capture);
      return `Traffic flow graph:\n${JSON.stringify(flow, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Traffic flow graph failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'mutate_traffic_request') {
    try {
      const captureId = Number(args.capture_id ?? args.captureId ?? args.id);
      if (!Number.isFinite(captureId)) return 'Error: capture_id is required.';
      const capture = await TrafficCapture.findOne({ id: captureId, project_id: agentRuntime.project.id, user_id: agentRuntime.userId });
      if (!capture) return `Traffic capture ${captureId} not found.`;
      const profile = await ensureProjectSecurityProfile(agentRuntime.project.id, agentRuntime.userId);
      const result = await mutateTrafficCaptureEntry(
        capture,
        args.entry_id ?? args.entryId ?? args.entry ?? args.order,
        profile,
        args.mutations ?? args,
        { timeoutMs: args.timeoutMs ?? args.timeout },
      );
      return `Traffic mutation replay:\n${JSON.stringify(result, null, 2).slice(0, 18000)}`;
    } catch (error) {
      return `Traffic mutation failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'run_command') {
    const command = String(args.command ?? args.cmd ?? '');
    const cwd = args.cwd ? String(args.cwd) : undefined;
    const timeout = args.timeout ? Number(args.timeout) : 30000;
    if (!command) return 'Error: command parameter is required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return `[RUNNER NOT CONNECTED]\n$ ${command}\n\nTo enable real command execution, configure the runner in Admin → Runner.`;
    }

    try {
      await syncProjectFilesToRunner(executionProjectId, files);
      const result = await runnerFetch('/run', {
        command,
        projectId: String(executionProjectId),
        cwd,
        timeout,
      }, timeout + 5000);
      let output = '';
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? '\n[stderr]\n' : '') + result.stderr;
      return `Exit code: ${result.exitCode}\n$ ${command}\n${output || '(no output)'}`.slice(0, 30000);
    } catch (error) {
      return `Command failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'install_package') {
    const packages = args.packages;
    const manager = String(args.manager ?? 'npm');
    const cwd = args.cwd ? String(args.cwd) : undefined;
    const pkgStr = Array.isArray(packages) ? packages.join(' ') : String(packages ?? '');
    if (!pkgStr) return 'Error: packages required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return `[RUNNER NOT CONNECTED] Would run: ${manager} install ${pkgStr}\n\nConfigure the runner to enable real package installation.`;
    }

    try {
      await syncProjectFilesToRunner(executionProjectId, files);
      const result = await runnerFetch('/install', {
        projectId: String(executionProjectId),
        packages: Array.isArray(packages) ? packages : pkgStr.split(' '),
        manager,
        cwd,
      }, 120000);
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return `Exit code: ${result.exitCode}\nInstalled ${pkgStr} via ${manager}\n${out.slice(0, 10000)}`;
    } catch (error) {
      return `Install failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'execute_code') {
    const code = String(args.code ?? '');
    const language = String(args.language ?? 'python').toLowerCase();
    const stdin = args.stdin ? String(args.stdin) : undefined;
    if (!code) return 'Error: code parameter is required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return `[RUNNER NOT CONNECTED] Would execute ${language} code (${code.length} chars)\n\nConfigure the runner to enable real code execution.`;
    }

    const langCmd = {
      python: 'python3', python3: 'python3', py: 'python3',
      javascript: 'node', js: 'node', node: 'node',
      bash: 'bash', sh: 'bash', shell: 'bash',
      ruby: 'ruby', rb: 'ruby',
      go: 'go run',
      rust: 'rustc',
    };
    const interpreter = langCmd[language];
    if (!interpreter) {
      return `Unsupported language: ${language}. Supported: python, javascript, bash, ruby, go`;
    }

    const ext = { python: 'py', javascript: 'js', bash: 'sh', ruby: 'rb', go: 'go', rust: 'rs' };
    const tmpFile = `/tmp/luxi_exec_${Date.now()}.${ext[language] ?? 'txt'}`;
    const stdinPipe = stdin ? `echo ${JSON.stringify(stdin)} | ` : '';
    const runCmd = language === 'go'
      ? `echo ${JSON.stringify(code)} > ${tmpFile} && go run ${tmpFile}`
      : `echo ${JSON.stringify(code)} > ${tmpFile} && ${stdinPipe}${interpreter} ${tmpFile}`;

    try {
      const result = await runnerFetch('/run', {
        command: runCmd,
        projectId: String(executionProjectId),
        timeout: 30000,
      }, 35000);
      let out = '';
      if (result.stdout) out += result.stdout;
      if (result.stderr) out += (out ? '\n[stderr]\n' : '') + result.stderr;
      return `Exit code: ${result.exitCode}\n${out || '(no output)'}`.slice(0, 20000);
    } catch (error) {
      return `Execution failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'read_local_file') {
    const filePath = String(args.path ?? '');
    if (!filePath) return 'Error: path required';
    const runner = await getRunnerOrNull();
    if (!runner) return '[RUNNER NOT CONNECTED] Cannot read local files without runner.';
    try {
      const result = await runnerFetch('/read', {
        projectId: String(executionProjectId),
        filePath,
      });
      return result.content;
    } catch (error) {
      return `Failed to read ${filePath}: ${String(error)}`;
    }
  }

  if (name === 'write_local_file') {
    const filePath = String(args.path ?? '');
    const content = String(args.content ?? '');
    if (!filePath) return 'Error: path required';
    const runner = await getRunnerOrNull();
    if (!runner) return '[RUNNER NOT CONNECTED] Cannot write local files without runner.';
    try {
      await runnerFetch('/write', {
        projectId: String(executionProjectId),
        filePath,
        content,
      });
      return `Written ${filePath} (${content.length} chars)`;
    } catch (error) {
      return `Failed to write ${filePath}: ${String(error)}`;
    }
  }

  if (name === 'list_local_dir') {
    const dir = String(args.dir ?? args.path ?? '.');
    const runner = await getRunnerOrNull();
    if (!runner) return '[RUNNER NOT CONNECTED] Cannot list local files without runner.';
    try {
      const result = await runnerFetch('/ls', {
        projectId: String(executionProjectId),
        dir,
      });
      return result.entries?.length > 0
        ? result.entries.map((entry) => `${entry.type === 'dir' ? '📁' : '📄'} ${entry.path}`).join('\n')
        : `Directory ${dir} is empty`;
    } catch (error) {
      return `Failed to list ${dir}: ${String(error)}`;
    }
  }

  if (name === 'sync_runner_workspace') {
    const runner = await getRunnerOrNull();
    if (!runner) return '[RUNNER NOT CONNECTED] Cannot sync runner files without runner.';
    try {
      const sync = await syncRunnerWorkspaceFromRunner(projectId, files, agentRuntime);
      if (!sync) return '[RUNNER NOT CONNECTED] Cannot sync runner files without runner.';

      if (sync.created || sync.updated || sync.removed) {
        send(res, { type: fileChangedEventType, path: '.runner-sync', action: 'updated', taskId: agentRuntime?.task?.id ?? null });
        send(res, { type: 'message', content: `Runner sync imported ${sync.imported} files (${sync.created} created, ${sync.updated} updated, ${sync.removed} removed).` });
      }

      const parts = [
        `Runner workspace synced.`,
        `Imported: ${sync.imported}`,
        `Created: ${sync.created}`,
        `Updated: ${sync.updated}`,
        `Removed: ${sync.removed}`,
        `Skipped: ${sync.skipped}`,
      ];
      if (sync.truncated) parts.push('Warning: sync truncated due to import limits.');
      return parts.join('\n');
    } catch (error) {
      return `Runner sync failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'start_background_command') {
    const command = String(args.command ?? args.cmd ?? '');
    const cwd = args.cwd ? String(args.cwd) : undefined;
    const sessionId = String(args.sessionId ?? args.name ?? '').trim();
    const startupTimeoutMs = args.startupTimeoutMs ? Number(args.startupTimeoutMs) : 20000;
    const pollIntervalMs = args.pollIntervalMs ? Number(args.pollIntervalMs) : 800;
    if (!command) return 'Error: command parameter is required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return '[RUNNER NOT CONNECTED] start_background_command requires the runner.';
    }

    try {
      await syncProjectFilesToRunner(executionProjectId, files);
      const started = await runnerFetch('/process/start', {
        command,
        projectId: String(executionProjectId),
        cwd,
        sessionId,
      }, 15000);

      const hasReadinessCheck = args.url !== undefined || args.port !== undefined;
      if (!hasReadinessCheck) {
        return formatBackgroundProcessResult(`Background command started`, started);
      }

      const deadline = Date.now() + Math.max(startupTimeoutMs, 1000);
      let latest = started;
      let readiness = null;
      while (Date.now() < deadline) {
        latest = await runnerFetch('/process/status', {
          projectId: String(executionProjectId),
          sessionId: started.sessionId,
          url: args.url,
          port: args.port,
          host: args.host,
          protocol: args.protocol,
          path: args.path,
          timeout: Math.min(Math.max(pollIntervalMs, 250), 5000),
        }, Math.min(Math.max(pollIntervalMs, 250), 5000) + 2000);
        readiness = latest.readiness ?? null;
        if (readiness?.ready) break;
        if (latest.status && latest.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(pollIntervalMs, 250), 3000)));
      }

      return formatBackgroundProcessResult(
        readiness?.ready ? 'Background command started and responded to readiness checks' : 'Background command started but readiness is still pending',
        latest,
        readiness,
      );
    } catch (error) {
      return `Background command failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'check_background_command') {
    const sessionId = String(args.sessionId ?? '').trim();
    if (!sessionId) return 'Error: sessionId parameter is required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return '[RUNNER NOT CONNECTED] check_background_command requires the runner.';
    }

    try {
      const status = await runnerFetch('/process/status', {
        projectId: String(executionProjectId),
        sessionId,
        url: args.url,
        port: args.port,
        host: args.host,
        protocol: args.protocol,
        path: args.path,
        timeout: args.timeout,
      }, 12000);
      return formatBackgroundProcessResult('Background command status', status, status.readiness ?? null);
    } catch (error) {
      return `Background status failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'stop_background_command') {
    const sessionId = String(args.sessionId ?? '').trim();
    if (!sessionId) return 'Error: sessionId parameter is required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return '[RUNNER NOT CONNECTED] stop_background_command requires the runner.';
    }

    try {
      const stopped = await runnerFetch('/process/stop', {
        projectId: String(executionProjectId),
        sessionId,
        signal: args.signal,
      }, 12000);
      return formatBackgroundProcessResult('Background command stop result', stopped, stopped.readiness ?? null);
    } catch (error) {
      return `Background stop failed: ${formatToolError(error)}`;
    }
  }

  if (name === 'browser_action') {
    const action = String(args.action ?? '');
    if (!action) return 'Error: action parameter is required';

    const runner = await getRunnerOrNull();
    if (!runner) {
      return '[RUNNER NOT CONNECTED] browser_action requires the runner with Puppeteer installed.';
    }

    const payload = { action };
    payload.projectId = String(executionProjectId);
    for (const field of ['sessionId', 'url', 'selector', 'text', 'label', 'name', 'id', 'placeholder', 'targetText', 'value', 'script', 'x', 'y', 'button', 'waitFor', 'waitUntil', 'timeout', 'fullPage', 'attribute', 'cookies', 'delay', 'clear', 'frameName', 'frameUrl', 'frameIndex', 'limit', 'includeFrames', 'fields', 'submit', 'operations', 'headless']) {
      if (args[field] !== undefined) payload[field] = args[field];
    }
    if (!payload.sessionId && agentRuntime?.browserSessionId) {
      payload.sessionId = agentRuntime.browserSessionId;
    }
    if (agentRuntime?.manualBrowser && payload.headless === undefined) {
      payload.headless = false;
    }

    const normalizedAction = action.toLowerCase();
    const retries = getBrowserRetryCount(normalizedAction, args);
    const retryDelayMs = toInt(args.retryDelayMs, 600, 100, 5000);
    const attempts = retries + 1;
    let lastFailure = '';
    let lastBlocker = null;

    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const nextPayload = getBrowserAttemptPayload(payload, normalizedAction, attempt);
        const timeout = toInt(nextPayload.timeout, toInt(args.timeout, 30000, 1000, 180000), 1000, 180000);

        try {
          const result = await runnerFetch('/browser', nextPayload, timeout + 5000);
          if (!result.ok) {
            throw new Error(result.error ?? JSON.stringify(result));
          }

          const parts = [`Action: ${action} — OK`];
          const blocker = result.blocker ?? result.challenge;
          const sessionId = String(nextPayload.sessionId ?? 'default');
          if (attempt > 0) parts.push(`Recovered after retry ${attempt}/${attempts - 1}`);
          if (sessionId) parts.push(`Session: ${sessionId}`);
          if (result.url) parts.push(`URL: ${result.url}`);
          if (result.title) parts.push(`Title: ${result.title}`);
          if (result.waitUntil) parts.push(`Wait strategy: ${result.waitUntil}`);
          if (result.locator) parts.push(`Locator: ${result.locator}`);
          if (result.message) parts.push(String(result.message));
          if (blocker?.detected) {
            parts.push(`Blocker detected: ${String(blocker.summary ?? 'Site protection challenge detected.')}`);
            if (blocker.kind) parts.push(`Blocker kind: ${String(blocker.kind)}`);
            if (blocker.requiresHuman) parts.push('Requires manual verification in the same browser session before continuing.');
            if (Array.isArray(blocker.hints) && blocker.hints.length > 0) {
              parts.push(`Hints: ${blocker.hints.slice(0, 2).join(' ')}`);
            }
          }
          if (result.fields) parts.push(`Fields: ${JSON.stringify(result.fields).slice(0, 7000)}`);
          if (result.updates) parts.push(`DOM updates: ${JSON.stringify(result.updates).slice(0, 7000)}`);
          if (result.text) parts.push(`Text content:\n${String(result.text).slice(0, 10000)}`);
          if (result.html) parts.push(`HTML:\n${String(result.html).slice(0, 20000)}`);
          if (result.result !== undefined) parts.push(`Result: ${result.result}`);
          if (result.info) parts.push(`Element info: ${JSON.stringify(result.info).slice(0, 5000)}`);
          if (result.elements) parts.push(`Elements found: ${JSON.stringify(result.elements).slice(0, 5000)}`);
          if (result.frames) parts.push(`Frames: ${JSON.stringify(result.frames).slice(0, 7000)}`);
          if (result.logs) parts.push(`Logs: ${JSON.stringify(result.logs).slice(0, 7000)}`);
          if (result.value !== undefined) parts.push(`Attribute value: ${result.value}`);
          if (result.cookies) parts.push(`Cookies: ${JSON.stringify(result.cookies).slice(0, 2000)}`);
          const visualSummary = await maybeCollectBrowserVisualSummary(agentRuntime, sessionId, normalizedAction, result);
          if (visualSummary) parts.push(visualSummary);

          if (blocker?.detected && blocker.requiresHuman && agentRuntime?.manualBrowser) {
            const handoffMessage = `${String(blocker.summary ?? 'The site is asking for a human verification step.')} Complete the step in the visible browser window and then send the next instruction to resume the same session.`;
            send(res, {
              type: 'browser_handoff',
              sessionId,
              content: handoffMessage,
              requiresVisibleBrowser: true,
            });
            parts.push(`[MANUAL_BROWSER_HANDOFF] ${handoffMessage}`);
          }
          return parts.join('\n');
        } catch (error) {
          lastFailure = formatToolError(error);
          lastBlocker = extractBlockerFromBrowserFailure(lastFailure) ?? (isChallengeBlockerMessage(lastFailure) ? { detected: true, summary: 'Challenge or anti-bot blocker detected in browser error.', kind: 'blocked' } : null);
          const canRetry = attempt < attempts - 1
            && RETRYABLE_BROWSER_ACTIONS.has(normalizedAction)
            && !lastBlocker?.detected
            && isRetryableBrowserErrorMessage(lastFailure);
          if (!canRetry) break;
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
      }

      let diagnostic = '';
      try {
        const diagnosticResult = await runnerFetch('/browser', {
          action: 'logs',
          projectId: String(executionProjectId),
          sessionId: payload.sessionId ?? 'default',
          limit: 8,
        }, 10000);
        if (diagnosticResult?.ok && diagnosticResult?.logs) {
          const summary = summarizeBrowserLogs(diagnosticResult.logs);
          diagnostic = summary ? `\n${summary}` : '';
        }
      } catch {}

      if (!lastBlocker?.detected) {
        try {
          const blockerResult = await runnerFetch('/browser', {
            action: 'challenge_status',
            projectId: String(executionProjectId),
            sessionId: payload.sessionId ?? 'default',
            includeFrames: true,
          }, 12000);
          const blocker = blockerResult?.blocker ?? blockerResult?.challenge;
          if (blocker?.detected) {
            lastBlocker = blocker;
          }
        } catch {}
      }

      if (lastBlocker?.detected) {
        const blockerSummary = formatBlockerSummary(lastBlocker);
        const sessionId = String(payload.sessionId ?? 'default');
        const handoffMessage = `Browser action blocked after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${blockerSummary || 'Site protection challenge detected.'}${diagnostic}`;
        if (agentRuntime?.manualBrowser) {
          send(res, {
            type: 'browser_handoff',
            sessionId,
            content: `${handoffMessage}\nResume later by continuing the same conversation; the agent will reuse this session.`,
            requiresVisibleBrowser: true,
          });
          return `[MANUAL_BROWSER_HANDOFF]\n${handoffMessage}\nSession: ${sessionId}`;
        }
        return handoffMessage;
      }

      return `Browser action failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${lastFailure || 'Unknown browser error'}${diagnostic}`;
    } catch (error) {
      return `Browser action failed: ${formatToolError(error)}`;
    }
  }

  return `Unknown tool: ${name}`;
}

const GEMINI_TOOL_DECLARATIONS = [
  { name: 'write_file', description: 'Create or overwrite a file with complete content', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] } },
  { name: 'patch_file', description: 'Apply multiple targeted text edits to one file. Supports replace, replace_all, insert_before, insert_after, prepend, and append operations.', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, operations: { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING' }, old_str: { type: 'STRING' }, anchor: { type: 'STRING' }, new_str: { type: 'STRING' }, content: { type: 'STRING' }, occurrence: { type: 'NUMBER' } } } } }, required: ['path', 'operations'] } },
  { name: 'edit_file', description: 'Make a targeted edit by replacing exact text in a file. Faster than rewriting whole files.', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, old_str: { type: 'STRING' }, new_str: { type: 'STRING' } }, required: ['path', 'old_str', 'new_str'] } },
  { name: 'batch_write_files', description: 'Write multiple files at once. Use for creating full projects.', parameters: { type: 'OBJECT', properties: { files: { type: 'ARRAY', items: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] } } }, required: ['files'] } },
  { name: 'read_file', description: 'Read a file', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] } },
  { name: 'delete_file', description: 'Delete a file', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] } },
  { name: 'rename_file', description: 'Rename or move a file', parameters: { type: 'OBJECT', properties: { old_path: { type: 'STRING' }, new_path: { type: 'STRING' } }, required: ['old_path', 'new_path'] } },
  { name: 'list_files', description: 'List all project files', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'project_map', description: 'Summarize the project stack, likely entrypoints, important scripts, tests, and files relevant to a request.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, include_content: { type: 'BOOLEAN' } } } },
  { name: 'project_memory', description: 'Load persistent repo memory, active tasks, important commands, and high-level architecture context.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'search_files', description: 'Search file names by pattern', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
  { name: 'grep', description: 'Search file contents for a pattern', parameters: { type: 'OBJECT', properties: { pattern: { type: 'STRING' }, path: { type: 'STRING' } }, required: ['pattern'] } },
  { name: 'browse_website', description: 'Fetch and read any website, docs, GitHub, or API endpoint. Use after web_search to read a specific page.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
  { name: 'web_search', description: 'Search the web for current info, docs, packages, APIs, research. Use FIRST before browse_website.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, num_results: { type: 'NUMBER' } }, required: ['query'] } },
  { name: 'github_context', description: 'Load GitHub pull request, issue, commit, or CI check context for the connected repository.', parameters: { type: 'OBJECT', properties: { kind: { type: 'STRING' }, state: { type: 'STRING' }, number: { type: 'NUMBER' }, limit: { type: 'NUMBER' }, ref: { type: 'STRING' } } } },
  { name: 'security_scope', description: 'Load the project security scope, auth profiles, blocked hosts, and continuous scan settings.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'surface_map', description: 'Build an attack-surface summary including routes, forms, auth files, CI/IaC files, external hosts, and API specs.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'api_spec_summary', description: 'Summarize any OpenAPI or Swagger specs found in project files or docs.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'run_security_scan', description: 'Run built-in repo security heuristics plus custom checks. Persist findings by default.', parameters: { type: 'OBJECT', properties: { persist: { type: 'BOOLEAN' } } } },
  { name: 'list_findings', description: 'List saved structured security findings for this project.', parameters: { type: 'OBJECT', properties: { status: { type: 'STRING' }, severity: { type: 'STRING' }, limit: { type: 'NUMBER' } } } },
  { name: 'save_finding', description: 'Save or update a structured security finding with severity, impact, evidence, repro, and remediation.', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, category: { type: 'STRING' }, severity: { type: 'STRING' }, status: { type: 'STRING' }, summary: { type: 'STRING' }, impact: { type: 'STRING' }, recommendation: { type: 'STRING' }, affected_paths: { type: 'ARRAY', items: { type: 'STRING' } }, affected_urls: { type: 'ARRAY', items: { type: 'STRING' } }, standards: { type: 'ARRAY', items: { type: 'STRING' } }, tags: { type: 'ARRAY', items: { type: 'STRING' } }, evidence: { type: 'ARRAY', items: { type: 'OBJECT' } }, reproduction_steps: { type: 'ARRAY', items: { type: 'STRING' } }, regression_check: { type: 'STRING' }, fix_validation: { type: 'STRING' }, triage_owner: { type: 'STRING' }, dedupe_key: { type: 'STRING' }, source: { type: 'STRING' } }, required: ['title'] } },
  { name: 'generate_security_report', description: 'Generate a security evidence pack and report from saved findings.', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, summary: { type: 'STRING' }, status: { type: 'STRING' }, finding_ids: { type: 'ARRAY', items: { type: 'NUMBER' } } } } },
  { name: 'create_oast_session', description: 'Create a unique callback URL for blind SSRF, webhook, or out-of-band testing.', parameters: { type: 'OBJECT', properties: { label: { type: 'STRING' }, base_url: { type: 'STRING' } } } },
  { name: 'traffic_capture_summary', description: 'Load an imported HAR capture with reverse-engineering notes, replayable entries, and exact request templates.', parameters: { type: 'OBJECT', properties: { capture_id: { type: 'NUMBER' } }, required: ['capture_id'] } },
  { name: 'replay_traffic_request', description: 'Replay a captured HAR request as faithfully as possible and compare the live response to the original capture.', parameters: { type: 'OBJECT', properties: { capture_id: { type: 'NUMBER' }, entry_id: { type: 'STRING' }, timeoutMs: { type: 'NUMBER' } }, required: ['capture_id'] } },
  { name: 'replay_traffic_flow', description: 'Replay a multi-step HAR flow with cookie carryover and return a reusable Node replay script.', parameters: { type: 'OBJECT', properties: { capture_id: { type: 'NUMBER' }, chain_index: { type: 'NUMBER' }, entry_ids: { type: 'ARRAY', items: { type: 'STRING' } }, start_order: { type: 'NUMBER' }, end_order: { type: 'NUMBER' }, carry_cookies: { type: 'BOOLEAN' }, stop_on_failure: { type: 'BOOLEAN' }, timeoutMs: { type: 'NUMBER' } }, required: ['capture_id'] } },
  { name: 'reverse_engineer_project', description: 'Analyze source and bundled client code for hidden endpoints, auth clues, source maps, GraphQL operations, and websocket targets.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'traffic_flow_graph', description: 'Reconstruct request chains, cookie handoffs, referer edges, and same-host flow segments from a HAR capture.', parameters: { type: 'OBJECT', properties: { capture_id: { type: 'NUMBER' } }, required: ['capture_id'] } },
  { name: 'mutate_traffic_request', description: 'Apply controlled header/query/body mutations to a HAR-derived request and replay it.', parameters: { type: 'OBJECT', properties: { capture_id: { type: 'NUMBER' }, entry_id: { type: 'STRING' }, mutations: { type: 'OBJECT' }, timeoutMs: { type: 'NUMBER' } }, required: ['capture_id'] } },
  { name: 'run_command', description: 'Execute a real shell command on the connected runner. Returns actual output.', parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' }, cwd: { type: 'STRING' }, timeout: { type: 'NUMBER' } }, required: ['command'] } },
  { name: 'start_background_command', description: 'Start a long-running command on the runner and keep it alive for later checks or browser tests.', parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' }, cwd: { type: 'STRING' }, sessionId: { type: 'STRING' }, name: { type: 'STRING' }, port: { type: 'NUMBER' }, host: { type: 'STRING' }, protocol: { type: 'STRING' }, path: { type: 'STRING' }, url: { type: 'STRING' }, startupTimeoutMs: { type: 'NUMBER' }, pollIntervalMs: { type: 'NUMBER' } }, required: ['command'] } },
  { name: 'check_background_command', description: 'Check a previously started background command, tail logs, and optionally test readiness on a local URL.', parameters: { type: 'OBJECT', properties: { sessionId: { type: 'STRING' }, port: { type: 'NUMBER' }, host: { type: 'STRING' }, protocol: { type: 'STRING' }, path: { type: 'STRING' }, url: { type: 'STRING' }, timeout: { type: 'NUMBER' } }, required: ['sessionId'] } },
  { name: 'stop_background_command', description: 'Stop a previously started background command.', parameters: { type: 'OBJECT', properties: { sessionId: { type: 'STRING' }, signal: { type: 'STRING' } }, required: ['sessionId'] } },
  { name: 'install_package', description: 'Install packages via npm/pip/yarn/pnpm.', parameters: { type: 'OBJECT', properties: { packages: { type: 'ARRAY', items: { type: 'STRING' } }, manager: { type: 'STRING' }, cwd: { type: 'STRING' } }, required: ['packages'] } },
  { name: 'execute_code', description: 'Execute code in python/javascript/bash/ruby/go and return real output.', parameters: { type: 'OBJECT', properties: { code: { type: 'STRING' }, language: { type: 'STRING' }, stdin: { type: 'STRING' } }, required: ['code', 'language'] } },
  { name: 'read_local_file', description: 'Read a file from the runner local filesystem.', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] } },
  { name: 'write_local_file', description: 'Write a file to the runner local filesystem.', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] } },
  { name: 'list_local_dir', description: 'List files in the runner local filesystem.', parameters: { type: 'OBJECT', properties: { dir: { type: 'STRING' } } } },
  { name: 'sync_runner_workspace', description: 'Import files changed on the runner back into the project database.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'browser_action', description: 'Control a real Chromium browser via Puppeteer. Supports navigate, click, smart_click, type, fill, smart_fill_form, dom_mutate, wait_for, wait_for_text, get_text, get_html, screenshot, current_url, evaluate, dom_map, frame_tree, page_snapshot, logs, challenge_status, and element_info. Supports retries/retryDelayMs for flaky actions and headless=false for visible manual-browser sessions.', parameters: { type: 'OBJECT', properties: { action: { type: 'STRING' }, sessionId: { type: 'STRING' }, url: { type: 'STRING' }, selector: { type: 'STRING' }, text: { type: 'STRING' }, label: { type: 'STRING' }, name: { type: 'STRING' }, id: { type: 'STRING' }, placeholder: { type: 'STRING' }, targetText: { type: 'STRING' }, value: { type: 'STRING' }, script: { type: 'STRING' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, waitFor: { type: 'STRING' }, waitUntil: { type: 'STRING' }, frameName: { type: 'STRING' }, frameUrl: { type: 'STRING' }, frameIndex: { type: 'NUMBER' }, limit: { type: 'NUMBER' }, includeFrames: { type: 'BOOLEAN' }, attribute: { type: 'STRING' }, fullPage: { type: 'BOOLEAN' }, timeout: { type: 'NUMBER' }, retries: { type: 'NUMBER' }, retryDelayMs: { type: 'NUMBER' }, headless: { type: 'BOOLEAN' }, fields: { type: 'ARRAY', items: { type: 'OBJECT' } }, submit: { type: 'STRING' }, operations: { type: 'ARRAY', items: { type: 'OBJECT' } } }, required: ['action'] } },
];

const ANTHROPIC_TOOLS = [
  { name: 'write_file', description: 'Create or overwrite a file with complete content', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'patch_file', description: 'Apply multiple targeted text edits to one file. Supports replace, replace_all, insert_before, insert_after, prepend, and append operations.', input_schema: { type: 'object', properties: { path: { type: 'string' }, operations: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, old_str: { type: 'string' }, anchor: { type: 'string' }, new_str: { type: 'string' }, content: { type: 'string' }, occurrence: { type: 'number' } } } } }, required: ['path', 'operations'] } },
  { name: 'edit_file', description: 'Make a targeted edit by replacing exact text.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] } },
  { name: 'batch_write_files', description: 'Write multiple files at once', input_schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }, required: ['files'] } },
  { name: 'read_file', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'delete_file', description: 'Delete a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'rename_file', description: 'Rename or move a file', input_schema: { type: 'object', properties: { old_path: { type: 'string' }, new_path: { type: 'string' } }, required: ['old_path', 'new_path'] } },
  { name: 'list_files', description: 'List all project files', input_schema: { type: 'object', properties: {} } },
  { name: 'project_map', description: 'Summarize the project stack, likely entrypoints, important scripts, tests, and files relevant to a request.', input_schema: { type: 'object', properties: { query: { type: 'string' }, include_content: { type: 'boolean' } } } },
  { name: 'project_memory', description: 'Load persistent repo memory, active tasks, important commands, and high-level architecture context.', input_schema: { type: 'object', properties: {} } },
  { name: 'search_files', description: 'Search file names', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'grep', description: 'Search file contents for a pattern', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { name: 'browse_website', description: 'Fetch and read any website, docs, GitHub, or API endpoint.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'web_search', description: 'Search the web for current info, docs, packages, APIs, research.', input_schema: { type: 'object', properties: { query: { type: 'string' }, num_results: { type: 'number' } }, required: ['query'] } },
  { name: 'github_context', description: 'Load GitHub pull request, issue, commit, or CI check context for the connected repository.', input_schema: { type: 'object', properties: { kind: { type: 'string' }, state: { type: 'string' }, number: { type: 'number' }, limit: { type: 'number' }, ref: { type: 'string' } } } },
  { name: 'security_scope', description: 'Load the project security scope, auth profiles, blocked hosts, and continuous scan settings.', input_schema: { type: 'object', properties: {} } },
  { name: 'surface_map', description: 'Build an attack-surface summary including routes, forms, auth files, CI/IaC files, external hosts, and API specs.', input_schema: { type: 'object', properties: {} } },
  { name: 'api_spec_summary', description: 'Summarize any OpenAPI or Swagger specs found in project files or docs.', input_schema: { type: 'object', properties: {} } },
  { name: 'run_security_scan', description: 'Run built-in repo security heuristics plus custom checks. Persist findings by default.', input_schema: { type: 'object', properties: { persist: { type: 'boolean' } } } },
  { name: 'list_findings', description: 'List saved structured security findings for this project.', input_schema: { type: 'object', properties: { status: { type: 'string' }, severity: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'save_finding', description: 'Save or update a structured security finding with severity, impact, evidence, repro, and remediation.', input_schema: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string' }, status: { type: 'string' }, summary: { type: 'string' }, impact: { type: 'string' }, recommendation: { type: 'string' }, affected_paths: { type: 'array', items: { type: 'string' } }, affected_urls: { type: 'array', items: { type: 'string' } }, standards: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'object' } }, reproduction_steps: { type: 'array', items: { type: 'string' } }, regression_check: { type: 'string' }, fix_validation: { type: 'string' }, triage_owner: { type: 'string' }, dedupe_key: { type: 'string' }, source: { type: 'string' } }, required: ['title'] } },
  { name: 'generate_security_report', description: 'Generate a security evidence pack and report from saved findings.', input_schema: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, status: { type: 'string' }, finding_ids: { type: 'array', items: { type: 'number' } } } } },
  { name: 'create_oast_session', description: 'Create a unique callback URL for blind SSRF, webhook, or out-of-band testing.', input_schema: { type: 'object', properties: { label: { type: 'string' }, base_url: { type: 'string' } } } },
  { name: 'traffic_capture_summary', description: 'Load an imported HAR capture with reverse-engineering notes, replayable entries, and exact request templates.', input_schema: { type: 'object', properties: { capture_id: { type: 'number' } }, required: ['capture_id'] } },
  { name: 'replay_traffic_request', description: 'Replay a captured HAR request as faithfully as possible and compare the live response to the original capture.', input_schema: { type: 'object', properties: { capture_id: { type: 'number' }, entry_id: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['capture_id'] } },
  { name: 'replay_traffic_flow', description: 'Replay a multi-step HAR flow with cookie carryover and return a reusable Node replay script.', input_schema: { type: 'object', properties: { capture_id: { type: 'number' }, chain_index: { type: 'number' }, entry_ids: { type: 'array', items: { type: 'string' } }, start_order: { type: 'number' }, end_order: { type: 'number' }, carry_cookies: { type: 'boolean' }, stop_on_failure: { type: 'boolean' }, timeoutMs: { type: 'number' } }, required: ['capture_id'] } },
  { name: 'reverse_engineer_project', description: 'Analyze source and bundled client code for hidden endpoints, auth clues, source maps, GraphQL operations, and websocket targets.', input_schema: { type: 'object', properties: {} } },
  { name: 'traffic_flow_graph', description: 'Reconstruct request chains, cookie handoffs, referer edges, and same-host flow segments from a HAR capture.', input_schema: { type: 'object', properties: { capture_id: { type: 'number' } }, required: ['capture_id'] } },
  { name: 'mutate_traffic_request', description: 'Apply controlled header/query/body mutations to a HAR-derived request and replay it.', input_schema: { type: 'object', properties: { capture_id: { type: 'number' }, entry_id: { type: 'string' }, mutations: { type: 'object' }, timeoutMs: { type: 'number' } }, required: ['capture_id'] } },
  { name: 'run_command', description: 'Execute a real shell command on the connected runner.', input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
  { name: 'start_background_command', description: 'Start a long-running command on the runner and keep it alive for later checks or browser tests.', input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, sessionId: { type: 'string' }, name: { type: 'string' }, port: { type: 'number' }, host: { type: 'string' }, protocol: { type: 'string' }, path: { type: 'string' }, url: { type: 'string' }, startupTimeoutMs: { type: 'number' }, pollIntervalMs: { type: 'number' } }, required: ['command'] } },
  { name: 'check_background_command', description: 'Check a previously started background command, tail logs, and optionally test readiness on a local URL.', input_schema: { type: 'object', properties: { sessionId: { type: 'string' }, port: { type: 'number' }, host: { type: 'string' }, protocol: { type: 'string' }, path: { type: 'string' }, url: { type: 'string' }, timeout: { type: 'number' } }, required: ['sessionId'] } },
  { name: 'stop_background_command', description: 'Stop a previously started background command.', input_schema: { type: 'object', properties: { sessionId: { type: 'string' }, signal: { type: 'string' } }, required: ['sessionId'] } },
  { name: 'install_package', description: 'Install packages via npm/pip/yarn/pnpm.', input_schema: { type: 'object', properties: { packages: { type: 'array', items: { type: 'string' } }, manager: { type: 'string' }, cwd: { type: 'string' } }, required: ['packages'] } },
  { name: 'execute_code', description: 'Execute code in python/javascript/bash/ruby/go.', input_schema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' }, stdin: { type: 'string' } }, required: ['code', 'language'] } },
  { name: 'read_local_file', description: 'Read a file from the runner local filesystem.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_local_file', description: 'Write a file to the runner local filesystem.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_local_dir', description: 'List files in the runner local filesystem.', input_schema: { type: 'object', properties: { dir: { type: 'string' } } } },
  { name: 'sync_runner_workspace', description: 'Import files changed on the runner back into the project database.', input_schema: { type: 'object', properties: {} } },
  { name: 'browser_action', description: 'Control a real Chromium browser via Puppeteer. Supports navigate, click, smart_click, type, fill, smart_fill_form, dom_mutate, wait_for, wait_for_text, get_text, get_html, screenshot, current_url, evaluate, dom_map, frame_tree, page_snapshot, logs, challenge_status, and element_info. Supports retries/retryDelayMs for flaky actions and headless=false for visible manual-browser sessions.', input_schema: { type: 'object', properties: { action: { type: 'string' }, sessionId: { type: 'string' }, url: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' }, label: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' }, placeholder: { type: 'string' }, targetText: { type: 'string' }, value: { type: 'string' }, script: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, waitFor: { type: 'string' }, waitUntil: { type: 'string' }, frameName: { type: 'string' }, frameUrl: { type: 'string' }, frameIndex: { type: 'number' }, limit: { type: 'number' }, includeFrames: { type: 'boolean' }, attribute: { type: 'string' }, fullPage: { type: 'boolean' }, timeout: { type: 'number' }, retries: { type: 'number' }, retryDelayMs: { type: 'number' }, headless: { type: 'boolean' }, fields: { type: 'array', items: { type: 'object' } }, submit: { type: 'string' }, operations: { type: 'array', items: { type: 'object' } } }, required: ['action'] } },
];

const OPENAI_TOOLS = [
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'patch_file', description: 'Apply multiple targeted text edits to one file. Supports replace, replace_all, insert_before, insert_after, prepend, and append operations.', parameters: { type: 'object', properties: { path: { type: 'string' }, operations: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, old_str: { type: 'string' }, anchor: { type: 'string' }, new_str: { type: 'string' }, content: { type: 'string' }, occurrence: { type: 'number' } } } } }, required: ['path', 'operations'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Make a targeted edit by replacing exact text', parameters: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] } } },
  { type: 'function', function: { name: 'batch_write_files', description: 'Write multiple files at once', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }, required: ['files'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'delete_file', description: 'Delete a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'rename_file', description: 'Rename or move a file', parameters: { type: 'object', properties: { old_path: { type: 'string' }, new_path: { type: 'string' } }, required: ['old_path', 'new_path'] } } },
  { type: 'function', function: { name: 'list_files', description: 'List all files', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'project_map', description: 'Summarize the project stack, likely entrypoints, important scripts, tests, and files relevant to a request.', parameters: { type: 'object', properties: { query: { type: 'string' }, include_content: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'project_memory', description: 'Load persistent repo memory, active tasks, important commands, and high-level architecture context.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'search_files', description: 'Search file names', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'grep', description: 'Search file contents', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'browse_website', description: 'Fetch and read any website, docs, GitHub, or API endpoint.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the web for current info, docs, packages, APIs, research.', parameters: { type: 'object', properties: { query: { type: 'string' }, num_results: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'github_context', description: 'Load GitHub pull request, issue, commit, or CI check context for the connected repository.', parameters: { type: 'object', properties: { kind: { type: 'string' }, state: { type: 'string' }, number: { type: 'number' }, limit: { type: 'number' }, ref: { type: 'string' } } } } },
  { type: 'function', function: { name: 'security_scope', description: 'Load the project security scope, auth profiles, blocked hosts, and continuous scan settings.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'surface_map', description: 'Build an attack-surface summary including routes, forms, auth files, CI/IaC files, external hosts, and API specs.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'api_spec_summary', description: 'Summarize any OpenAPI or Swagger specs found in project files or docs.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_security_scan', description: 'Run built-in repo security heuristics plus custom checks. Persist findings by default.', parameters: { type: 'object', properties: { persist: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'list_findings', description: 'List saved structured security findings for this project.', parameters: { type: 'object', properties: { status: { type: 'string' }, severity: { type: 'string' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'save_finding', description: 'Save or update a structured security finding with severity, impact, evidence, repro, and remediation.', parameters: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string' }, status: { type: 'string' }, summary: { type: 'string' }, impact: { type: 'string' }, recommendation: { type: 'string' }, affected_paths: { type: 'array', items: { type: 'string' } }, affected_urls: { type: 'array', items: { type: 'string' } }, standards: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'object' } }, reproduction_steps: { type: 'array', items: { type: 'string' } }, regression_check: { type: 'string' }, fix_validation: { type: 'string' }, triage_owner: { type: 'string' }, dedupe_key: { type: 'string' }, source: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'generate_security_report', description: 'Generate a security evidence pack and report from saved findings.', parameters: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, status: { type: 'string' }, finding_ids: { type: 'array', items: { type: 'number' } } } } } },
  { type: 'function', function: { name: 'create_oast_session', description: 'Create a unique callback URL for blind SSRF, webhook, or out-of-band testing.', parameters: { type: 'object', properties: { label: { type: 'string' }, base_url: { type: 'string' } } } } },
  { type: 'function', function: { name: 'traffic_capture_summary', description: 'Load an imported HAR capture with reverse-engineering notes, replayable entries, and exact request templates.', parameters: { type: 'object', properties: { capture_id: { type: 'number' } }, required: ['capture_id'] } } },
  { type: 'function', function: { name: 'replay_traffic_request', description: 'Replay a captured HAR request as faithfully as possible and compare the live response to the original capture.', parameters: { type: 'object', properties: { capture_id: { type: 'number' }, entry_id: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['capture_id'] } } },
  { type: 'function', function: { name: 'replay_traffic_flow', description: 'Replay a multi-step HAR flow with cookie carryover and return a reusable Node replay script.', parameters: { type: 'object', properties: { capture_id: { type: 'number' }, chain_index: { type: 'number' }, entry_ids: { type: 'array', items: { type: 'string' } }, start_order: { type: 'number' }, end_order: { type: 'number' }, carry_cookies: { type: 'boolean' }, stop_on_failure: { type: 'boolean' }, timeoutMs: { type: 'number' } }, required: ['capture_id'] } } },
  { type: 'function', function: { name: 'reverse_engineer_project', description: 'Analyze source and bundled client code for hidden endpoints, auth clues, source maps, GraphQL operations, and websocket targets.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'traffic_flow_graph', description: 'Reconstruct request chains, cookie handoffs, referer edges, and same-host flow segments from a HAR capture.', parameters: { type: 'object', properties: { capture_id: { type: 'number' } }, required: ['capture_id'] } } },
  { type: 'function', function: { name: 'mutate_traffic_request', description: 'Apply controlled header/query/body mutations to a HAR-derived request and replay it.', parameters: { type: 'object', properties: { capture_id: { type: 'number' }, entry_id: { type: 'string' }, mutations: { type: 'object' }, timeoutMs: { type: 'number' } }, required: ['capture_id'] } } },
  { type: 'function', function: { name: 'run_command', description: 'Execute a real shell command on the connected runner.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'start_background_command', description: 'Start a long-running command on the runner and keep it alive for later checks or browser tests.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, sessionId: { type: 'string' }, name: { type: 'string' }, port: { type: 'number' }, host: { type: 'string' }, protocol: { type: 'string' }, path: { type: 'string' }, url: { type: 'string' }, startupTimeoutMs: { type: 'number' }, pollIntervalMs: { type: 'number' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'check_background_command', description: 'Check a previously started background command, tail logs, and optionally test readiness on a local URL.', parameters: { type: 'object', properties: { sessionId: { type: 'string' }, port: { type: 'number' }, host: { type: 'string' }, protocol: { type: 'string' }, path: { type: 'string' }, url: { type: 'string' }, timeout: { type: 'number' } }, required: ['sessionId'] } } },
  { type: 'function', function: { name: 'stop_background_command', description: 'Stop a previously started background command.', parameters: { type: 'object', properties: { sessionId: { type: 'string' }, signal: { type: 'string' } }, required: ['sessionId'] } } },
  { type: 'function', function: { name: 'install_package', description: 'Install packages via npm/pip/yarn/pnpm.', parameters: { type: 'object', properties: { packages: { type: 'array', items: { type: 'string' } }, manager: { type: 'string' }, cwd: { type: 'string' } }, required: ['packages'] } } },
  { type: 'function', function: { name: 'execute_code', description: 'Execute code in python/javascript/bash/ruby/go.', parameters: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' }, stdin: { type: 'string' } }, required: ['code', 'language'] } } },
  { type: 'function', function: { name: 'read_local_file', description: 'Read a file from the runner local filesystem.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_local_file', description: 'Write a file to the runner local filesystem.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'list_local_dir', description: 'List files in the runner local filesystem.', parameters: { type: 'object', properties: { dir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'sync_runner_workspace', description: 'Import files changed on the runner back into the project database.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'browser_action', description: 'Control a real Chromium browser via Puppeteer. Supports navigate, click, smart_click, type, fill, smart_fill_form, dom_mutate, wait_for, wait_for_text, get_text, get_html, screenshot, current_url, evaluate, dom_map, frame_tree, page_snapshot, logs, challenge_status, and element_info. Supports retries/retryDelayMs for flaky actions and headless=false for visible manual-browser sessions.', parameters: { type: 'object', properties: { action: { type: 'string' }, sessionId: { type: 'string' }, url: { type: 'string' }, selector: { type: 'string' }, text: { type: 'string' }, label: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' }, placeholder: { type: 'string' }, targetText: { type: 'string' }, value: { type: 'string' }, script: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, waitFor: { type: 'string' }, waitUntil: { type: 'string' }, frameName: { type: 'string' }, frameUrl: { type: 'string' }, frameIndex: { type: 'number' }, limit: { type: 'number' }, includeFrames: { type: 'boolean' }, attribute: { type: 'string' }, fullPage: { type: 'boolean' }, timeout: { type: 'number' }, retries: { type: 'number' }, retryDelayMs: { type: 'number' }, headless: { type: 'boolean' }, fields: { type: 'array', items: { type: 'object' } }, submit: { type: 'string' }, operations: { type: 'array', items: { type: 'object' } } }, required: ['action'] } } },
];

async function runGemini(res, message, history, system, model, key, mode, projectId, files, forceToolCalls = false, agentRuntime = null) {
  const tools = mode === 'agent' ? [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }] : undefined;
  const toolConfig = buildGeminiToolConfig(forceToolCalls);
  const loopState = createAgentLoopState(agentRuntime, files);
  const historyWindow = getAgentHistoryWindow(agentRuntime);
  const loopLimit = getAgentLoopLimit(agentRuntime);
  const contents = [
    ...history.slice(-historyWindow).map((entry) => ({ role: entry.role === 'user' ? 'user' : 'model', parts: [{ text: entry.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  let hadOutput = false;
  for (let i = 0; i < loopLimit; i += 1) {
    const body = { contents, systemInstruction: { parts: [{ text: system }] }, generationConfig: buildGenerationConfig(agentRuntime) };
    if (tools) body.tools = tools;
    if (toolConfig && i === 0) body.toolConfig = toolConfig;
    const data = await providerFetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'Gemini', res);
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const textParts = parts.filter((part) => part.text);
    const toolCalls = parts.filter((part) => part.functionCall);
    const messageText = textParts.map((part) => part.text).join('');
    if (textParts.length > 0 || toolCalls.length > 0) hadOutput = true;
    if (textParts.length === 0 && toolCalls.length === 0) {
      throw new Error(describeGeminiNoContent('Gemini returned no text or tool calls for this request.', data.candidates, data.promptFeedback));
    }
    if (toolCalls.length === 0) {
      const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
      if (correctivePrompt) {
        contents.push({ role: 'model', parts });
        contents.push({ role: 'user', parts: [{ text: correctivePrompt }] });
        continue;
      }
      if (messageText) {
        send(res, { type: 'message', content: messageText });
      }
      break;
    }
    if (messageText) {
      send(res, { type: 'message', content: messageText });
    }
    const toolResults = [];
    for (const part of toolCalls) {
      const { name, args } = part.functionCall;
      const id = crypto.randomUUID();
      send(res, { type: 'thinking', content: describeToolIntent(name, args) });
      send(res, { type: 'tool_call', id, tool: name, args });
      const result = await executeTool(name, args, projectId, files, res, agentRuntime).catch(String);
      send(res, { type: 'tool_result', id, tool: name, result });
      updateAgentLoopState(loopState, name, args, result);
      toolResults.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'model', parts });
    contents.push({ role: 'user', parts: toolResults });
    const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
    if (correctivePrompt) {
      contents.push({ role: 'user', parts: [{ text: correctivePrompt }] });
    }
  }
  return { hadOutput };
}

async function runVertex(res, message, history, system, model, key, mode, projectId, files, forceToolCalls = false, agentRuntime = null) {
  const tools = mode === 'agent' ? [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }] : undefined;
  const toolConfig = buildGeminiToolConfig(forceToolCalls);
  const loopState = createAgentLoopState(agentRuntime, files);
  const historyWindow = getAgentHistoryWindow(agentRuntime);
  const loopLimit = getAgentLoopLimit(agentRuntime);
  const contents = [
    ...history.slice(-historyWindow).map((entry) => ({ role: entry.role === 'user' ? 'user' : 'model', parts: [{ text: entry.content }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  let hadOutput = false;
  for (let i = 0; i < loopLimit; i += 1) {
    const body = { contents, systemInstruction: { parts: [{ text: system }] }, generationConfig: buildGenerationConfig(agentRuntime) };
    if (tools) body.tools = tools;
    if (toolConfig && i === 0) body.toolConfig = toolConfig;
    const raw = await providerFetchText(`https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:streamGenerateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'Vertex AI', res);
    let chunks = [];
    try {
      const parsed = JSON.parse(raw);
      chunks = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      throw new Error('Vertex AI: failed to parse response');
    }
    let combinedText = '';
    const toolCalls = [];
    let allParts = [];
    for (const chunk of chunks) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      allParts = [...allParts, ...parts];
      for (const part of parts) {
        if (part.text) combinedText += part.text;
        if (part.functionCall) toolCalls.push({ functionCall: part.functionCall });
      }
    }
    if (combinedText || toolCalls.length > 0) hadOutput = true;
    if (!combinedText && toolCalls.length === 0) {
      throw new Error(describeGeminiNoContent('Vertex returned no text or tool calls for this request.', chunks.flatMap((chunk) => chunk.candidates ?? []), chunks.find((chunk) => chunk.promptFeedback)?.promptFeedback));
    }
    if (toolCalls.length === 0) {
      const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
      if (correctivePrompt) {
        contents.push({ role: 'model', parts: allParts });
        contents.push({ role: 'user', parts: [{ text: correctivePrompt }] });
        continue;
      }
      if (combinedText) {
        send(res, { type: 'message', content: combinedText });
      }
      break;
    }
    if (combinedText) {
      send(res, { type: 'message', content: combinedText });
    }
    const toolResults = [];
    for (const part of toolCalls) {
      const { name, args } = part.functionCall;
      const id = crypto.randomUUID();
      send(res, { type: 'thinking', content: describeToolIntent(name, args) });
      send(res, { type: 'tool_call', id, tool: name, args });
      const result = await executeTool(name, args, projectId, files, res, agentRuntime).catch(String);
      send(res, { type: 'tool_result', id, tool: name, result });
      updateAgentLoopState(loopState, name, args, result);
      toolResults.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'model', parts: allParts });
    contents.push({ role: 'user', parts: toolResults });
    const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
    if (correctivePrompt) {
      contents.push({ role: 'user', parts: [{ text: correctivePrompt }] });
    }
  }
  return { hadOutput };
}

async function runAnthropic(res, message, history, system, model, key, mode, projectId, files, forceToolCalls = false, agentRuntime = null) {
  const tools = mode === 'agent' ? ANTHROPIC_TOOLS : undefined;
  const loopState = createAgentLoopState(agentRuntime, files);
  const historyWindow = getAgentHistoryWindow(agentRuntime);
  const loopLimit = getAgentLoopLimit(agentRuntime);
  const messages = [
    ...history.slice(-historyWindow).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: message },
  ];
  let hadOutput = false;
  for (let i = 0; i < loopLimit; i += 1) {
    const body = { model, max_tokens: getAgentMaxOutputTokens(agentRuntime), system, messages };
    if (tools) body.tools = tools;
    if (tools && forceToolCalls && i === 0) body.tool_choice = { type: 'any' };
    const data = await providerFetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, 'Anthropic', res);
    const content = data.content ?? [];
    const textBlocks = content.filter((block) => block.type === 'text');
    const toolBlocks = content.filter((block) => block.type === 'tool_use');
    const messageText = textBlocks.map((block) => block.text).join('');
    if (textBlocks.length > 0 || toolBlocks.length > 0) hadOutput = true;
    if (textBlocks.length === 0 && toolBlocks.length === 0) {
      throw new Error('Anthropic returned no text or tool calls for this request.');
    }
    if (toolBlocks.length === 0) {
      const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
      if (correctivePrompt) {
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: correctivePrompt });
        continue;
      }
      if (messageText) {
        send(res, { type: 'message', content: messageText });
      }
      break;
    }
    if (messageText) {
      send(res, { type: 'message', content: messageText });
    }
    messages.push({ role: 'assistant', content });
    const toolResults = [];
    for (const block of toolBlocks) {
      send(res, { type: 'thinking', content: describeToolIntent(block.name, block.input) });
      send(res, { type: 'tool_call', id: block.id, tool: block.name, args: block.input });
      const result = await executeTool(block.name, block.input, projectId, files, res, agentRuntime).catch(String);
      send(res, { type: 'tool_result', id: block.id, tool: block.name, result });
      updateAgentLoopState(loopState, block.name, block.input, result);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }
    messages.push({ role: 'user', content: toolResults });
    const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
    if (correctivePrompt) {
      messages.push({ role: 'user', content: correctivePrompt });
    }
    if (data.stop_reason === 'end_turn') break;
  }
  return { hadOutput };
}

async function runOpenAICompatible(res, message, history, system, model, key, mode, projectId, files, forceToolCalls = false, agentRuntime = null) {
  const tools = mode === 'agent' ? OPENAI_TOOLS : undefined;
  const loopState = createAgentLoopState(agentRuntime, files);
  const providerConfig = getOpenAICompatibleConfig(agentRuntime);
  const historyWindow = getAgentHistoryWindow(agentRuntime);
  const loopLimit = getAgentLoopLimit(agentRuntime);
  const messages = [
    { role: 'system', content: system },
    ...history.slice(-historyWindow).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: message },
  ];
  let hadOutput = false;
  for (let i = 0; i < loopLimit; i += 1) {
    const body = { model, messages, max_tokens: getAgentMaxOutputTokens(agentRuntime) };
    if (tools) {
      body.tools = tools;
      body.tool_choice = forceToolCalls && i === 0 ? 'required' : 'auto';
    }
    const data = await providerFetchJson(providerConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    }, providerConfig.label, res);
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${providerConfig.label} returned no choices for this request.`);
    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls ?? [];
    const messageText = assistantMessage.content ?? '';
    if (messageText || toolCalls.length > 0) hadOutput = true;
    if (!assistantMessage.content && toolCalls.length === 0) {
      throw new Error(`${providerConfig.label} returned no text or tool calls for this request.`);
    }
    if (toolCalls.length === 0) {
      const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
      if (correctivePrompt) {
        messages.push({ role: 'assistant', content: assistantMessage.content ?? '' });
        messages.push({ role: 'user', content: correctivePrompt });
        continue;
      }
      if (messageText) {
        send(res, { type: 'message', content: messageText });
      }
      break;
    }
    if (messageText) {
      send(res, { type: 'message', content: messageText });
    }
    messages.push({ ...assistantMessage, tool_calls: toolCalls });
    for (const toolCall of toolCalls) {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        parsedArgs = {};
      }
      send(res, { type: 'thinking', content: describeToolIntent(toolCall.function.name, parsedArgs) });
      send(res, { type: 'tool_call', id: toolCall.id, tool: toolCall.function.name, args: parsedArgs });
      const result = await executeTool(toolCall.function.name, parsedArgs, projectId, files, res, agentRuntime).catch(String);
      send(res, { type: 'tool_result', id: toolCall.id, tool: toolCall.function.name, result });
      updateAgentLoopState(loopState, toolCall.function.name, parsedArgs, result);
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result, name: toolCall.function.name });
    }
    const correctivePrompt = buildAgentRecoveryPrompt(loopState, agentRuntime);
    if (correctivePrompt) {
      messages.push({ role: 'user', content: correctivePrompt });
    }
    if (choice.finish_reason === 'stop') break;
  }
  return { hadOutput };
}

export async function handleAIStream(req, res) {
  const projectId = Number(req.body.projectId);
  const project = await Project.findOne({ id: projectId, user_id: req.user._id });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const taskId = Number(req.body.taskId);
  const task = Number.isFinite(taskId) ? await getOwnedTask(projectId, taskId, req.user._id) : null;
  if (Number.isFinite(taskId) && !task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (task) {
    await seedTaskFilesFromProject(task.id, projectId);
  }

  const files = task
    ? await listTaskFiles(task.id)
    : Array.isArray(req.body.files)
      ? req.body.files.map((file) => ({ ...file }))
      : (await ProjectFile.find({ project_id: projectId }).sort({ path: 1 })).map(serializeFile);
  const memoryFiles = task
    ? (await ProjectFile.find({ project_id: projectId }).sort({ path: 1 })).map(serializeFile)
    : files;
  const inputDocs = Array.isArray(req.body.docs) ? req.body.docs : [];
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  const message = String(req.body.message ?? '').trim();
  const mode = req.body.mode === 'chat' ? 'chat' : 'agent';
  const agentProfile = normalizeAgentProfile(req.body.profile);
  const fastMode = !!req.body.fastMode;
  const autonomy = normalizeAgentAutonomy(req.body.autonomy);
  const appTesting = !!req.body.appTesting;
  const websiteMode = !!req.body.websiteMode;
  const manualBrowser = !!req.body.manualBrowser;
  const browserSessionId = String(req.body.browserSessionId ?? '').trim();
  const filePolicy = normalizeFilePolicy(req.body.filePolicy);
  const userKeys = req.body.userKeys ?? null;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const usingOwnKey = !!(
    (userKeys?.provider === 'gemini' && userKeys?.gemini_key) ||
    (userKeys?.provider === 'anthropic' && userKeys?.anthropic_key) ||
    (userKeys?.provider === 'openai' && userKeys?.openai_key) ||
    (userKeys?.provider === 'vertex' && userKeys?.vertex_key) ||
    (userKeys?.provider === 'kimi' && userKeys?.kimi_key)
  );

  const settings = await getPlatformSettings();
  const memoryDoc = await ensureProjectMemoryDoc(project, memoryFiles, inputDocs);
  const docs = [
    ...inputDocs.filter((doc) => doc.title !== '.luxi.memory.md'),
    { title: '.luxi.memory.md', content: memoryDoc.content ?? '' },
  ];
  const projectMemory = await buildProjectMemorySummary(project, memoryFiles, docs);
  const needsSecurityContext = messageSuggestsSecurityRecon(message, agentProfile);
  const [securityProfile, recentFindings] = needsSecurityContext
    ? await Promise.all([
      ensureProjectSecurityProfile(project.id, req.user._id),
      SecurityFinding.find({ project_id: project.id, user_id: req.user._id }).sort({ updated_at: -1 }).limit(8),
    ])
    : [null, []];
  const securityProfileSummary = JSON.stringify({
    scope: securityProfile?.scope ?? {},
    auth_profiles: Array.isArray(securityProfile?.auth_profiles) ? securityProfile.auth_profiles.map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      start_url: entry.start_url,
      login_path: entry.login_path,
      role: entry.role,
      enabled: entry.enabled !== false,
    })) : [],
    continuous_scans: Array.isArray(securityProfile?.continuous_scans) ? securityProfile.continuous_scans.map((entry) => ({
      id: entry.id,
      name: entry.name,
      cadence: entry.cadence,
      target: entry.target,
      enabled: entry.enabled !== false,
      last_run_at: entry.last_run_at,
    })) : [],
  }, null, 2);
  const securityFindingsSummary = recentFindings.length > 0
    ? JSON.stringify(recentFindings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      category: finding.category,
      summary: finding.summary,
      affected_paths: finding.affected_paths ?? [],
      standards: finding.standards ?? [],
    })), null, 2)
    : '';
  const provider = userKeys?.provider || settings.provider || 'gemini';
  const model = userKeys?.model || settings.model || 'gemini-2.5-flash';
  const resolvedKeys = {
    gemini: userKeys?.gemini_key || settings.gemini_key || '',
    anthropic: userKeys?.anthropic_key || settings.anthropic_key || '',
    openai: userKeys?.openai_key || settings.openai_key || '',
    vertex: userKeys?.vertex_key || settings.vertex_key || '',
    kimi: userKeys?.kimi_key || settings.kimi_key || '',
  };
  const providerKey = provider === 'gemini'
    ? resolvedKeys.gemini
    : provider === 'anthropic'
    ? resolvedKeys.anthropic
    : provider === 'openai'
    ? resolvedKeys.openai
    : provider === 'vertex'
    ? resolvedKeys.vertex
    : provider === 'kimi'
    ? resolvedKeys.kimi
    : '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    if (!providerKey) {
      send(res, { type: 'error', content: 'No AI provider configured. Add your own API key or configure a platform key in Admin.' });
      send(res, { type: 'done' });
      res.end();
      return;
    }

    if (!usingOwnKey) {
      const creditCheck = await checkCreditAvailability(req.user._id);
      if (!creditCheck.allowed) {
        send(res, { type: 'error', content: creditCheck.reason ?? 'No credits remaining.' });
        send(res, { type: 'done' });
        res.end();
        return;
      }
    }

    const runtimeContext = await getRuntimeContext(message, {
      websiteMode,
      manualBrowser,
      browserSessionId,
    });
    runtimeContext.fastMode = fastMode;
    runtimeContext.autonomy = autonomy;
    runtimeContext.publicBaseUrl = process.env.PUBLIC_APP_URL
      || process.env.APP_BASE_URL
      || String(req.headers.origin ?? `${String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0].trim()}://${String(req.headers['x-forwarded-host'] ?? req.get('host') ?? '').split(',')[0].trim()}`);
    const agentRuntime = {
      provider,
      model,
      resolvedKeys,
      requestMessage: message,
      agentProfile,
      fastMode,
      autonomy,
      runtimeContext,
      project,
      userId: req.user._id,
      projectDocs: docs,
      projectMemory,
      securityProfile,
      recentFindings,
      task,
      websiteMode,
      manualBrowser,
      browserSessionId,
      appTesting,
      filePolicy,
      executionProjectId: task?.workspace_key ?? projectId,
    };
    runtimeContext.visualBrowserAnalysis = canUseVisualBrowserAnalysis(agentRuntime);
    const systemPrompt = buildSystemPrompt(mode, appTesting, runtimeContext, agentProfile);
    const enhancedMessage = buildEnhancedPrompt(message, files, docs, mode, appTesting, runtimeContext, filePolicy, {
      projectMemory,
      securityProfile: agentProfile === 'security' ? securityProfileSummary : '',
      securityFindings: agentProfile === 'security' ? securityFindingsSummary : '',
      task,
      fastMode,
      autonomy,
    });
    const forceToolCalls = shouldForceToolCalls(mode, message, agentProfile, { websiteMode, appTesting, autonomy });

    if (mode === 'agent') {
      if (!runtimeContext.runnerReachable && messageSuggestsVisualBuild(message, agentProfile)) {
        send(res, {
          type: 'thinking',
          content: 'Runner is offline, so I can still build the UI but I cannot start the dev server, preview the page, or run browser verification. I will switch to degraded build mode and avoid pretending the result was visually verified.',
        });
      }
      send(res, buildPlanEvent(message, files, docs, appTesting, agentProfile, runtimeContext, filePolicy, { task, fastMode, autonomy }));
      if (files.length > 0 && !task && !fastMode) {
        try {
          const checkpoint = await createProjectCheckpointSnapshot(projectId, req.user._id, buildCheckpointReason(message));
          send(res, {
            type: 'checkpoint_created',
            checkpointId: checkpoint.id,
            reason: checkpoint.reason ?? 'Project snapshot',
            created_at: checkpoint.created_at?.toISOString?.() ?? new Date(checkpoint.created_at).toISOString(),
          });
        } catch {}
      }
    }

    let providerResult = { hadOutput: false };
    if (provider === 'gemini' && resolvedKeys.gemini) {
      providerResult = await runGemini(res, enhancedMessage, history, systemPrompt, model, resolvedKeys.gemini, mode, projectId, files, forceToolCalls, agentRuntime);
    } else if (provider === 'anthropic' && resolvedKeys.anthropic) {
      providerResult = await runAnthropic(res, enhancedMessage, history, systemPrompt, model, resolvedKeys.anthropic, mode, projectId, files, forceToolCalls, agentRuntime);
    } else if (provider === 'openai' && resolvedKeys.openai) {
      providerResult = await runOpenAICompatible(res, enhancedMessage, history, systemPrompt, model, resolvedKeys.openai, mode, projectId, files, forceToolCalls, agentRuntime);
    } else if (provider === 'kimi' && resolvedKeys.kimi) {
      providerResult = await runOpenAICompatible(res, enhancedMessage, history, systemPrompt, model, resolvedKeys.kimi, mode, projectId, files, forceToolCalls, agentRuntime);
    } else if (provider === 'vertex' && resolvedKeys.vertex) {
      providerResult = await runVertex(res, enhancedMessage, history, systemPrompt, model, resolvedKeys.vertex, mode, projectId, files, forceToolCalls, agentRuntime);
    }

    if (!usingOwnKey && providerResult.hadOutput) {
      const charge = await deductCredit(req.user._id);
      if (!charge.ok) {
        send(res, { type: 'error', content: charge.reason ?? 'Could not charge platform credit for this request.' });
      }
    }
  } catch (error) {
    send(res, { type: 'error', content: String(error) });
  }

  send(res, { type: 'done' });
  res.end();
}
