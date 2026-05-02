import { useState, useRef, useCallback, useEffect, useMemo, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Loader2, Copy, Check, Square, Bot, User, Zap, FilePlus, Trash2, Eye, File as FileEdit, Search, FolderOpen, Terminal, Globe, Play, ChevronDown, ChevronRight, Paperclip, X, Cpu, BookOpen, Plus, Pencil, Save, CreditCard, ShieldCheck, RotateCcw, History, MousePointerClick, RefreshCw, GitBranch, Radar, AlertTriangle, Palette, Gauge, Compass, Figma } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  saveMessage,
  streamAgent,
  getProjectConversations,
  createConversation,
  getMessages,
  listDocs,
  createDoc,
  updateDoc,
  deleteDoc,
  importProjectDoc,
  getUserCredits,
  listProjectCheckpoints,
  createProjectCheckpoint,
  restoreProjectCheckpoint,
  deleteProjectCheckpoint,
} from '../../lib/api';
import { loadUserKeys } from './UserKeysModal';
import { SecurityPanel } from './SecurityPanel';
import { TaskPanel } from './TaskPanel';
import type { AgentAutonomy, AgentEvent, AgentProfile, FilePolicy, ProjectCheckpoint, ProjectFile } from '../../types';
import type { ProjectDoc, ProjectDocImportSource } from '../../lib/api';

const APP_TESTING_STORAGE_KEY = 'luxi_app_testing_enabled';
const AGENT_PROFILE_STORAGE_KEY = 'luxi_agent_profile';
const FAST_MODE_STORAGE_KEY = 'luxi_fast_mode_enabled';
const AUTONOMY_STORAGE_KEY = 'luxi_agent_autonomy';
const WEBSITE_MODE_STORAGE_KEY = 'luxi_website_mode_enabled';
const MANUAL_BROWSER_STORAGE_KEY = 'luxi_manual_browser_enabled';
const FILE_POLICY_STORAGE_KEY_PREFIX = 'luxi_file_policy:';
const AGENT_PROFILE_OPTIONS: Array<{ id: AgentProfile; label: string; description: string }> = [
  { id: 'builder', label: 'Build', description: 'Ships features and changes end to end, with code-first execution.' },
  { id: 'design', label: 'Design', description: 'Builds UI with stronger product taste, tighter UX details, and design-reference awareness.' },
  { id: 'research', label: 'Research', description: 'Uses docs and the web more aggressively before making decisions or edits.' },
  { id: 'autofix', label: 'Autofix', description: 'Reproduces problems, validates fixes, and keeps iterating until checks pass.' },
  { id: 'security', label: 'Security', description: 'Maps attack surface, captures evidence, saves findings, patches issues, and verifies the exploit path is gone.' },
];
const AUTONOMY_OPTIONS: Array<{ id: AgentAutonomy; label: string; description: string }> = [
  { id: 'guided', label: 'Guided', description: 'Smaller safer steps with faster blocker surfacing.' },
  { id: 'standard', label: 'Standard', description: 'Balanced autonomy for everyday product work.' },
  { id: 'max', label: 'Max', description: 'Veteran-engineer mode with deeper diagnosis and more persistent recovery.' },
];

function isAgentProfile(value: string | null): value is AgentProfile {
  return value === 'builder' || value === 'design' || value === 'research' || value === 'autofix' || value === 'security';
}

function isAgentAutonomy(value: string | null): value is AgentAutonomy {
  return value === 'guided' || value === 'standard' || value === 'max';
}

function parsePathList(value: string) {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stringifyPathList(entries: string[]) {
  return entries.join('\n');
}

function readStoredFilePolicy(projectId: number): FilePolicy {
  try {
    const raw = localStorage.getItem(`${FILE_POLICY_STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return { targets: [], locked: [], ignored: [] };
    const parsed = JSON.parse(raw) as Partial<FilePolicy>;
    return {
      targets: Array.isArray(parsed.targets) ? parsed.targets.filter(Boolean) : [],
      locked: Array.isArray(parsed.locked) ? parsed.locked.filter(Boolean) : [],
      ignored: Array.isArray(parsed.ignored) ? parsed.ignored.filter(Boolean) : [],
    };
  } catch {
    return { targets: [], locked: [], ignored: [] };
  }
}

function toolMeta(tool: string): { icon: JSX.Element; label: string; cls: string; iconCls: string } {
  const icons: Record<string, JSX.Element> = {
    think: <Zap className="w-3 h-3" />, read_file: <Eye className="w-3 h-3" />,
    write_file: <FileEdit className="w-3 h-3" />, create_file: <FilePlus className="w-3 h-3" />,
    patch_file: <FileEdit className="w-3 h-3" />,
    delete_file: <Trash2 className="w-3 h-3" />, list_files: <FolderOpen className="w-3 h-3" />,
    search_files: <Search className="w-3 h-3" />, grep: <Search className="w-3 h-3" />,
    run_command: <Terminal className="w-3 h-3" />, shell: <Terminal className="w-3 h-3" />,
    start_background_command: <Play className="w-3 h-3" />, check_background_command: <Eye className="w-3 h-3" />,
    stop_background_command: <Square className="w-3 h-3" />,
    execute_code: <Terminal className="w-3 h-3" />,
    install_package: <Play className="w-3 h-3" />, browse_website: <Globe className="w-3 h-3" />,
    web_search: <Search className="w-3 h-3" />, edit_file: <FileEdit className="w-3 h-3" />,
    batch_write_files: <FilePlus className="w-3 h-3" />,
    read_local_file: <Eye className="w-3 h-3" />, write_local_file: <FileEdit className="w-3 h-3" />,
    list_local_dir: <FolderOpen className="w-3 h-3" />,
    sync_runner_workspace: <RefreshCw className="w-3 h-3" />,
    browser_action: <Globe className="w-3 h-3" />,
    project_memory: <Cpu className="w-3 h-3" />,
    github_context: <GitBranch className="w-3 h-3" />,
    security_scope: <ShieldCheck className="w-3 h-3" />,
    surface_map: <Radar className="w-3 h-3" />,
    api_spec_summary: <BookOpen className="w-3 h-3" />,
    run_security_scan: <ShieldCheck className="w-3 h-3" />,
    list_findings: <AlertTriangle className="w-3 h-3" />,
    save_finding: <ShieldCheck className="w-3 h-3" />,
    generate_security_report: <BookOpen className="w-3 h-3" />,
    create_oast_session: <MousePointerClick className="w-3 h-3" />,
    traffic_capture_summary: <Radar className="w-3 h-3" />,
    replay_traffic_request: <Play className="w-3 h-3" />,
    replay_traffic_flow: <Play className="w-3 h-3" />,
    reverse_engineer_project: <Radar className="w-3 h-3" />,
    traffic_flow_graph: <Radar className="w-3 h-3" />,
    mutate_traffic_request: <FileEdit className="w-3 h-3" />,
  };
  const labels: Record<string, string> = {
    think: 'Thinking...', read_file: 'Reading file', write_file: 'Writing file',
    patch_file: 'Patching file',
    create_file: 'Creating file', batch_write_files: 'Writing files', delete_file: 'Deleting file',
    list_files: 'Listing files', search_files: 'Searching files', grep: 'Searching code',
    run_command: 'Running command', shell: 'Running commands', install_package: 'Installing packages',
    start_background_command: 'Starting background command', check_background_command: 'Checking background command',
    stop_background_command: 'Stopping background command',
    execute_code: 'Executing code',
    browse_website: 'Browsing website', web_search: 'Searching the web', edit_file: 'Editing file',
    read_local_file: 'Reading local file', write_local_file: 'Writing local file', list_local_dir: 'Listing directory',
    sync_runner_workspace: 'Syncing runner workspace',
    browser_action: 'Browser automation',
    project_memory: 'Loading repo memory',
    github_context: 'Loading GitHub context',
    security_scope: 'Loading security scope',
    surface_map: 'Mapping attack surface',
    api_spec_summary: 'Summarizing API specs',
    run_security_scan: 'Running security scan',
    list_findings: 'Loading findings',
    save_finding: 'Saving finding',
    generate_security_report: 'Generating evidence pack',
    create_oast_session: 'Creating OAST callback',
    traffic_capture_summary: 'Loading HAR capture',
    replay_traffic_request: 'Replaying HAR request',
    replay_traffic_flow: 'Replaying HAR flow',
    reverse_engineer_project: 'Reverse engineering app',
    traffic_flow_graph: 'Building HAR flow graph',
    mutate_traffic_request: 'Mutating HAR request',
  };
  const colorMap: Record<string, [string, string]> = {
    think: ['border-violet-500/30 bg-violet-500/5', 'text-violet-400'],
    write_file: ['border-green-500/30 bg-green-500/5', 'text-green-400'],
    patch_file: ['border-green-500/30 bg-green-500/5', 'text-green-400'],
    create_file: ['border-green-500/30 bg-green-500/5', 'text-green-400'],
    edit_file: ['border-green-500/30 bg-green-500/5', 'text-green-400'],
    batch_write_files: ['border-green-500/30 bg-green-500/5', 'text-green-400'],
    write_local_file: ['border-green-500/30 bg-green-500/5', 'text-green-400'],
    delete_file: ['border-red-500/30 bg-red-500/5', 'text-red-400'],
    run_command: ['border-yellow-500/30 bg-yellow-500/5', 'text-yellow-400'],
    shell: ['border-yellow-500/30 bg-yellow-500/5', 'text-yellow-400'],
    start_background_command: ['border-amber-500/30 bg-amber-500/5', 'text-amber-400'],
    check_background_command: ['border-amber-500/30 bg-amber-500/5', 'text-amber-400'],
    stop_background_command: ['border-orange-500/30 bg-orange-500/5', 'text-orange-400'],
    install_package: ['border-yellow-500/30 bg-yellow-500/5', 'text-yellow-400'],
    execute_code: ['border-yellow-500/30 bg-yellow-500/5', 'text-yellow-400'],
    browse_website: ['border-sky-500/30 bg-sky-500/5', 'text-sky-400'],
    web_search: ['border-sky-500/30 bg-sky-500/5', 'text-sky-400'],
    grep: ['border-cyan-500/30 bg-cyan-500/5', 'text-cyan-400'],
    search_files: ['border-cyan-500/30 bg-cyan-500/5', 'text-cyan-400'],
    read_local_file: ['border-blue-500/30 bg-blue-500/5', 'text-blue-400'],
    list_local_dir: ['border-blue-500/30 bg-blue-500/5', 'text-blue-400'],
    sync_runner_workspace: ['border-blue-500/30 bg-blue-500/5', 'text-blue-400'],
    browser_action: ['border-sky-500/30 bg-sky-500/5', 'text-sky-400'],
    project_memory: ['border-indigo-500/30 bg-indigo-500/5', 'text-indigo-400'],
    github_context: ['border-indigo-500/30 bg-indigo-500/5', 'text-indigo-400'],
    security_scope: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    surface_map: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    api_spec_summary: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    run_security_scan: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    list_findings: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    save_finding: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    generate_security_report: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    create_oast_session: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    traffic_capture_summary: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    replay_traffic_request: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    replay_traffic_flow: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    reverse_engineer_project: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    traffic_flow_graph: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
    mutate_traffic_request: ['border-red-500/30 bg-red-500/5', 'text-red-300'],
  };
  const [cls, iconCls] = colorMap[tool] ?? ['border-blue-500/30 bg-blue-500/5', 'text-blue-400'];
  return { icon: icons[tool] ?? <Zap className="w-3 h-3" />, label: labels[tool] ?? tool, cls, iconCls };
}

function ToolCard({ tool, args, result, expanded, onToggle }: { tool: string; args: Record<string, unknown>; result?: string; expanded: boolean; onToggle: () => void }) {
  const { icon, label, cls, iconCls } = toolMeta(tool);
  const hint = String(args.path ?? args.name ?? args.query ?? args.command ?? args.url ?? args.action ?? '');
  return (
    <div className={cn('rounded-md border text-xs', cls)}>
      <button onClick={onToggle} className="flex items-center gap-2 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors">
        <span className={iconCls}>{icon}</span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground truncate flex-1 text-left font-mono text-[10px]">{hint}</span>
        {result ? <Check className="w-3 h-3 text-green-400 flex-shrink-0" /> : <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />}
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </button>
      {expanded && result && (
        <div className="px-2.5 pb-2 border-t border-border/30 pt-1.5">
          <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">{result}</pre>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 rounded-md overflow-hidden border border-border/60">
      <div className="flex items-center justify-between px-3 py-1 bg-muted/60 border-b border-border/40 text-[10px] text-muted-foreground font-mono">
        <span>{lang}</span>
        <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="p-0.5 hover:bg-muted rounded">
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto bg-[#0d1117] text-[12px] font-mono leading-relaxed text-gray-300"><code>{code}</code></pre>
    </div>
  );
}

function PlanCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-full bg-violet-500/10 border border-violet-500/20 flex-shrink-0 flex items-center justify-center mt-0.5">
        <Zap className="w-3 h-3 text-violet-400" />
      </div>
      <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl rounded-tl-sm px-3 py-2 max-w-[90%] min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-300/80">{title}</div>
        <div className="mt-2 space-y-1.5">
          {steps.map((step, index) => (
            <div key={`${step}-${index}`} className="flex items-start gap-2 text-[13px] text-foreground/90">
              <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-violet-400/30 text-[10px] text-violet-300/80">
                {index + 1}
              </span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThinkingCard({ content }: { content: string }) {
  return (
    <div className="pl-8">
      <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-3 py-2 text-[12px] text-violet-100/80">
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-violet-300/70">Why</span>
        <span>{content}</span>
      </div>
    </div>
  );
}

function MdContent({ content }: { content: string }) {
  const parts = content.split(/(```[\w:./\\-]*\n[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/```([\w:./\\-]*)\n([\s\S]*?)```/);
        if (m) return <CodeBlock key={i} lang={m[1].split(':')[0] || 'code'} code={m[2].trim()} />;
        return <span key={i} className="whitespace-pre-wrap text-[13px] leading-relaxed">{part}</span>;
      })}
    </>
  );
}

interface DocFormState { title: string; content: string; }
interface ConnectorImportState {
  sourceType: ProjectDocImportSource;
  url: string;
  title: string;
  token: string;
}

const TEXT_DOC_ACCEPT = [
  'text/*',
  '.txt',
  '.md',
  '.mdx',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.env',
  '.log',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.sql',
  '.graphql',
  '.gql',
  '.sh',
].join(',');
const MAX_IMPORTED_DOC_BYTES = 512 * 1024;

function looksLikeTextContent(content: string) {
  return !content.includes('\u0000');
}

function DocsPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: docs = [], isLoading } = useQuery({ queryKey: ['docs', projectId], queryFn: () => listDocs(projectId) });
  const [editing, setEditing] = useState<ProjectDoc | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<DocFormState>({ title: '', content: '' });
  const [saving, setSaving] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [connectorImport, setConnectorImport] = useState<ConnectorImportState>({
    sourceType: 'web',
    url: '',
    title: '',
    token: '',
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const steeringDoc = docs.find((doc) => doc.title === '.luxi.md') ?? null;
  const memoryDoc = docs.find((doc) => doc.title === '.luxi.memory.md') ?? null;
  const visibleDocs = docs.filter((doc) => doc.title !== '.luxi.md' && doc.title !== '.luxi.memory.md');

  const startCreate = (preset?: Partial<DocFormState>) => {
    setCreating(true);
    setEditing(null);
    setImportError(null);
    setForm({
      title: preset?.title ?? '',
      content: preset?.content ?? '',
    });
  };
  const startEdit = (doc: ProjectDoc) => { setEditing(doc); setCreating(false); setImportError(null); setForm({ title: doc.title, content: doc.content }); };
  const cancel = () => { setCreating(false); setEditing(null); setImportError(null); };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (creating) {
        await createDoc(projectId, form.title, form.content);
      } else if (editing) {
        await updateDoc(editing.id, form.title, form.content);
      }
      queryClient.invalidateQueries({ queryKey: ['docs', projectId] });
      cancel();
    } finally { setSaving(false); }
  };

  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleImportFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selectedFiles.length === 0) return;

    setImporting(true);
    setImportError(null);
    try {
      const importedDocs = await Promise.all(selectedFiles.map(async (file) => {
        if (file.size > MAX_IMPORTED_DOC_BYTES) {
          throw new Error(`${file.name} is larger than 512 KB. Split it into smaller text files before importing.`);
        }
        const content = await file.text();
        if (!looksLikeTextContent(content)) {
          throw new Error(`${file.name} does not look like a text file.`);
        }
        return {
          title: file.name,
          content,
        };
      }));

      await Promise.all(importedDocs.map((doc) => createDoc(projectId, doc.title, doc.content)));
      queryClient.invalidateQueries({ queryKey: ['docs', projectId] });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import text files.');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteDoc(id);
    queryClient.invalidateQueries({ queryKey: ['docs', projectId] });
    if (expandedDoc === id) setExpandedDoc(null);
  };

  const handleConnectorImport = async () => {
    if (!connectorImport.url.trim()) {
      setImportError('Enter a source URL before importing.');
      return;
    }

    setImporting(true);
    setImportError(null);
    try {
      await importProjectDoc(projectId, {
        sourceType: connectorImport.sourceType,
        url: connectorImport.url.trim(),
        title: connectorImport.title.trim() || undefined,
        token: connectorImport.token.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['docs', projectId] });
      setConnectorImport((current) => ({
        ...current,
        url: '',
        title: '',
        token: current.sourceType === 'figma' || current.sourceType === 'github' ? current.token : '',
      }));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import connector document.');
    } finally {
      setImporting(false);
    }
  };

  if (creating || editing) {
    return (
      <div className="flex flex-col h-full p-3 gap-3">
        <div className="flex items-center gap-2">
          <button onClick={cancel} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
          <span className="text-xs font-medium text-foreground">{creating ? 'New Doc' : 'Edit Doc'}</span>
        </div>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
        <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Paste documentation, API references, design notes..." rows={12}
          className="flex-1 w-full rounded-md border border-border bg-input px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          You can still paste docs here, or use <span className="font-medium text-foreground">Import</span> from the docs list to add `.txt`, `.md`, `.json`, `.csv`, `.log`, and other text files straight into AI context.
        </div>
        <button onClick={handleSave} disabled={saving || !form.title.trim()} className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept={TEXT_DOC_ACCEPT}
        multiple
        className="hidden"
        onChange={handleImportFiles}
      />
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Project Docs</span>
        <div className="flex items-center gap-2">
          <button onClick={handleImportClick} disabled={importing} className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50">
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />} Import
          </button>
          <button onClick={() => startCreate()} className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {importError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
            {importError}
          </div>
        )}
        <div className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-foreground">Project steering file</div>
              <div className="text-[10px] text-muted-foreground">
                Use <span className="font-mono text-foreground/80">.luxi.md</span> for architecture, constraints, preferred patterns, and project rules.
              </div>
            </div>
            <button
              onClick={() => {
                if (steeringDoc) startEdit(steeringDoc);
                else startCreate({ title: '.luxi.md', content: '# Project steering\n\n- Architecture:\n- Constraints:\n- Preferred libraries:\n- Coding rules:\n' });
              }}
              className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors flex-shrink-0"
            >
              {steeringDoc ? <Pencil className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              {steeringDoc ? 'Edit' : 'Create'}
            </button>
          </div>
          {steeringDoc && (
            <pre className="mt-2 max-h-[160px] overflow-y-auto whitespace-pre-wrap rounded border border-border/40 bg-card/60 p-2 text-[10px] font-mono text-muted-foreground">
              {steeringDoc.content || '(empty)'}
            </pre>
          )}
        </div>
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-foreground">Connectors</div>
              <div className="text-[10px] text-muted-foreground">
                Import product context from Figma, GitHub, OpenAPI docs, or live websites so the agent designs and builds against real references.
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-emerald-300">
              <Compass className="w-3 h-3" />
              External context
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</span>
              <select
                value={connectorImport.sourceType}
                onChange={(event) => setConnectorImport((current) => ({ ...current, sourceType: event.target.value as ProjectDocImportSource }))}
                className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="web">Website / docs URL</option>
                <option value="openapi">OpenAPI / Swagger URL</option>
                <option value="github">GitHub repository</option>
                <option value="figma">Figma file</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Title override</span>
              <input
                value={connectorImport.title}
                onChange={(event) => setConnectorImport((current) => ({ ...current, title: event.target.value }))}
                placeholder="Optional custom doc title"
                className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Source URL</span>
            <input
              value={connectorImport.url}
              onChange={(event) => setConnectorImport((current) => ({ ...current, url: event.target.value }))}
              placeholder={
                connectorImport.sourceType === 'figma'
                  ? 'https://www.figma.com/file/...'
                  : connectorImport.sourceType === 'github'
                  ? 'https://github.com/owner/repo'
                  : connectorImport.sourceType === 'openapi'
                  ? 'https://example.com/openapi.json'
                  : 'https://example.com/docs'
              }
              className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          {(connectorImport.sourceType === 'figma' || connectorImport.sourceType === 'github') && (
            <label className="space-y-1 block">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {connectorImport.sourceType === 'figma' ? 'Figma token' : 'GitHub token'}
              </span>
              <input
                type="password"
                value={connectorImport.token}
                onChange={(event) => setConnectorImport((current) => ({ ...current, token: event.target.value }))}
                placeholder={connectorImport.sourceType === 'figma' ? 'Optional if FIGMA_TOKEN exists in project secrets' : 'Optional for private repos or higher rate limits'}
                className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </label>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] text-muted-foreground">
              Figma imports feed design mode. GitHub and OpenAPI imports help the agent reason from real system context.
            </div>
            <button
              onClick={() => { void handleConnectorImport(); }}
              disabled={importing || !connectorImport.url.trim()}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/15 disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : connectorImport.sourceType === 'figma' ? <Figma className="w-3 h-3" /> : <Compass className="w-3 h-3" />}
              Import connector
            </button>
          </div>
        </div>
        {memoryDoc && (
          <div className="rounded-md border border-indigo-500/20 bg-indigo-500/5 px-2.5 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium text-foreground">Project memory</div>
                <div className="text-[10px] text-muted-foreground">
                  Auto-generated repo summary used to keep the agent oriented and consistent.
                </div>
              </div>
              <button
                onClick={() => startEdit(memoryDoc)}
                className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors flex-shrink-0"
              >
                <Pencil className="w-3 h-3" />
                Inspect
              </button>
            </div>
            <pre className="mt-2 max-h-[140px] overflow-y-auto whitespace-pre-wrap rounded border border-border/40 bg-card/60 p-2 text-[10px] font-mono text-muted-foreground">
              {memoryDoc.content || '(empty)'}
            </pre>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center h-20"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : visibleDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <BookOpen className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground">No docs yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 max-w-[220px]">Add docs or import text files to give the AI extra context about your project</p>
            <div className="mt-3 flex items-center gap-3">
              <button onClick={() => startCreate()} className="text-[11px] text-primary hover:underline">Add first doc</button>
              <button onClick={handleImportClick} disabled={importing} className="text-[11px] text-primary hover:underline disabled:opacity-50">Import text files</button>
            </div>
          </div>
        ) : visibleDocs.map((doc) => (
          <div key={doc.id} className="rounded-md border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                {expandedDoc === doc.id ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                <span className="text-xs font-medium text-foreground truncate">{doc.title}</span>
                {doc.source_type !== 'manual' && (
                  <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {doc.source_type}
                  </span>
                )}
              </button>
              <button onClick={() => startEdit(doc)} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3 h-3" /></button>
              <button onClick={() => handleDelete(doc.id)} className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3 h-3" /></button>
            </div>
            {expandedDoc === doc.id && (
              <div className="px-2.5 pb-2.5 border-t border-border/40">
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto pt-2">{doc.content || '(empty)'}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckpointsPanel({
  projectId,
  onFilesChanged,
  onCheckpointCreated,
}: {
  projectId: number;
  onFilesChanged: () => void;
  onCheckpointCreated: (checkpoint: ProjectCheckpoint) => void;
}) {
  const queryClient = useQueryClient();
  const { data: checkpoints = [], isLoading, refetch } = useQuery({
    queryKey: ['checkpoints', projectId],
    queryFn: () => listProjectCheckpoints(projectId),
  });
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const checkpoint = await createProjectCheckpoint(projectId, 'Manual checkpoint');
      onCheckpointCreated(checkpoint);
      refetch();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create checkpoint.');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (checkpointId: number) => {
    setRestoringId(checkpointId);
    setError(null);
    try {
      await restoreProjectCheckpoint(projectId, checkpointId);
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      onFilesChanged();
      refetch();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Failed to restore checkpoint.');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (checkpointId: number) => {
    setDeletingId(checkpointId);
    setError(null);
    try {
      await deleteProjectCheckpoint(projectId, checkpointId);
      refetch();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete checkpoint.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium text-foreground">Checkpoints</div>
          <div className="text-[10px] text-muted-foreground">Save and restore project snapshots before risky edits.</div>
        </div>
        <button
          onClick={() => { void handleCreate(); }}
          disabled={creating}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <History className="w-3 h-3" />}
          Create
        </button>
      </div>
      {error && <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">{error}</div>}
      {isLoading ? (
        <div className="flex items-center justify-center py-4"><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /></div>
      ) : checkpoints.length === 0 ? (
        <div className="rounded border border-border/50 bg-card/50 px-2 py-2 text-[10px] text-muted-foreground">No checkpoints yet.</div>
      ) : (
        checkpoints.slice(0, 5).map((checkpoint) => (
          <div key={checkpoint.id} className="rounded border border-border/50 bg-card/60 px-2 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-foreground">{checkpoint.reason || 'Project snapshot'}</div>
                <div className="text-[10px] text-muted-foreground">{new Date(checkpoint.created_at).toLocaleString()} • {checkpoint.file_count} file{checkpoint.file_count === 1 ? '' : 's'}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { void handleRestore(checkpoint.id); }}
                  disabled={restoringId === checkpoint.id}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
                >
                  {restoringId === checkpoint.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Restore
                </button>
                <button
                  onClick={() => { void handleDelete(checkpoint.id); }}
                  disabled={deletingId === checkpoint.id}
                  className="rounded-full border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

type PanelTab = 'chat' | 'docs' | 'tasks' | 'security';

interface Props {
  projectId: number;
  files: ProjectFile[];
  onFilesChanged: () => void;
  onPreviewUrl?: (url: string) => void;
  onFileOpen?: (path: string) => void;
  userId?: string;
  runnerConnected: boolean;
  runnerConfigured?: boolean;
  runnerError?: string;
  bootPrompt?: string | null;
  onBootPromptConsumed?: () => void;
}

export function AgentPanel({ projectId, files, onFilesChanged, onPreviewUrl, onFileOpen, userId, runnerConnected, runnerConfigured = false, runnerError = '', bootPrompt, onBootPromptConsumed }: Props) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PanelTab>('chat');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [attached, setAttached] = useState<{ name: string; content: string }[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [appTestingEnabled, setAppTestingEnabled] = useState(() => {
    try {
      return localStorage.getItem(APP_TESTING_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [agentProfile, setAgentProfile] = useState<AgentProfile>(() => {
    try {
      const saved = localStorage.getItem(AGENT_PROFILE_STORAGE_KEY);
      return isAgentProfile(saved) ? saved : 'builder';
    } catch {
      return 'builder';
    }
  });
  const [fastModeEnabled, setFastModeEnabled] = useState(() => {
    try {
      return localStorage.getItem(FAST_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [autonomyLevel, setAutonomyLevel] = useState<AgentAutonomy>(() => {
    try {
      const saved = localStorage.getItem(AUTONOMY_STORAGE_KEY);
      return isAgentAutonomy(saved) ? saved : 'standard';
    } catch {
      return 'standard';
    }
  });
  const [websiteModeEnabled, setWebsiteModeEnabled] = useState(() => {
    try {
      return localStorage.getItem(WEBSITE_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [manualBrowserEnabled, setManualBrowserEnabled] = useState(() => {
    try {
      return localStorage.getItem(MANUAL_BROWSER_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [targetsInput, setTargetsInput] = useState('');
  const [lockedInput, setLockedInput] = useState('');
  const [ignoredInput, setIgnoredInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bootPromptStartedRef = useRef<string | null>(null);

  const { data: docs = [] } = useQuery({ queryKey: ['docs', projectId], queryFn: () => listDocs(projectId) });
  const orderedDocs = useMemo(() => {
    const steering = docs.filter((doc) => doc.title === '.luxi.md');
    const regular = docs.filter((doc) => doc.title !== '.luxi.md');
    return [...steering, ...regular];
  }, [docs]);
  const { data: creditInfo, refetch: refetchCredits } = useQuery({
    queryKey: ['user-credits', userId],
    queryFn: () => getUserCredits(userId!),
    enabled: !!userId,
    refetchInterval: 30000,
  });
  const userKeys = loadUserKeys();
  const usingOwnKey = !!(userKeys && (
    (userKeys.provider === 'gemini' && userKeys.gemini_key) ||
    (userKeys.provider === 'anthropic' && userKeys.anthropic_key) ||
    (userKeys.provider === 'openai' && userKeys.openai_key) ||
    (userKeys.provider === 'kimi' && userKeys.kimi_key) ||
    (userKeys.provider === 'vertex' && userKeys.vertex_key)
  ));
  const appTestingActive = appTestingEnabled && runnerConnected;
  const websiteModeActive = websiteModeEnabled && runnerConnected;
  const manualBrowserActive = websiteModeActive && manualBrowserEnabled;
  const profileMeta = AGENT_PROFILE_OPTIONS.find((option) => option.id === agentProfile) ?? AGENT_PROFILE_OPTIONS[0];
  const autonomyMeta = AUTONOMY_OPTIONS.find((option) => option.id === autonomyLevel) ?? AUTONOMY_OPTIONS[1];
  const filePolicy = useMemo<FilePolicy>(() => ({
    targets: parsePathList(targetsInput),
    locked: parsePathList(lockedInput),
    ignored: parsePathList(ignoredInput),
  }), [targetsInput, lockedInput, ignoredInput]);
  const hasFilePolicy = filePolicy.targets.length > 0 || filePolicy.locked.length > 0 || filePolicy.ignored.length > 0;
  const browserSessionId = useMemo(() => `luxi-project-${projectId}-conversation-${convId ?? 'draft'}`, [projectId, convId]);

  useEffect(() => {
    try {
      localStorage.setItem(APP_TESTING_STORAGE_KEY, String(appTestingEnabled));
    } catch {}
  }, [appTestingEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_PROFILE_STORAGE_KEY, agentProfile);
    } catch {}
  }, [agentProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(FAST_MODE_STORAGE_KEY, String(fastModeEnabled));
    } catch {}
  }, [fastModeEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTONOMY_STORAGE_KEY, autonomyLevel);
    } catch {}
  }, [autonomyLevel]);

  useEffect(() => {
    try {
      localStorage.setItem(WEBSITE_MODE_STORAGE_KEY, String(websiteModeEnabled));
    } catch {}
  }, [websiteModeEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(MANUAL_BROWSER_STORAGE_KEY, String(manualBrowserEnabled));
    } catch {}
  }, [manualBrowserEnabled]);

  useEffect(() => {
    const stored = readStoredFilePolicy(projectId);
    setTargetsInput(stringifyPathList(stored.targets));
    setLockedInput(stringifyPathList(stored.locked));
    setIgnoredInput(stringifyPathList(stored.ignored));
    setActiveTaskId(null);
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`${FILE_POLICY_STORAGE_KEY_PREFIX}${projectId}`, JSON.stringify(filePolicy));
    } catch {}
  }, [projectId, filePolicy]);

  useEffect(() => {
    setEvents([]); setConvId(null); setLoadingHistory(true);
    getProjectConversations(projectId).then(async (convos) => {
      if (convos.length > 0) {
        const latest = convos[0]; setConvId(latest.id);
        const msgs = await getMessages(latest.id);
        if (msgs.length > 0) {
          const restored: AgentEvent[] = [];
          for (const m of msgs) {
            if (m.role.startsWith('event:')) { try { restored.push(JSON.parse(m.content) as AgentEvent); } catch {} }
            else restored.push({ type: m.role === 'user' ? 'user' : 'message', content: m.content } as AgentEvent);
          }
          setEvents(restored);
        }
      }
    }).catch(() => {}).finally(() => setLoadingHistory(false));
  }, [projectId]);

  useEffect(() => { if (activeTab === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events, activeTab]);

  const getOrCreateConv = useCallback(async (): Promise<number> => {
    if (convId) return convId;
    const c = await createConversation(projectId, 'Chat');
    setConvId(c.id); return c.id;
  }, [convId, projectId]);

  const handleSend = useCallback(async (overrideInput?: string) => {
    const rawInput = (overrideInput ?? input).trim();
    if (!rawInput || isRunning) return;

    let msg = rawInput;
    if (attached.length > 0) {
      const ctx = attached.map((f) => `[ATTACHED FILE: ${f.name}]\n\`\`\`\n${f.content.slice(0, 50000)}\n\`\`\``).join('\n\n');
      msg = `${msg}\n\n---\nATTACHED FILES:\n${ctx}`;
    }
    const displayContent = rawInput + (attached.length > 0 ? `\n📎 ${attached.map((f) => f.name).join(', ')}` : '');
    const userEvent: AgentEvent = { type: 'user', content: displayContent };
    setEvents((prev) => [...prev, userEvent]);
    setInput(''); setAttached([]); setIsRunning(true); setExpandedTools(new Set());

    const cid = await getOrCreateConv();
    if (cid) saveMessage(cid, 'event:user', JSON.stringify(userEvent));

    const prev = events.filter((e) => e.type === 'user' || e.type === 'message');
    const history = prev.map((e) => ({ role: e.type === 'user' ? 'user' : 'assistant', content: (e as { content: string }).content }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await streamAgent({
        message: msg,
        projectId,
        files,
        docs: orderedDocs.map((d) => ({ title: d.title, content: d.content })),
        history: history.slice(-20),
        mode: 'agent',
        profile: agentProfile,
        fastMode: fastModeEnabled,
        autonomy: autonomyLevel,
        appTesting: appTestingActive,
        websiteMode: websiteModeActive,
        manualBrowser: manualBrowserActive,
        browserSessionId: cid ? `luxi-project-${projectId}-conversation-${cid}` : browserSessionId,
        filePolicy,
        taskId: activeTaskId ?? undefined,
        userKeys: userKeys ?? undefined,
        userId,
      }, controller.signal);
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setEvents((p) => [...p, { type: 'error', content: err.error ?? 'Something went wrong' }]);
        setIsRunning(false); return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim(); if (!data) continue;
          try {
            const event = JSON.parse(data) as AgentEvent;
            if (event.type === 'done') continue;
            setEvents((p) => [...p, event]);
            if (cid) saveMessage(cid, `event:${event.type}`, JSON.stringify(event));
            if (event.type === 'file_changed') {
              onFilesChanged();
              queryClient.invalidateQueries({ queryKey: ['files', projectId] });
              if (event.action === 'created' && onFileOpen) onFileOpen(event.path);
            }
            if (event.type === 'task_file_changed') {
              queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
            }
            if (event.type === 'preview_url') onPreviewUrl?.(event.url);
          } catch {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setEvents((p) => [...p, { type: 'error', content: 'Connection error' }]);
    }
    setIsRunning(false); abortRef.current = null;
    queryClient.invalidateQueries({ queryKey: ['files', projectId] });
    if (userId && !usingOwnKey) refetchCredits();
  }, [
    input,
    isRunning,
    attached,
    getOrCreateConv,
    events,
    projectId,
    files,
    orderedDocs,
    agentProfile,
    fastModeEnabled,
    autonomyLevel,
    appTestingActive,
    websiteModeActive,
    manualBrowserActive,
    browserSessionId,
    filePolicy,
    activeTaskId,
    userKeys,
    userId,
    queryClient,
    onFilesChanged,
    onFileOpen,
    onPreviewUrl,
    usingOwnKey,
    refetchCredits,
  ]);

  useEffect(() => {
    if (!bootPrompt) {
      bootPromptStartedRef.current = null;
      return;
    }
    setInput((current) => current.trim() ? current : bootPrompt);
  }, [bootPrompt]);

  useEffect(() => {
    if (!bootPrompt || loadingHistory || isRunning) return;
    if (bootPromptStartedRef.current === bootPrompt) return;

    const timer = setTimeout(() => {
      bootPromptStartedRef.current = bootPrompt;
      void handleSend(bootPrompt);
      onBootPromptConsumed?.();
    }, 150);

    return () => clearTimeout(timer);
  }, [bootPrompt, loadingHistory, isRunning, handleSend, onBootPromptConsumed]);

  useEffect(() => {
    if (bootPrompt) return;

    try {
      const currentUrl = new URL(window.location.href);
      const promptFromUrl = currentUrl.searchParams.get('prompt')?.trim();
      if (!promptFromUrl) return;

      setInput((current) => current.trim() ? current : promptFromUrl);
      if (loadingHistory || isRunning || bootPromptStartedRef.current === promptFromUrl) return;

      const timer = setTimeout(() => {
        bootPromptStartedRef.current = promptFromUrl;
        void handleSend(promptFromUrl);
        currentUrl.searchParams.delete('prompt');
        window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
      }, 150);

      return () => clearTimeout(timer);
    } catch {
      return;
    }
  }, [bootPrompt, projectId, loadingHistory, isRunning, handleSend]);

  const handleCheckpointCreated = useCallback((checkpoint: ProjectCheckpoint) => {
    setEvents((prev) => [
      ...prev,
      {
        type: 'checkpoint_created',
        checkpointId: checkpoint.id,
        reason: checkpoint.reason || 'Project snapshot',
        created_at: checkpoint.created_at,
      },
    ]);
  }, []);

  let toolIdx = 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-shrink-0 bg-card">
        <button onClick={() => setActiveTab('chat')} className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors', activeTab === 'chat' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
          <Bot className="w-3 h-3" /> AI Assistant
        </button>
        <button onClick={() => setActiveTab('docs')} className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors', activeTab === 'docs' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
          <BookOpen className="w-3 h-3" /> Docs
          {docs.length > 0 && <span className="ml-0.5 text-[10px] bg-primary/20 text-primary rounded-full px-1">{docs.length}</span>}
        </button>
        <button onClick={() => setActiveTab('tasks')} className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors', activeTab === 'tasks' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
          <GitBranch className="w-3 h-3" /> Tasks
          {activeTaskId !== null && <span className="ml-0.5 text-[10px] bg-primary/20 text-primary rounded-full px-1">1</span>}
        </button>
        <button onClick={() => setActiveTab('security')} className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors', activeTab === 'security' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')}>
          <ShieldCheck className="w-3 h-3" /> Security
        </button>
      </div>

      {activeTab === 'docs' ? (
        <DocsPanel projectId={projectId} />
      ) : activeTab === 'tasks' ? (
        <TaskPanel
          projectId={projectId}
          activeTaskId={activeTaskId}
          onActiveTaskChange={setActiveTaskId}
          onFilesApplied={onFilesChanged}
        />
      ) : activeTab === 'security' ? (
        <SecurityPanel projectId={projectId} activeTaskId={activeTaskId} />
      ) : (
        <>
          {runnerConfigured && !runnerConnected && (
            <div className="mx-3 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                Runner offline
              </div>
              <div className="mt-1 text-amber-100/80">
                The agent can still write code, but preview, `npm run dev`, browser checks, terminal commands, and self-verification are unavailable until the runner reconnects.
                {runnerError ? ` Current error: ${runnerError}.` : ''}
              </div>
            </div>
          )}
          {(docs.length > 0 || (userId && creditInfo && !usingOwnKey)) && (
            <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border flex-shrink-0">
              <Cpu className="w-3 h-3 text-primary/50" />
              {docs.length > 0 && <span className="text-[10px] text-muted-foreground/60 font-mono">{docs.length} doc{docs.length !== 1 ? 's' : ''} in context</span>}
              {userId && creditInfo && !usingOwnKey && (
                <span className={cn(
                  'flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border',
                  creditInfo.subscription_tier === 'unlimited'
                    ? 'text-amber-400 border-amber-400/20 bg-amber-400/5'
                    : creditInfo.balance <= 3
                    ? 'text-red-400 border-red-400/20 bg-red-400/5'
                    : 'text-muted-foreground border-border/50',
                )}>
                  <CreditCard className="w-2.5 h-2.5" />
                  {creditInfo.subscription_tier === 'unlimited' ? '∞' : creditInfo.balance}
                </span>
              )}
            </div>
          )}

          <div className="px-3 py-2 border-b border-border/70 flex-shrink-0 bg-card/60">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-border bg-muted/30 p-0.5">
                {AGENT_PROFILE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setAgentProfile(option.id)}
                    disabled={isRunning}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      agentProfile === option.id
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFastModeEnabled((value) => !value)}
                disabled={isRunning}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  fastModeEnabled
                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
                title="Use tighter context, shorter loops, and a faster decision path."
              >
                <Gauge className="w-3 h-3" />
                Fast Mode {fastModeEnabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => setAppTestingEnabled((value) => !value)}
                disabled={isRunning || !runnerConnected}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  appTestingActive
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
                title={runnerConnected ? 'Let the agent run browser-based app verification and self-fix loops' : 'Connect the runner and install Puppeteer to enable app testing'}
              >
                <Globe className="w-3 h-3" />
                App Testing {appTestingActive ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => setWebsiteModeEnabled((value) => !value)}
                disabled={isRunning || !runnerConnected}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  websiteModeActive
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-400'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
                title={runnerConnected ? 'Force a strict browser-first loop for website tasks' : 'Connect the runner to enable explicit website mode'}
              >
                <MousePointerClick className="w-3 h-3" />
                Website Mode {websiteModeActive ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdvancedControls((value) => !value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors',
                  showAdvancedControls
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
                )}
              >
                <ShieldCheck className="w-3 h-3" />
                Controls {showAdvancedControls ? 'On' : 'Off'}
              </button>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground/70">
              <span>{profileMeta.description}</span>
              <span className="mx-1.5 text-muted-foreground/40">•</span>
              <span>Autonomy: <span className="text-foreground/80">{autonomyMeta.label}</span></span>
              {fastModeEnabled && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40">•</span>
                  <span>Fast mode is trimming context and loop depth for quicker turnarounds.</span>
                </>
              )}
              <span className="mx-1.5 text-muted-foreground/40">•</span>
              <span>{runnerConnected ? 'Runner connected for commands and browser work.' : 'Connect the runner for commands, browser tests, and self-fix loops.'}</span>
              {websiteModeActive && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40">•</span>
                  <span>Using browser session <span className="font-mono text-foreground/80">{browserSessionId}</span>.</span>
                </>
              )}
              {activeTaskId !== null && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40">•</span>
                  <span>Isolated task workspace #{activeTaskId} is active.</span>
                </>
              )}
              {hasFilePolicy && (
                <>
                  <span className="mx-1.5 text-muted-foreground/40">•</span>
                  <span>{filePolicy.targets.length > 0 ? `${filePolicy.targets.length} target` : 'No targets'}, {filePolicy.locked.length} locked, {filePolicy.ignored.length} ignored</span>
                </>
              )}
            </div>
            {showAdvancedControls && (
              <div className="mt-3 space-y-2">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Compass className="w-3 h-3" />
                      Autonomy
                    </div>
                    <div className="flex items-center gap-1 rounded-full border border-border bg-muted/30 p-0.5">
                      {AUTONOMY_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setAutonomyLevel(option.id)}
                          disabled={isRunning}
                          className={cn(
                            'flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            autonomyLevel === option.id
                              ? 'bg-primary/15 text-primary'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          title={option.description}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {autonomyMeta.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualBrowserEnabled((value) => !value)}
                    disabled={isRunning || !websiteModeActive}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      manualBrowserActive
                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                    title="Launch the browser visibly on the runner machine so you can complete OTP/CAPTCHA and then resume the same session."
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Manual Browser {manualBrowserActive ? 'Enabled' : 'Disabled'}
                  </button>
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-[10px] text-muted-foreground">
                    Locked and ignored files are enforced during edits. Targets restrict writes to selected paths or folders. Design mode works best when you import Figma or product docs in the Docs tab first.
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Targets</label>
                    <textarea
                      value={targetsInput}
                      onChange={(e) => setTargetsInput(e.target.value)}
                      rows={4}
                      placeholder="src/components&#10;server/lib/ai.js"
                      className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Locked</label>
                    <textarea
                      value={lockedInput}
                      onChange={(e) => setLockedInput(e.target.value)}
                      rows={4}
                      placeholder="package.json&#10;src/App.tsx"
                      className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Ignored</label>
                    <textarea
                      value={ignoredInput}
                      onChange={(e) => setIgnoredInput(e.target.value)}
                      rows={4}
                      placeholder="dist&#10;coverage&#10;generated/"
                      className="w-full rounded-lg border border-border bg-input px-2 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                </div>
                <CheckpointsPanel
                  projectId={projectId}
                  onFilesChanged={onFilesChanged}
                  onCheckpointCreated={handleCheckpointCreated}
                />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {loadingHistory ? (
              <div className="flex items-center justify-center h-20"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-sm font-medium text-foreground mb-2">Just type what you want</h3>
                <div className="space-y-1.5 text-left">
                  {[
                    'Build a todo app with React',
                    'Add dark mode to this project',
                    'Fix the bug in my login form',
                    'Visit https://example.com, inspect the page, and tell me why the signup flow fails',
                    'What does this function do?',
                    'Search for the best chart library',
                  ].map((ex) => (
                    <button key={ex} onClick={() => setInput(ex)}
                      className="block w-full text-left text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ) : events.map((event, idx) => {
              if (event.type === 'user') return (
                <div key={idx} className="flex gap-2 justify-end">
                  <div className="bg-primary/15 border border-primary/20 rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{event.content}</p>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex-shrink-0 flex items-center justify-center mt-0.5">
                    <User className="w-3 h-3 text-primary" />
                  </div>
                </div>
              );
              if (event.type === 'plan') return (
                <PlanCard key={idx} title={event.title} steps={event.steps} />
              );
              if (event.type === 'thinking') return (
                <ThinkingCard key={idx} content={event.content} />
              );
              if (event.type === 'message') return (
                <div key={idx} className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-muted border border-border flex-shrink-0 flex items-center justify-center mt-0.5">
                    <Bot className="w-3 h-3 text-primary" />
                  </div>
                  <div className="bg-card border border-border rounded-xl rounded-tl-sm px-3 py-2 max-w-[90%] min-w-0">
                    <MdContent content={event.content} />
                  </div>
                </div>
              );
              if (event.type === 'tool_call') {
                const ci = toolIdx++;
                const resultEvent = events.find((e, i) => i > idx && e.type === 'tool_result' && (e as Extract<AgentEvent, { type: 'tool_result' }>).id === event.id) as Extract<AgentEvent, { type: 'tool_result' }> | undefined;
                return (
                  <div key={idx} className="pl-8">
                    <ToolCard tool={event.tool} args={event.args} result={resultEvent?.result}
                      expanded={expandedTools.has(ci)} onToggle={() => setExpandedTools((p) => { const n = new Set(p); if (n.has(ci)) n.delete(ci); else n.add(ci); return n; })} />
                  </div>
                );
              }
              if (event.type === 'tool_result') return null;
              if (event.type === 'file_changed') return (
                <div key={idx} className="pl-8">
                  <div className="text-[11px] text-green-400/70 flex items-center gap-1 font-mono">
                    <Check className="w-3 h-3" />{event.action} {event.path}
                  </div>
                </div>
              );
              if (event.type === 'task_file_changed') return (
                <div key={idx} className="pl-8">
                  <div className="text-[11px] text-sky-400/80 flex items-center gap-1 font-mono">
                    <GitBranch className="w-3 h-3" />task {event.action} {event.path}
                  </div>
                </div>
              );
              if (event.type === 'checkpoint_created') return (
                <div key={idx} className="pl-8">
                  <div className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-mono text-primary">
                    <History className="w-3 h-3" />
                    Checkpoint #{event.checkpointId} • {event.reason}
                  </div>
                </div>
              );
              if (event.type === 'browser_handoff') return (
                <div key={idx} className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-amber-400/10 border border-amber-400/20 flex-shrink-0 flex items-center justify-center mt-0.5">
                    <Globe className="w-3 h-3 text-amber-400" />
                  </div>
                  <div className="bg-amber-400/5 border border-amber-400/20 rounded-xl rounded-tl-sm px-3 py-2 max-w-[90%] min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">Manual Browser Handoff</div>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground/90">{event.content}</p>
                    <div className="mt-2 text-[10px] font-mono text-amber-200/80">session: {event.sessionId}</div>
                  </div>
                </div>
              );
              if (event.type === 'error') return (
                <div key={idx} className="flex gap-2">
                  <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-sm text-destructive max-w-[90%]">{event.content}</div>
                </div>
              );
              return null;
            })}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-3 flex-shrink-0">
            {attached.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {attached.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-muted border border-border px-2 py-0.5 rounded-full text-muted-foreground">
                    <Paperclip className="w-2.5 h-2.5" />{f.name}
                    <button onClick={() => setAttached((p) => p.filter((_, j) => j !== i))}><X className="w-2.5 h-2.5 hover:text-foreground" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                placeholder={
                  websiteModeActive
                    ? 'Describe the site, URL, or flow to inspect. The agent will use a persistent browser session and keep retrying until verified or blocked.'
                    : agentProfile === 'research'
                    ? 'Ask for code, comparisons, architecture choices, or researched recommendations...'
                    : agentProfile === 'autofix'
                    ? 'Describe the bug, failing flow, or broken output you want fixed...'
                    : 'Describe what you want in plain English...'
                }
                disabled={isRunning} rows={2}
                className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 resize-none transition-colors" />
              <div className="flex flex-col gap-1">
                <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Attach file">
                  <Paperclip className="w-4 h-4" />
                </button>
                {isRunning ? (
                  <button onClick={() => { abortRef.current?.abort(); setIsRunning(false); }} className="p-2 rounded-lg bg-destructive/20 border border-destructive/30 hover:bg-destructive/30 text-destructive">
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={() => { void handleSend(); }} disabled={!input.trim()} className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <input ref={fileInputRef} type="file" className="hidden" multiple onChange={(e) => {
              if (!e.target.files) return;
              Array.from(e.target.files).forEach((file) => {
                const r = new FileReader();
                r.onload = () => setAttached((p) => [...p, { name: file.name, content: r.result as string }]);
                r.readAsText(file);
              });
            }} />
          </div>
        </>
      )}
    </div>
  );
}
