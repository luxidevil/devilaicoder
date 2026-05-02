import { apiFetch, apiJson } from './supabase';
import type { ProjectFile } from '../types';

export function getRunnerBaseUrl(runnerUrl: string) {
  return runnerUrl.replace(/\/$/, '');
}

export async function projectRunnerJson<T>(
  projectId: number,
  endpoint: 'run' | 'write' | 'read' | 'install' | 'ls' | 'browser',
  body: Record<string, unknown>,
): Promise<T> {
  return apiJson<T>(`/projects/${projectId}/runner/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function projectRunnerFetch(
  projectId: number,
  endpoint: 'run' | 'write' | 'read' | 'install' | 'ls' | 'browser',
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return apiFetch(`/projects/${projectId}/runner/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
}

export async function syncProjectFilesToRunner(
  projectId: number,
  files: ProjectFile[],
) {
  if (files.length === 0) return;

  for (const file of files) {
    await projectRunnerJson(projectId, 'write', {
      filePath: file.path,
      content: file.content ?? '',
    });
  }
}
