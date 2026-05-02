import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus, Trash2, File, FolderOpen, Pencil, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button, Input, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Tooltip, TooltipContent, TooltipTrigger } from '../ui/index';
import { createFile, deleteFile, updateFile } from '../../lib/api';
import { getLanguageFromPath } from '../../lib/language';
import type { ProjectFile } from '../../types';

interface Props {
  projectId: number;
  files: ProjectFile[];
  selectedFileId: number | null;
  onSelectFile: (id: number) => void;
}

function FileRow({
  file,
  isSelected,
  onSelect,
  onDelete,
  onRename,
}: {
  file: ProjectFile;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setNameVal(file.name);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [renaming, file.name]);

  const commitRename = () => {
    const v = nameVal.trim();
    if (v && v !== file.name) onRename(v);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div className={cn('flex items-center gap-1 px-2 py-1 bg-primary/10 border-r-2 border-primary')}>
        <File className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
        <input
          ref={inputRef}
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="flex-1 min-w-0 bg-transparent text-xs font-mono text-foreground outline-none border-b border-primary"
        />
        <button onClick={commitRename} className="text-green-400 hover:text-green-300 p-0.5"><Check className="w-3 h-3" /></button>
        <button onClick={() => setRenaming(false)} className="text-muted-foreground hover:text-foreground p-0.5"><X className="w-3 h-3" /></button>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex items-center justify-between px-3 py-1.5 group cursor-pointer hover:bg-muted/50 transition-colors',
        isSelected && 'bg-primary/10 border-r-2 border-primary',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <File className={cn('w-3.5 h-3.5 flex-shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground/60')} />
        <span className={cn('text-xs truncate font-mono', isSelected ? 'text-foreground' : 'text-muted-foreground')}>{file.name}</span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Rename"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function FileExplorer({ projectId, files, selectedFileId, onSelectFile }: Props) {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [delId, setDelId] = useState<number | null>(null);

  const createMut = useMutation({
    mutationFn: (n: string) => createFile(projectId, { name: n, path: n, content: '', language: getLanguageFromPath(n) }),
    onSuccess: (f) => { queryClient.invalidateQueries({ queryKey: ['files', projectId] }); onSelectFile(f.id); setNewName(''); setShowNew(false); },
  });

  const deleteMut = useMutation({
    mutationFn: (fileId: number) => deleteFile(projectId, fileId),
    onSuccess: (_, fileId) => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      if (selectedFileId === fileId) {
        const remaining = files.filter((f) => f.id !== fileId);
        if (remaining.length) onSelectFile(remaining[0].id);
      }
      setDelId(null);
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ fileId, name }: { fileId: number; name: string }) =>
      updateFile(projectId, fileId, { name, path: name, language: getLanguageFromPath(name) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
  });

  const grouped = files.reduce<Record<string, ProjectFile[]>>((acc, f) => {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '';
    (acc[dir] = acc[dir] ?? []).push(f);
    return acc;
  }, {});

  const dirs = Object.keys(grouped).sort();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-primary/70" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Files</span>
          {files.length > 0 && <span className="text-[10px] text-muted-foreground/50 font-mono">{files.length}</span>}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => setShowNew(true)} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <FilePlus className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New file</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {files.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground/60">No files yet</p>
            <button onClick={() => setShowNew(true)} className="mt-2 text-[11px] text-primary hover:underline">Create first file</button>
          </div>
        ) : dirs.map((dir) => (
          <div key={dir}>
            {dir && (
              <div className="flex items-center gap-1.5 px-3 py-1 mt-1">
                <FolderOpen className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[10px] font-mono text-muted-foreground/50 truncate">{dir}</span>
              </div>
            )}
            {grouped[dir].map((file) => (
              <FileRow
                key={file.id}
                file={file}
                isSelected={selectedFileId === file.id}
                onSelect={() => onSelectFile(file.id)}
                onDelete={() => setDelId(file.id)}
                onRename={(name) => renameMut.mutate({ fileId: file.id, name })}
              />
            ))}
          </div>
        ))}
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMut.mutate(newName.trim()); }}>
            <DialogHeader><DialogTitle>New File</DialogTitle></DialogHeader>
            <div className="py-4">
              <Input placeholder="e.g. src/App.tsx" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button type="submit" disabled={createMut.isPending || !newName.trim()}>Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={delId !== null} onOpenChange={(v) => !v && setDelId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete "{files.find((f) => f.id === delId)?.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">This cannot be undone.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => delId && deleteMut.mutate(delId)} disabled={deleteMut.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
