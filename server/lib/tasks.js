import path from 'path';

import {
  Project,
  ProjectFile,
  ProjectTask,
  ProjectTaskFile,
  nextSequence,
  serializeFile,
  serializeProjectTask,
} from './models.js';

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

export function normalizeAcceptanceCriteria(value) {
  const items = Array.isArray(value)
    ? value
    : String(value ?? '')
      .split(/\n|,/)
      .map((entry) => entry.trim());

  return Array.from(new Set(items.map((entry) => String(entry).trim()).filter(Boolean))).slice(0, 20);
}

export function buildTaskWorkspaceKey(projectId, taskId) {
  return `${projectId}-task-${taskId}`;
}

export async function getOwnedTask(projectId, taskId, userId) {
  const task = await ProjectTask.findOne({ id: taskId, project_id: projectId, user_id: userId });
  if (!task) return null;
  const project = await Project.findOne({ id: projectId, user_id: userId });
  return project ? task : null;
}

export async function listTaskFiles(taskId) {
  const files = await ProjectTaskFile.find({ task_id: taskId }).sort({ path: 1 });
  return files.map(serializeFile);
}

export async function seedTaskFilesFromProject(taskId, projectId) {
  const existingCount = await ProjectTaskFile.countDocuments({ task_id: taskId });
  if (existingCount > 0) return existingCount;

  const projectFiles = await ProjectFile.find({ project_id: projectId }).sort({ path: 1 });
  for (const file of projectFiles) {
    await ProjectTaskFile.create({
      id: await nextSequence('project_task_files'),
      task_id: taskId,
      project_id: projectId,
      name: file.name,
      path: file.path,
      content: file.content ?? '',
      language: file.language ?? 'plaintext',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  return projectFiles.length;
}

export async function upsertTaskFile(taskId, projectId, filePath, content, filesCache = null) {
  const existing = await ProjectTaskFile.findOne({ task_id: taskId, path: filePath });
  if (existing) {
    existing.content = content;
    existing.name = path.basename(filePath);
    existing.language = detectLanguage(filePath);
    existing.updated_at = new Date();
    await existing.save();

    if (Array.isArray(filesCache)) {
      const cached = filesCache.find((file) => file.id === existing.id || file.path === filePath);
      if (cached) {
        cached.name = existing.name;
        cached.path = existing.path;
        cached.content = existing.content;
        cached.language = existing.language;
        cached.updated_at = existing.updated_at.toISOString();
      }
    }

    return { action: 'updated', file: serializeFile(existing) };
  }

  const created = await ProjectTaskFile.create({
    id: await nextSequence('project_task_files'),
    task_id: taskId,
    project_id: projectId,
    name: path.basename(filePath),
    path: filePath,
    content,
    language: detectLanguage(filePath),
  });

  if (Array.isArray(filesCache)) {
    filesCache.push(serializeFile(created));
  }

  return { action: 'created', file: serializeFile(created) };
}

export async function deleteTaskFile(taskId, filePath, filesCache = null) {
  const existing = await ProjectTaskFile.findOne({ task_id: taskId, path: filePath });
  if (!existing) return false;
  await ProjectTaskFile.deleteOne({ _id: existing._id });

  if (Array.isArray(filesCache)) {
    const index = filesCache.findIndex((file) => file.id === existing.id || file.path === filePath);
    if (index >= 0) filesCache.splice(index, 1);
  }

  return true;
}

function buildPreview(pathValue, beforeContent, afterContent) {
  if (beforeContent == null) {
    return `+++ ${pathValue}\n${String(afterContent ?? '').split('\n').slice(0, 30).join('\n')}`;
  }
  if (afterContent == null) {
    return `--- ${pathValue}\n[file deleted]`;
  }

  const beforeLines = String(beforeContent).split('\n');
  const afterLines = String(afterContent).split('\n');
  let firstChange = 0;
  while (
    firstChange < beforeLines.length
    && firstChange < afterLines.length
    && beforeLines[firstChange] === afterLines[firstChange]
  ) {
    firstChange += 1;
  }

  let beforeTail = beforeLines.length - 1;
  let afterTail = afterLines.length - 1;
  while (
    beforeTail >= firstChange
    && afterTail >= firstChange
    && beforeLines[beforeTail] === afterLines[afterTail]
  ) {
    beforeTail -= 1;
    afterTail -= 1;
  }

  const start = Math.max(0, firstChange - 2);
  const beforeChunk = beforeLines.slice(start, Math.min(beforeLines.length, beforeTail + 3));
  const afterChunk = afterLines.slice(start, Math.min(afterLines.length, afterTail + 3));
  const parts = [`@@ ${pathValue}:${firstChange + 1} @@`];
  for (const line of beforeChunk) {
    parts.push(`- ${line}`);
  }
  for (const line of afterChunk) {
    parts.push(`+ ${line}`);
  }
  return parts.slice(0, 80).join('\n');
}

export async function buildTaskReview(projectId, taskId, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit ?? 8), 20));
  const [projectFiles, taskFiles] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }),
    ProjectTaskFile.find({ task_id: taskId }).sort({ path: 1 }),
  ]);

  const projectByPath = new Map(projectFiles.map((file) => [file.path, file]));
  const taskByPath = new Map(taskFiles.map((file) => [file.path, file]));
  const added = [];
  const modified = [];
  const removed = [];
  const previews = [];

  for (const [taskPath, taskFile] of taskByPath.entries()) {
    const projectFile = projectByPath.get(taskPath);
    if (!projectFile) {
      added.push(taskPath);
      if (previews.length < limit) {
        previews.push({ path: taskPath, status: 'added', preview: buildPreview(taskPath, null, taskFile.content ?? '') });
      }
      continue;
    }
    if ((projectFile.content ?? '') !== (taskFile.content ?? '')) {
      modified.push(taskPath);
      if (previews.length < limit) {
        previews.push({ path: taskPath, status: 'modified', preview: buildPreview(taskPath, projectFile.content ?? '', taskFile.content ?? '') });
      }
    }
  }

  for (const [projectPath, projectFile] of projectByPath.entries()) {
    if (taskByPath.has(projectPath)) continue;
    removed.push(projectPath);
    if (previews.length < limit) {
      previews.push({ path: projectPath, status: 'removed', preview: buildPreview(projectPath, projectFile.content ?? '', null) });
    }
  }

  const changedPaths = [...added, ...modified, ...removed].sort((left, right) => left.localeCompare(right));
  const summary = [
    `${changedPaths.length} changed path${changedPaths.length === 1 ? '' : 's'}.`,
    added.length > 0 ? `${added.length} added` : null,
    modified.length > 0 ? `${modified.length} modified` : null,
    removed.length > 0 ? `${removed.length} removed` : null,
  ].filter(Boolean).join(' ');

  return {
    summary,
    changed_paths: changedPaths,
    added,
    modified,
    removed,
    previews,
  };
}

export async function applyTaskFilesToProject(projectId, taskId) {
  const [projectFiles, taskFiles] = await Promise.all([
    ProjectFile.find({ project_id: projectId }).sort({ path: 1 }),
    ProjectTaskFile.find({ task_id: taskId }).sort({ path: 1 }),
  ]);

  const taskByPath = new Map(taskFiles.map((file) => [file.path, file]));
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const projectFile of projectFiles) {
    const taskFile = taskByPath.get(projectFile.path);
    if (!taskFile) {
      await ProjectFile.deleteOne({ _id: projectFile._id });
      removed += 1;
      continue;
    }

    let changed = false;
    if ((projectFile.content ?? '') !== (taskFile.content ?? '')) {
      projectFile.content = taskFile.content ?? '';
      changed = true;
    }
    if (projectFile.name !== taskFile.name) {
      projectFile.name = taskFile.name;
      changed = true;
    }
    if ((projectFile.language ?? 'plaintext') !== (taskFile.language ?? 'plaintext')) {
      projectFile.language = taskFile.language ?? 'plaintext';
      changed = true;
    }
    if (changed) {
      projectFile.updated_at = new Date();
      await projectFile.save();
      updated += 1;
    }

    taskByPath.delete(projectFile.path);
  }

  for (const taskFile of taskByPath.values()) {
    await ProjectFile.create({
      id: await nextSequence('project_files'),
      project_id: projectId,
      name: taskFile.name,
      path: taskFile.path,
      content: taskFile.content ?? '',
      language: taskFile.language ?? detectLanguage(taskFile.path),
    });
    created += 1;
  }

  return {
    created,
    updated,
    removed,
    changed_paths: taskFiles.map((file) => file.path).sort((left, right) => left.localeCompare(right)),
  };
}

export async function touchTask(task, extra = {}) {
  task.updated_at = new Date();
  task.last_activity_at = new Date();
  for (const [key, value] of Object.entries(extra)) {
    task[key] = value;
  }
  await task.save();
  return serializeProjectTask(task);
}
