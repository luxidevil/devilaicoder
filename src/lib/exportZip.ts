import { zipSync, strToU8 } from 'fflate';
import type { ProjectFile } from '../types';

export function exportProjectAsZip(projectName: string, files: ProjectFile[]) {
  const zipFiles: Record<string, Uint8Array> = {};

  for (const file of files) {
    const path = file.path.startsWith('/') ? file.path.slice(1) : file.path;
    zipFiles[path] = strToU8(file.content ?? '');
  }

  const zipped = zipSync(zipFiles, { level: 6 });
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName.replace(/[^a-z0-9_-]/gi, '_')}.zip`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
