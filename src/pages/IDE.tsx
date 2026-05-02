import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Home, Zap, Globe, Settings, Loader2, ExternalLink, X, Key, Search, ChevronDown, Download, Terminal, Lock, Rocket, Server, Github } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '../lib/utils';
import { getLanguageFromPath } from '../lib/language';
import { FileExplorer } from '../components/ide/FileExplorer';
import { AgentPanel } from '../components/ide/AgentPanel';
import { UserKeysModal, loadUserKeys } from '../components/ide/UserKeysModal';
import { TerminalPanel } from '../components/ide/TerminalPanel';
import { SecretsPanel } from '../components/ide/SecretsPanel';
import { DevServerPanel } from '../components/ide/DevServerPanel';
import { DeployPanel } from '../components/ide/DeployPanel';
import { RepoPanel } from '../components/ide/RepoPanel';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/index';
import { getProject, listFiles, updateFile, getRunnerClientConfig } from '../lib/api';
import { exportProjectAsZip } from '../lib/exportZip';
import { useAuth } from '../lib/auth';
import type { ProjectFile } from '../types';

const PROMPT_BOOT_STORAGE_PREFIX = 'luxi_boot_prompt:';

function getLangBadge(lang: string) {
  const colors: Record<string, string> = {
    typescript: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    javascript: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
    python: 'bg-green-500/15 text-green-400 border-green-500/20',
    rust: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    go: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  };
  return colors[lang] ?? 'bg-muted/50 text-muted-foreground border-border';
}

interface Tab { id: number; path: string; name: string; dirty: boolean }

function FileTabs({ tabs, activeId, onSelect, onClose }: { tabs: Tab[]; activeId: number | null; onSelect: (id: number) => void; onClose: (id: number) => void }) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-0 overflow-x-auto border-b border-border bg-card flex-shrink-0 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 border-r border-border cursor-pointer group flex-shrink-0 transition-colors select-none',
            activeId === tab.id
              ? 'bg-[#1e1e1e] text-foreground border-t-2 border-t-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
          )}
        >
          <span className="text-xs font-mono truncate max-w-[120px]">{tab.name}</span>
          {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-primary/80 flex-shrink-0" />}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
            className={cn(
              'p-0.5 rounded transition-opacity',
              activeId === tab.id ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
            )}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function FileSearchOverlay({ files, onSelect, onClose }: { files: ProjectFile[]; onSelect: (id: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = query.trim()
    ? files.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()) || f.name.toLowerCase().includes(query.toLowerCase()))
    : files.slice(0, 20);

  const [cursor, setCursor] = useState(0);

  useEffect(() => { setCursor(0); }, [query]);

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === 'Enter' && filtered[cursor]) { onSelect(filtered[cursor].id); onClose(); }
              if (e.key === 'Escape') onClose();
            }}
          />
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">Esc</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No files found</p>
          ) : filtered.map((f, i) => (
            <div
              key={f.id}
              onClick={() => { onSelect(f.id); onClose(); }}
              className={cn('flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors', i === cursor ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/40 text-muted-foreground hover:text-foreground')}
            >
              <span className="text-xs font-mono truncate">{f.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type BottomTab = 'terminal' | 'devserver' | 'secrets' | 'repo' | 'deploy';

const BOTTOM_TABS: { id: BottomTab; label: string; icon: typeof Terminal }[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'devserver', label: 'Dev Server', icon: Server },
  { id: 'secrets', label: 'Secrets', icon: Lock },
  { id: 'repo', label: 'Repo', icon: Github },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
];

export default function IDE() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId), enabled: !!projectId });
  const { data: files = [], isLoading: filesLoading } = useQuery({ queryKey: ['files', projectId], queryFn: () => listFiles(projectId), enabled: !!projectId, refetchInterval: 5000 });
  const { data: runnerConfig } = useQuery({ queryKey: ['runner-config'], queryFn: getRunnerClientConfig, staleTime: 60000 });

  const runnerUrl = runnerConfig?.runner_url ?? '';
  const runnerConfigured = !!runnerConfig?.configured;
  const runnerConnected = !!runnerConfig?.configured && !!runnerConfig?.reachable;
  const runnerError = runnerConfig?.error ?? '';

  const updateMut = useMutation({
    mutationFn: ({ fileId, content }: { fileId: number; content: string }) => updateFile(projectId, fileId, { content }),
    onSuccess: () => { setIsSaving(false); queryClient.invalidateQueries({ queryKey: ['files', projectId] }); },
    onError: () => setIsSaving(false),
  });

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [editorContents, setEditorContents] = useState<Record<number, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [userKeysSet, setUserKeysSet] = useState(() => !!loadUserKeys());
  const [showBottom, setShowBottom] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('terminal');
  const [bootPrompt, setBootPrompt] = useState<string | null>(null);

  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const lastSaved = useRef<Record<number, string>>({});
  const isEditing = useRef<Record<number, boolean>>({});
  const editTime = useRef<Record<number, number>>({});
  const filesRef = useRef<ProjectFile[]>(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  useEffect(() => {
    Object.values(saveTimers.current).forEach(clearTimeout);
    saveTimers.current = {};
    lastSaved.current = {};
    isEditing.current = {};
    editTime.current = {};
    setTabs([]);
    setActiveTabId(null);
    setEditorContents({});
    setIsSaving(false);
    setShowFileSearch(false);
    setShowPreview(false);
    setPreviewUrl('');
    try {
      const storedPrompt = sessionStorage.getItem(`${PROMPT_BOOT_STORAGE_PREFIX}${projectId}`);
      if (storedPrompt) {
        sessionStorage.removeItem(`${PROMPT_BOOT_STORAGE_PREFIX}${projectId}`);
        setBootPrompt(storedPrompt);
      } else {
        setBootPrompt(null);
      }
    } catch {
      setBootPrompt(null);
    }
  }, [projectId]);

  useEffect(() => () => {
    Object.values(saveTimers.current).forEach(clearTimeout);
  }, []);

  const activeFile = files.find((f) => f.id === activeTabId);

  const openTab = useCallback((fileId: number) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    setTabs((prev) => {
      if (prev.find((t) => t.id === fileId)) return prev;
      return [...prev, { id: fileId, path: file.path, name: file.name, dirty: false }];
    });
    setActiveTabId(fileId);
    setEditorContents((prev) => {
      if (prev[fileId] !== undefined) return prev;
      return { ...prev, [fileId]: file.content };
    });
    lastSaved.current[fileId] = file.content;
  }, [files]);

  useEffect(() => {
    if (files.length === 0) return;
    if (activeTabId !== null && files.some((f) => f.id === activeTabId)) return;
    openTab(files[0].id);
  }, [files, activeTabId, openTab]);

  useEffect(() => {
    tabs.forEach((tab) => {
      const file = files.find((f) => f.id === tab.id);
      if (!file) return;
      const ago = Date.now() - (editTime.current[tab.id] ?? 0);
      if (!isEditing.current[tab.id] && ago > 2000) {
        if (file.content !== editorContents[tab.id]) {
          setEditorContents((prev) => ({ ...prev, [tab.id]: file.content }));
          lastSaved.current[tab.id] = file.content;
        }
      }
    });
  }, [files]);

  const closeTab = useCallback((tabId: number) => {
    setTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId && newTabs.length > 0) {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = newTabs[Math.max(0, idx - 1)];
        setActiveTabId(next.id);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const flush = useCallback((fileId: number, content: string) => {
    setIsSaving(true);
    updateMut.mutate({ fileId, content });
    lastSaved.current[fileId] = content;
    setTabs((prev) => prev.map((t) => t.id === fileId ? { ...t, dirty: false } : t));
  }, [updateMut]);

  const handleEditorChange = useCallback((value?: string) => {
    if (!activeTabId) return;
    const v = value ?? '';
    setEditorContents((prev) => ({ ...prev, [activeTabId]: v }));
    isEditing.current[activeTabId] = true;
    editTime.current[activeTabId] = Date.now();
    setTabs((prev) => prev.map((t) => t.id === activeTabId && v !== lastSaved.current[activeTabId] ? { ...t, dirty: true } : t));
    if (saveTimers.current[activeTabId]) clearTimeout(saveTimers.current[activeTabId]);
    setIsSaving(true);
    saveTimers.current[activeTabId] = setTimeout(() => {
      flush(activeTabId, v);
      isEditing.current[activeTabId] = false;
    }, 800);
  }, [activeTabId, flush]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabId) {
          const c = editorContents[activeTabId] ?? '';
          if (c !== lastSaved.current[activeTabId]) flush(activeTabId, c);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setShowFileSearch(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        setShowBottom((v) => !v);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [activeTabId, editorContents, flush, closeTab]);

  const editorValue = activeTabId !== undefined ? (editorContents[activeTabId ?? -1] ?? activeFile?.content ?? '') : '';

  const openBottomTab = (tab: BottomTab) => {
    setActiveBottomTab(tab);
    setShowBottom(true);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden relative">
      <header className="h-10 flex items-center px-3 border-b border-border bg-card flex-shrink-0 gap-2">
        <Link href="/">
          <a>
            <button className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <Home className="w-4 h-4" />
            </button>
          </a>
        </Link>
        <div className="w-px h-4 bg-border" />
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="text-sm font-medium text-foreground truncate max-w-[200px]">{project?.name ?? 'Loading...'}</span>
        {project?.language && (
          <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border', getLangBadge(project.language))}>
            {project.language}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {isSaving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving
            </span>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => setShowFileSearch(true)} className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                <Search className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Search files (Ctrl+P)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={cn('p-1.5 rounded transition-colors', showPreview ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground')}
              >
                <Globe className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Web Preview</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openBottomTab('terminal')}
                className={cn(
                  'p-1.5 rounded transition-colors relative',
                  showBottom && activeBottomTab === 'terminal' ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                <Terminal className="w-4 h-4" />
                {runnerConnected && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Terminal (Ctrl+`){runnerConnected ? ' — Runner connected' : ' — Runner not connected'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openBottomTab('devserver')}
                className={cn('p-1.5 rounded transition-colors', showBottom && activeBottomTab === 'devserver' ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground')}
              >
                <Server className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Dev Server</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openBottomTab('secrets')}
                className={cn('p-1.5 rounded transition-colors', showBottom && activeBottomTab === 'secrets' ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground')}
              >
                <Lock className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Secrets & Env</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openBottomTab('repo')}
                className={cn('p-1.5 rounded transition-colors', showBottom && activeBottomTab === 'repo' ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground')}
              >
                <Github className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Repo & GitHub</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openBottomTab('deploy')}
                className={cn('p-1.5 rounded transition-colors', showBottom && activeBottomTab === 'deploy' ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground')}
              >
                <Rocket className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Deploy</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => { setShowKeysModal(true); }}
                className={cn('p-1.5 rounded transition-colors', userKeysSet ? 'text-green-400 hover:bg-muted' : 'text-amber-400 hover:bg-muted animate-pulse')}
              >
                <Key className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{userKeysSet ? 'API Keys configured' : 'Add your API key'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => project && exportProjectAsZip(project.name, files)}
                disabled={!project || files.length === 0}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Export as ZIP</TooltipContent>
          </Tooltip>

          <Link href="/admin">
            <a>
              <button className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                <Settings className="w-4 h-4" />
              </button>
            </a>
          </Link>
        </div>
      </header>

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <Panel defaultSize={16} minSize={12} maxSize={28} className="border-r border-border bg-card overflow-hidden flex flex-col">
          <FileExplorer
            projectId={projectId}
            files={files}
            selectedFileId={activeTabId}
            onSelectFile={(id) => openTab(id)}
          />
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />

        <Panel defaultSize={60} minSize={30} className="overflow-hidden flex flex-col">
          <PanelGroup direction="vertical" className="flex-1 overflow-hidden">
            <Panel defaultSize={showBottom ? 65 : 100} minSize={30} className="overflow-hidden flex flex-col bg-[#1e1e1e] relative">
              <FileTabs tabs={tabs} activeId={activeTabId} onSelect={(id) => setActiveTabId(id)} onClose={closeTab} />

              {showFileSearch && (
                <FileSearchOverlay files={files} onSelect={(id) => { openTab(id); }} onClose={() => setShowFileSearch(false)} />
              )}

              {filesLoading ? (
                <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : activeFile ? (
                <Editor
                  height="100%"
                  language={getLanguageFromPath(activeFile.path)}
                  value={editorValue}
                  onChange={handleEditorChange}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontLigatures: true,
                    minimap: { enabled: tabs.length > 3 },
                    scrollBeyondLastLine: false,
                    padding: { top: 12, bottom: 12 },
                    wordWrap: 'off',
                    automaticLayout: true,
                    tabSize: 2,
                    cursorBlinking: 'smooth',
                    smoothScrolling: true,
                    renderLineHighlight: 'line',
                    bracketPairColorization: { enabled: true },
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <Zap className="w-8 h-8 mx-auto mb-3 text-primary/20" />
                    <p className="text-sm mb-1">No file open</p>
                    <p className="text-xs text-muted-foreground/50">Select a file or ask the AI to create one</p>
                  </div>
                </div>
              )}
            </Panel>

            {showBottom && (
              <>
                <PanelResizeHandle className="h-1 bg-border hover:bg-primary/40 transition-colors cursor-row-resize" />
                <Panel defaultSize={35} minSize={20} maxSize={60} className="border-t border-border overflow-hidden flex flex-col bg-card">
                  <div className="flex items-center gap-0 border-b border-border flex-shrink-0 bg-card">
                    {BOTTOM_TABS.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveBottomTab(tab.id)}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors border-r border-border',
                            activeBottomTab === tab.id
                              ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
                          )}
                        >
                          <Icon className="w-3 h-3" />
                          {tab.label}
                          {tab.id !== 'secrets' && tab.id !== 'deploy' && !runnerConnected && (
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                          )}
                          {(tab.id === 'terminal' || tab.id === 'devserver' || tab.id === 'repo') && runnerConnected && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400/70" />
                          )}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setShowBottom(false)}
                      className="ml-auto p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors mr-1"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                    <div className="flex-1 overflow-hidden">
                      {activeBottomTab === 'terminal' && (
                      <TerminalPanel projectId={projectId} files={files} runnerUrl={runnerUrl} />
                    )}
                    {activeBottomTab === 'devserver' && (
                      <DevServerPanel
                        projectId={projectId}
                        files={files}
                        runnerUrl={runnerUrl}
                        onPreviewUrl={(url) => { setPreviewUrl(url); setShowPreview(true); }}
                      />
                    )}
                    {activeBottomTab === 'secrets' && (
                      <SecretsPanel projectId={projectId} runnerUrl={runnerUrl} />
                    )}
                    {activeBottomTab === 'repo' && (
                      <RepoPanel
                        projectId={projectId}
                        project={project}
                        runnerConnected={runnerConnected}
                      />
                    )}
                    {activeBottomTab === 'deploy' && (
                      <DeployPanel
                        projectId={projectId}
                        projectName={project?.name ?? 'project'}
                        files={files}
                        runnerUrl={runnerUrl}
                      />
                    )}
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </Panel>

        {showPreview && previewUrl && (
          <>
            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
            <Panel defaultSize={25} minSize={20} className="overflow-hidden flex flex-col border-l border-border">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card flex-shrink-0">
                <Globe className="w-3.5 h-3.5 text-primary/70" />
                <span className="text-xs text-muted-foreground truncate flex-1">{previewUrl}</span>
                <button onClick={() => window.open(previewUrl, '_blank')} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <iframe src={previewUrl} className="flex-1 w-full border-0" title="Preview" />
            </Panel>
          </>
        )}

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />

        <Panel defaultSize={24} minSize={18} maxSize={45} className="border-l border-border bg-card overflow-hidden flex flex-col">
          <AgentPanel
            projectId={projectId}
            files={files}
            userId={user?.id}
            runnerConnected={runnerConnected}
            runnerConfigured={runnerConfigured}
            runnerError={runnerError}
            bootPrompt={bootPrompt}
            onBootPromptConsumed={() => setBootPrompt(null)}
            onFilesChanged={() => queryClient.invalidateQueries({ queryKey: ['files', projectId] })}
            onPreviewUrl={(url) => { setPreviewUrl(url); setShowPreview(true); }}
            onFileOpen={(path) => {
              const tryOpen = (attempts: number) => {
                const f = filesRef.current.find((fi) => fi.path === path || fi.name === path);
                if (f) { openTab(f.id); return; }
                if (attempts > 0) setTimeout(() => tryOpen(attempts - 1), 400);
              };
              tryOpen(8);
            }}
          />
        </Panel>
      </PanelGroup>

      {showKeysModal && (
        <UserKeysModal onClose={() => { setShowKeysModal(false); setUserKeysSet(!!loadUserKeys()); }} />
      )}
    </div>
  );
}
