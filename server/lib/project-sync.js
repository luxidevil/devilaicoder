import path from 'path';

import {
  ProjectFile,
  nextSequence,
  serializeFile,
} from './models.js';
import { runnerFetch } from './runner.js';

const RUNNER_IMPORT_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '.vite',
  '.vercel',
  '.netlify',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
]);

const RUNNER_IMPORT_SKIP_FILES = new Set([
  '.ds_store',
  'thumbs.db',
]);

const RUNNER_IMPORT_SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svgz',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.7z',
  '.rar',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.jar',
  '.pyc',
  '.pyo',
  '.o',
  '.a',
  '.bin',
  '.wasm',
  '.lockb',
]);

function detectLanguage(filePath) {
  const normalized = String(filePath ?? '').toLowerCase();
  const baseName = path.basename(normalized);
  if (baseName === 'dockerfile') return 'dockerfile';
  const ext = path.extname(normalized);
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.css': 'css',
    '.scss': 'css',
    '.sass': 'css',
    '.less': 'css',
    '.html': 'html',
    '.json': 'json',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.toml': 'toml',
    '.sh': 'shell',
    '.bash': 'shell',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.rb': 'ruby',
    '.php': 'php',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cs': 'csharp',
  };
  return map[ext] ?? 'plaintext';
}

function normalizeRunnerRelativePath(value) {
  const normalized = String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
  return normalized || '.';
}

function shouldSkipRunnerEntry(relativePath, type = 'file') {
  const normalized = normalizeRunnerRelativePath(relativePath);
  if (!normalized || normalized === '.') return false;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => RUNNER_IMPORT_SKIP_DIRS.has(part))) return true;

  const baseName = parts[parts.length - 1]?.toLowerCase() ?? '';
  if (RUNNER_IMPORT_SKIP_FILES.has(baseName)) return true;
  if (type !== 'dir') {
    const ext = path.extname(baseName);
    if (RUNNER_IMPORT_SKIP_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

function looksLikeTextContent(content) {
  return !String(content ?? '').includes('\u0000');
}

async function upsertImportedProjectFile(projectId, relativePath, content, localFiles = null) {
  const existing = await ProjectFile.findOne({ project_id: projectId, path: relativePath });
  if (existing) {
    let changed = false;
    const name = path.basename(relativePath);
    const language = detectLanguage(relativePath);

    if ((existing.content ?? '') !== content) {
      existing.content = content;
      changed = true;
    }
    if (existing.name !== name) {
      existing.name = name;
      changed = true;
    }
    if ((existing.language ?? 'plaintext') !== language) {
      existing.language = language;
      changed = true;
    }
    if (changed) {
      existing.updated_at = new Date();
      await existing.save();
    }

    if (Array.isArray(localFiles)) {
      const localExisting = localFiles.find((file) => file.id === existing.id || file.path === relativePath);
      if (localExisting) {
        localExisting.name = existing.name;
        localExisting.path = existing.path;
        localExisting.content = existing.content;
        localExisting.language = existing.language;
        localExisting.updated_at = existing.updated_at?.toISOString?.() ?? new Date().toISOString();
      }
    }

    return { action: changed ? 'updated' : 'unchanged', file: serializeFile(existing) };
  }

  const created = await ProjectFile.create({
    id: await nextSequence('project_files'),
    project_id: projectId,
    name: path.basename(relativePath),
    path: relativePath,
    content,
    language: detectLanguage(relativePath),
  });

  if (Array.isArray(localFiles)) {
    localFiles.push(serializeFile(created));
  }

  return { action: 'created', file: serializeFile(created) };
}

async function collectRunnerWorkspacePaths(projectId, dir = '.', state = null) {
  const summary = state ?? {
    paths: [],
    skipped: 0,
    truncated: false,
    limit: 600,
  };
  if (summary.truncated) return summary;

  const result = await runnerFetch('/ls', {
    projectId: String(projectId),
    dir,
  }, 30000);

  const entries = Array.isArray(result?.entries) ? result.entries : [];
  for (const entry of entries) {
    const relativePath = normalizeRunnerRelativePath(entry.path ?? path.posix.join(dir, entry.name ?? ''));
    if (relativePath === '.') continue;
    if (shouldSkipRunnerEntry(relativePath, entry.type)) {
      summary.skipped += 1;
      continue;
    }

    if (entry.type === 'dir') {
      await collectRunnerWorkspacePaths(projectId, relativePath, summary);
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

export async function syncProjectFilesToRunner(projectId, files) {
  if (!Array.isArray(files) || files.length === 0) return false;

  for (const file of files) {
    await runnerFetch('/write', {
      projectId: String(projectId),
      filePath: file.path,
      content: String(file.content ?? ''),
    }, 30000);
  }

  return true;
}

export async function syncRunnerWorkspaceToProject(projectId, options = {}) {
  const localFiles = Array.isArray(options.filesCache) ? options.filesCache : null;
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles ?? 600), 2000));
  const maxFileChars = Math.max(1_000, Math.min(Number(options.maxFileChars ?? 100_000), 500_000));
  const maxTotalChars = Math.max(10_000, Math.min(Number(options.maxTotalChars ?? 2_000_000), 10_000_000));

  const collected = await collectRunnerWorkspacePaths(projectId, '.', {
    paths: [],
    skipped: 0,
    truncated: false,
    limit: maxFiles,
  });

  const existingFiles = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
  const keepPaths = new Set();
  let totalChars = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let removed = 0;
  let skipped = collected.skipped;
  let truncated = collected.truncated;

  for (const relativePath of collected.paths) {
    try {
      const result = await runnerFetch('/read', {
        projectId: String(projectId),
        filePath: relativePath,
      }, 30000);

      const content = String(result?.content ?? '');
      if (!looksLikeTextContent(content)) {
        skipped += 1;
        continue;
      }
      if (content.length > maxFileChars) {
        skipped += 1;
        continue;
      }
      if (totalChars + content.length > maxTotalChars) {
        truncated = true;
        break;
      }

      totalChars += content.length;
      keepPaths.add(relativePath);
      const syncResult = await upsertImportedProjectFile(projectId, relativePath, content, localFiles);
      if (syncResult.action === 'created') created += 1;
      else if (syncResult.action === 'updated') updated += 1;
      else unchanged += 1;
    } catch {
      skipped += 1;
    }
  }

  if (!truncated) {
    for (const file of existingFiles) {
      if (keepPaths.has(file.path)) continue;
      await ProjectFile.deleteOne({ _id: file._id });
      removed += 1;
      if (Array.isArray(localFiles)) {
        const index = localFiles.findIndex((entry) => entry.id === file.id || entry.path === file.path);
        if (index >= 0) localFiles.splice(index, 1);
      }
    }
  }

  return {
    ok: true,
    imported: keepPaths.size,
    created,
    updated,
    unchanged,
    removed,
    skipped,
    truncated,
    totalChars,
    paths: Array.from(keepPaths),
  };
}
