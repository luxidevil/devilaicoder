import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import Editor from "@monaco-editor/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  useGetProject,
  useListFiles,
  useCreateFile,
  useUpdateFile,
  useDeleteFile,
  getGetProjectQueryKey,
  getListFilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  FilePlus,
  Trash2,
  Send,
  Loader2,
  File,
  Copy,
  Check,
  Settings,
  Home,
  Square,
  Keyboard,
  Zap,
  FolderOpen,
  Terminal,
  Eye,
  EyeOff,
  FileEdit,
  Search,
  Play,
  ChevronDown,
  ChevronRight,
  Bot,
  User,
  Globe,
  Paperclip,
  X,
  Upload,
  MessageCircle,
  Cpu,
  Server,
  Shield,
  ExternalLink,
  History,
  Key,
  GitBranch,
  Image as ImageIcon,
  Command as CommandIcon,
  Save as SaveIcon,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { TerminalPanel } from "@/components/terminal";
import { CheckpointsDialog } from "@/components/checkpoints-dialog";
import { ProcessesPanel } from "@/components/processes-panel";
import { ConversationsMenu } from "@/components/conversations-menu";
import { FindingsPanel } from "@/components/findings-panel";
import { CodebasePanel } from "@/components/codebase-panel";
import { SecretsDialog } from "@/components/secrets-dialog";
import { GitHubDialog } from "@/components/github-dialog";
import { DiffView } from "@/components/diff-view";
import { CommandPalette, PaletteIcons, type PaletteAction } from "@/components/command-palette";
import { InlineAiEdit } from "@/components/inline-ai-edit";
import { FindInFiles } from "@/components/find-in-files";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toast } from "sonner";

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", css: "css", scss: "scss",
    html: "html", json: "json", md: "markdown", sh: "shell",
    yaml: "yaml", yml: "yaml", sql: "sql", toml: "toml",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", java: "java",
    kt: "kotlin", swift: "swift", rb: "ruby", php: "php",
    vue: "html", svelte: "html", xml: "xml", dockerfile: "dockerfile",
    env: "ini", gitignore: "ini", makefile: "makefile",
  };
  return map[ext] ?? "plaintext";
}

function getLanguageBadgeColor(lang: string) {
  const colors: Record<string, string> = {
    typescript: "text-blue-400 bg-blue-400/10",
    javascript: "text-yellow-400 bg-yellow-400/10",
    python: "text-green-400 bg-green-400/10",
    rust: "text-orange-400 bg-orange-400/10",
    go: "text-cyan-400 bg-cyan-400/10",
    css: "text-pink-400 bg-pink-400/10",
    html: "text-red-400 bg-red-400/10",
    json: "text-gray-400 bg-gray-400/10",
    markdown: "text-purple-400 bg-purple-400/10",
    java: "text-amber-400 bg-amber-400/10",
    kotlin: "text-violet-400 bg-violet-400/10",
    swift: "text-orange-300 bg-orange-300/10",
    ruby: "text-red-300 bg-red-300/10",
    php: "text-indigo-300 bg-indigo-300/10",
  };
  return colors[lang] ?? "text-gray-400 bg-gray-400/10";
}

type AgentEvent =
  | { type: "user"; content: string; images?: { mimeType: string; dataBase64: string }[] }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; id: string; tool: string; args: Record<string, any> }
  | { type: "tool_result"; id: string; tool: string; result: string }
  | { type: "file_changed"; path: string; action: string; before?: string; after?: string }
  | { type: "preview_port"; port: number }
  | { type: "preview_url"; url: string }
  | { type: "message"; content: string }
  | { type: "error"; content: string }
  | { type: "done" };

function getToolIcon(tool: string) {
  switch (tool) {
    case "think": return <Zap className="w-3 h-3" />;
    case "read_file": return <Eye className="w-3 h-3" />;
    case "write_file": return <FileEdit className="w-3 h-3" />;
    case "create_file": return <FilePlus className="w-3 h-3" />;
    case "batch_write_files": return <FilePlus className="w-3 h-3" />;
    case "delete_file": return <Trash2 className="w-3 h-3" />;
    case "list_files": return <FolderOpen className="w-3 h-3" />;
    case "search_files": return <Search className="w-3 h-3" />;
    case "grep": return <Search className="w-3 h-3" />;
    case "run_command": return <Terminal className="w-3 h-3" />;
    case "install_package": return <Play className="w-3 h-3" />;
    case "browse_website": return <Globe className="w-3 h-3" />;
    case "web_search": return <Search className="w-3 h-3" />;
    case "git_operation": return <Zap className="w-3 h-3" />;
    case "download_file": return <File className="w-3 h-3" />;
    case "read_logs": return <Eye className="w-3 h-3" />;
    case "manage_process": return <Play className="w-3 h-3" />;
    case "edit_file": return <FileEdit className="w-3 h-3" />;
    case "find_and_replace": return <Search className="w-3 h-3" />;
    case "parse_file": return <File className="w-3 h-3" />;
    case "check_port": return <Globe className="w-3 h-3" />;
    case "test_api": return <Play className="w-3 h-3" />;
    case "deploy_ssh": return <Upload className="w-3 h-3" />;
    case "todowrite": return <Check className="w-3 h-3" />;
    case "project_memory": return <Cpu className="w-3 h-3" />;
    case "shell": return <Terminal className="w-3 h-3" />;
    default: return <Zap className="w-3 h-3" />;
  }
}

function getToolLabel(tool: string) {
  switch (tool) {
    case "think": return "Thinking...";
    case "read_file": return "Reading file";
    case "write_file": return "Writing file";
    case "create_file": return "Creating file";
    case "batch_write_files": return "Writing files";
    case "delete_file": return "Deleting file";
    case "list_files": return "Listing files";
    case "search_files": return "Searching files";
    case "grep": return "Searching code";
    case "run_command": return "Running command";
    case "install_package": return "Installing packages";
    case "browse_website": return "Browsing website";
    case "web_search": return "Searching the web";
    case "git_operation": return "Git operation";
    case "download_file": return "Downloading file";
    case "read_logs": return "Reading logs";
    case "manage_process": return "Managing process";
    case "edit_file": return "Editing file";
    case "find_and_replace": return "Find & replace";
    case "parse_file": return "Parsing file";
    case "check_port": return "Checking port";
    case "test_api": return "Testing API";
    case "deploy_ssh": return "Deploying via SSH";
    case "todowrite": return "Tracking progress";
    case "project_memory": return "Project memory";
    case "shell": return "Running commands";
    default: return tool;
  }
}

function TodoChecklist({ raw }: { raw: string }) {
  let todos: { id: string; task: string; status: string }[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) todos = parsed;
  } catch {
    return null;
  }
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === "done").length;
  const total = todos.length;
  return (
    <div className="my-1 space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
        <span className="uppercase tracking-wider">Plan ({done}/{total})</span>
        <div className="flex-1 mx-2 h-0.5 bg-muted rounded overflow-hidden">
          <div
            className="h-full bg-gradient-brand transition-all"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>
      <ul className="space-y-0.5">
        {todos.map((t) => {
          const isDone = t.status === "done";
          const isActive = t.status === "in_progress";
          const isErr = t.status === "error";
          return (
            <li
              key={t.id}
              className={cn(
                "flex items-start gap-2 text-xs px-2 py-1 rounded",
                isActive && "bg-amber-500/10 ring-1 ring-amber-500/30",
                isErr && "bg-red-500/10"
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center w-3.5 h-3.5 rounded-full flex-shrink-0 mt-0.5 text-[9px] font-bold",
                  isDone && "bg-emerald-500/20 text-emerald-300",
                  isActive && "bg-amber-500/30 text-amber-200 animate-pulse",
                  isErr && "bg-red-500/30 text-red-200",
                  !isDone && !isActive && !isErr && "bg-muted text-muted-foreground"
                )}
              >
                {isDone ? "✓" : isActive ? "→" : isErr ? "✗" : "○"}
              </span>
              <span className={cn(
                "flex-1 leading-snug",
                isDone && "text-muted-foreground line-through",
                isActive && "text-foreground font-medium",
                isErr && "text-red-200"
              )}>
                {t.task}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Heuristic: did this tool result represent a failure the user might want to fix?
// We deliberately keep the markers tight (the agent server uses these literal
// prefixes for run_command / install_package / shell failures) so we don't show
// "Fix with AI" on harmless results that happen to contain the word "error".
const FAILURE_TOOLS = new Set(["run_command", "install_package", "shell", "manage_process"]);
const FAILURE_RE = /^(Exit \S+:|Error:|Command timed out)/;
function detectFailure(tool: string, result?: string): boolean {
  if (!result || !FAILURE_TOOLS.has(tool)) return false;
  return FAILURE_RE.test(result.trimStart());
}

function ToolCallCard({ tool, args, result, isExpanded, onToggle, onFix }: {
  tool: string;
  args: Record<string, any>;
  result?: string;
  isExpanded: boolean;
  onToggle: () => void;
  onFix?: (prompt: string) => void;
}) {
  // Special-case the planning tool — render as a checklist always (no need to expand)
  if (tool === "todowrite" && typeof args.todos === "string") {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
        <TodoChecklist raw={args.todos} />
      </div>
    );
  }
  const toolColor = tool === "think"
    ? "border-violet-500/30 bg-violet-500/5"
    : tool.includes("write") || tool.includes("create") || tool === "edit_file" || tool === "batch_write_files"
    ? "border-green-500/30 bg-green-500/5"
    : tool === "delete_file"
    ? "border-red-500/30 bg-red-500/5"
    : tool === "run_command" || tool === "manage_process" || tool === "install_package"
    ? "border-yellow-500/30 bg-yellow-500/5"
    : tool === "browse_website" || tool === "web_search" || tool === "download_file"
    ? "border-purple-500/30 bg-purple-500/5"
    : tool === "git_operation"
    ? "border-orange-500/30 bg-orange-500/5"
    : tool === "find_and_replace" || tool === "grep"
    ? "border-cyan-500/30 bg-cyan-500/5"
    : tool === "parse_file"
    ? "border-pink-500/30 bg-pink-500/5"
    : tool === "check_port" || tool === "test_api"
    ? "border-emerald-500/30 bg-emerald-500/5"
    : tool === "deploy_ssh"
    ? "border-sky-500/30 bg-sky-500/5"
    : tool === "todowrite"
    ? "border-amber-500/30 bg-amber-500/5"
    : tool === "project_memory"
    ? "border-indigo-500/30 bg-indigo-500/5"
    : tool === "shell"
    ? "border-yellow-500/30 bg-yellow-500/5"
    : "border-blue-500/30 bg-blue-500/5";

  const iconColor = tool === "think"
    ? "text-violet-400"
    : tool.includes("write") || tool.includes("create") || tool === "edit_file" || tool === "batch_write_files"
    ? "text-green-400"
    : tool === "delete_file"
    ? "text-red-400"
    : tool === "run_command" || tool === "manage_process" || tool === "install_package" || tool === "shell"
    ? "text-yellow-400"
    : tool === "browse_website" || tool === "web_search" || tool === "download_file"
    ? "text-purple-400"
    : tool === "git_operation"
    ? "text-orange-400"
    : tool === "find_and_replace" || tool === "grep"
    ? "text-cyan-400"
    : tool === "parse_file"
    ? "text-pink-400"
    : tool === "check_port" || tool === "test_api"
    ? "text-emerald-400"
    : tool === "deploy_ssh"
    ? "text-sky-400"
    : tool === "todowrite"
    ? "text-amber-400"
    : tool === "project_memory"
    ? "text-indigo-400"
    : "text-blue-400";

  return (
    <div className={cn("rounded-md border text-xs", toolColor)}>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors"
      >
        <span className={iconColor}>{getToolIcon(tool)}</span>
        <span className="font-medium text-foreground">{getToolLabel(tool)}</span>
        <span className="text-muted-foreground truncate flex-1 text-left font-mono text-[10px]">
          {args.path || args.name || args.query || args.command || args.url || args.operation || args.action || args.source || args.pattern || ""}
        </span>
        {result ? (
          <Check className="w-3 h-3 text-green-400 flex-shrink-0" />
        ) : (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
        )}
        {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
      </button>
      {isExpanded && result && (
        <div className="px-2.5 pb-2 border-t border-border/30 mt-0.5 pt-1.5">
          <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {result}
          </pre>
        </div>
      )}
      {onFix && detectFailure(tool, result) && (
        <div className="px-2.5 pb-1.5 pt-0.5 flex items-center gap-2 border-t border-red-500/20 bg-red-500/5">
          <Sparkles className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="text-[10px] text-red-300/80 flex-1">This {tool === "install_package" ? "install" : "command"} failed.</span>
          <button
            onClick={() => {
              const cmd = (args.command as string) || (args.name as string) || tool;
              const stderr = (result || "").slice(0, 1500);
              onFix(`The previous \`${cmd}\` failed:\n\n\`\`\`\n${stderr}\n\`\`\`\n\nPlease diagnose the root cause and fix it.`);
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 transition-colors font-medium"
            data-testid="button-fix-with-ai"
          >
            Fix with AI
          </button>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="my-2 rounded-md overflow-hidden border border-border/60">
      <div className="flex items-center justify-between px-3 py-1 bg-muted/60 border-b border-border/40 text-[10px] text-muted-foreground font-mono">
        <span>{lang}</span>
        <button onClick={handleCopy} className="p-0.5 rounded hover:bg-muted transition-colors">
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto bg-[#0d1117] text-[12px] font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const parts = content.split(/(```[\w:./\\-]*\n[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        const codeMatch = part.match(/```([\w:./\\-]*)\n([\s\S]*?)```/);
        if (codeMatch) {
          const lang = codeMatch[1].split(":")[0] || "code";
          const code = codeMatch[2].trim();
          return <CodeBlock key={i} lang={lang} code={code} />;
        }
        return <span key={i} className="whitespace-pre-wrap text-[13px] leading-relaxed">{part}</span>;
      })}
    </>
  );
}

type ChatMode = "agent" | "chat";

export default function IDE() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: files, isLoading: filesLoading } = useListFiles(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getListFilesQueryKey(projectId),
      refetchInterval: 3000,
    },
  });

  const createFile = useCreateFile();
  const updateFile = useUpdateFile();
  const deleteFile = useDeleteFile();

  // Multi-tab editor state. selectedFileId/setSelectedFileId are aliases over
  // (activeTabId, openFileInTab) so all existing call sites Just Work™.
  const [openTabs, setOpenTabs] = useState<number[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  const openFileInTab = useCallback((id: number | null) => {
    if (id == null) {
      setActiveTabId(null);
      return;
    }
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: number) => {
    setOpenTabs((tabs) => {
      const idx = tabs.indexOf(id);
      if (idx === -1) return tabs;
      const next = tabs.filter((t) => t !== id);
      setActiveTabId((cur) => {
        if (cur !== id) return cur;
        return next[idx] ?? next[idx - 1] ?? null;
      });
      return next;
    });
  }, []);

  const selectedFileId = activeTabId;
  const setSelectedFileId = openFileInTab;

  const [editorContent, setEditorContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const isUserEditingRef = useRef(false);
  const userEditTimeRef = useRef(0);

  const [newFileName, setNewFileName] = useState("");
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [attachedImages, setAttachedImages] = useState<{ name: string; mimeType: string; dataBase64: string; previewUrl: string }[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inlineEditOpen, setInlineEditOpen] = useState(false);
  const [inlineEditPos, setInlineEditPos] = useState<{ top: number; left: number } | null>(null);
  const monacoRef = useRef<any>(null);
  const inlineEditCtxRef = useRef<{
    selection: string;
    range: any;
    contextBefore: string;
    contextAfter: string;
  } | null>(null);
  const editorFocusedRef = useRef(false);
  const [renameFileId, setRenameFileId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const pendingJumpRef = useRef<{ fileId: number; line: number; column: number } | null>(null);
  const selectedFileIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const agentBottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const agentInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<any>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [chatLoading, setChatLoading] = useState(true);
  const [convoListKey, setConvoListKey] = useState(0);
  const chatLoadRequestRef = useRef(0);

  // Replay a conversation's messages into agentEvents. Tracks an incrementing
  // requestId so that fast project/convo switches don't race and clobber each
  // other (the most recent request always wins).
  const loadConversationMessages = useCallback(async (convId: number) => {
    setChatLoading(true);
    const requestId = ++chatLoadRequestRef.current;
    try {
      const msgs: any[] = await fetch(`/api/conversations/${convId}/messages`).then(r => r.json());
      if (requestId !== chatLoadRequestRef.current) return;
      const events: AgentEvent[] = [];
      for (const m of (msgs || [])) {
        if (typeof m.role === "string" && m.role.startsWith("event:")) {
          try { events.push(JSON.parse(m.content) as AgentEvent); } catch {}
        } else {
          events.push({ type: m.role === "user" ? "user" : "message", content: m.content });
        }
      }
      setAgentEvents(events);
    } catch {
      if (requestId === chatLoadRequestRef.current) setAgentEvents([]);
    } finally {
      if (requestId === chatLoadRequestRef.current) setChatLoading(false);
    }
  }, []);

  // On project switch: reset chat, then auto-open the latest conversation if any.
  useEffect(() => {
    if (!projectId) return;
    setAgentEvents([]);
    setConversationId(null);
    setChatLoading(true);
    const requestId = ++chatLoadRequestRef.current;
    fetch(`/api/projects/${projectId}/conversations`)
      .then(r => r.json())
      .then(async (convos: any[]) => {
        if (requestId !== chatLoadRequestRef.current) return;
        if (convos.length > 0) {
          const latest = convos[0];
          setConversationId(latest.id);
          await loadConversationMessages(latest.id);
        } else {
          setChatLoading(false);
        }
      })
      .catch(() => {
        if (requestId === chatLoadRequestRef.current) setChatLoading(false);
      });
  }, [projectId, loadConversationMessages]);

  // Cancel any in-flight agent stream and clear ephemeral chat UI state.
  // Called whenever we leave the current conversation context (switch / new chat)
  // so a background stream can't append events into the wrong convo and so
  // hover-state (expanded tools, attachments) doesn't bleed across chats.
  const resetEphemeralChatState = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsAgentRunning(false);
    setExpandedTools(new Set());
    setAttachedFiles([]);
    setAttachedImages([]);
  }, []);

  // User-driven actions for the conversation switcher.
  const handleSwitchConversation = useCallback(async (id: number) => {
    if (id === conversationId) return;
    resetEphemeralChatState();
    setConversationId(id);
    await loadConversationMessages(id);
  }, [conversationId, loadConversationMessages, resetEphemeralChatState]);

  const handleNewConversation = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      const convo = await res.json();
      resetEphemeralChatState();
      setConversationId(convo.id);
      setAgentEvents([]);
      setConvoListKey(k => k + 1);
    } catch {}
  }, [projectId, resetEphemeralChatState]);

  const saveMessageToDb = useCallback(async (convId: number, role: string, content: string) => {
    try {
      await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content }),
      });
      // User-visible activity → bump so the Chats menu re-orders/refreshes titles.
      if (role === "user") setConvoListKey(k => k + 1);
    } catch {}
  }, []);

  const saveEventToDb = useCallback(async (convId: number, event: AgentEvent) => {
    try {
      await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: `event:${event.type}`, content: JSON.stringify(event) }),
      });
    } catch {}
  }, []);

  const getOrCreateConversation = useCallback(async (): Promise<number> => {
    if (conversationId) return conversationId;
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Chat" }),
      });
      const convo = await res.json();
      setConversationId(convo.id);
      return convo.id;
    } catch {
      return 0;
    }
  }, [conversationId, projectId]);

  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const terminalHandleRef = useRef<import("@/components/terminal").TerminalHandle | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewKey, setPreviewKey] = useState(0);

  const [chatMode, setChatMode] = useState<ChatMode>("agent");
  const [showSSHSettings, setShowSSHSettings] = useState(false);
  const [sshForm, setSSHForm] = useState({
    sshHost: "", sshUser: "root", sshPort: "22",
    sshPassword: "", sshKey: "", sshRemotePath: "/var/www/app", sshDomain: "",
  });
  const [sshConfigured, setSSHConfigured] = useState(false);
  const [sshSaving, setSSHSaving] = useState(false);
  const [sshShowKey, setSSHShowKey] = useState(false);

  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);

  const selectedFile = files?.find((f) => f.id === selectedFileId);

  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    // Auto-trigger semantic index on first project open (Wave 10).
    // Fire-and-forget — server returns 202 immediately and indexes in background.
    if (projectId && files && files.length > 0 && !didAutoOpenRef.current) {
      fetch(`/api/projects/${projectId}/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => { /* best-effort */ });
    }
    if (files && files.length > 0 && !selectedFileId && !didAutoOpenRef.current) {
      didAutoOpenRef.current = true;
      setSelectedFileId(files[0].id);
    }
  }, [files, selectedFileId]);

  useEffect(() => {
    selectedFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  useEffect(() => {
    if (selectedFile) {
      const timeSinceEdit = Date.now() - userEditTimeRef.current;
      const userRecentlyEdited = isUserEditingRef.current || timeSinceEdit < 2000;

      if (!userRecentlyEdited || editorContent === lastSavedRef.current) {
        if (selectedFile.content !== editorContent) {
          setEditorContent(selectedFile.content);
          lastSavedRef.current = selectedFile.content;
        }
      }
    }
  }, [selectedFile?.id, selectedFile?.content, selectedFile?.updatedAt]);

  useEffect(() => {
    agentBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentEvents]);

  useEffect(() => {
    if (projectId) {
      fetch(`/api/projects/${projectId}/ssh`).then(r => r.json()).then(data => {
        setSSHConfigured(data.configured);
      }).catch(() => {});
    }
  }, [projectId]);

  useEffect(() => {
    if (showSSHSettings && projectId) {
      fetch(`/api/projects/${projectId}/ssh`).then(r => r.json()).then(data => {
        setSSHForm({
          sshHost: data.sshHost || "", sshUser: data.sshUser || "root",
          sshPort: String(data.sshPort || 22), sshPassword: data.sshPassword || "",
          sshKey: data.sshKey || "", sshRemotePath: data.sshRemotePath || "/var/www/app",
          sshDomain: data.sshDomain || "",
        });
        setSSHConfigured(data.configured);
      }).catch(() => {});
    }
  }, [showSSHSettings, projectId]);

  const saveSSHSettings = async () => {
    setSSHSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/ssh`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sshForm),
      });
      const data = await res.json();
      setSSHConfigured(data.configured);
      if (data.configured) setShowSSHSettings(false);
    } catch {}
    setSSHSaving(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setShowNewFileDialog(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        agentInputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (selectedFileId && editorContent !== lastSavedRef.current) {
          flushSave(editorContent);
        }
      }
      if (e.key === "Escape" && isAgentRunning) {
        abortRef.current?.abort();
        setIsAgentRunning(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "`") {
        e.preventDefault();
        setShowTerminal((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFileId, editorContent, isAgentRunning]);

  const flushSave = useCallback(
    (content: string) => {
      if (!selectedFileId) return;
      setIsSaving(true);
      updateFile.mutate(
        { projectId, fileId: selectedFileId, data: { content } },
        {
          onSuccess: () => {
            setIsSaving(false);
            lastSavedRef.current = content;
            queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          },
          onError: () => setIsSaving(false),
        }
      );
    },
    [selectedFileId, projectId]
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const newContent = value ?? "";
      setEditorContent(newContent);
      isUserEditingRef.current = true;
      userEditTimeRef.current = Date.now();

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (!selectedFileId) return;

      setIsSaving(true);
      saveTimeoutRef.current = setTimeout(() => {
        flushSave(newContent);
        isUserEditingRef.current = false;
      }, 800);
    },
    [selectedFileId, flushSave]
  );

  const handleCreateFile = () => {
    if (!newFileName.trim()) return;
    const lang = getLanguageFromPath(newFileName);
    createFile.mutate(
      {
        projectId,
        data: { name: newFileName.trim(), path: newFileName.trim(), content: "", language: lang },
      },
      {
        onSuccess: (file) => {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          setSelectedFileId(file.id);
          setEditorContent("");
          setNewFileName("");
          setShowNewFileDialog(false);
        },
      }
    );
  };

  const handleDeleteFile = (fileId: number) => {
    deleteFile.mutate(
      { projectId, fileId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          if (selectedFileId === fileId) {
            const remaining = files?.filter((f) => f.id !== fileId) ?? [];
            setSelectedFileId(remaining[0]?.id ?? null);
          }
          setDeleteConfirmId(null);
        },
      }
    );
  };

  // Cmd+K / Ctrl+K — open command palette globally (skipped when editor focused, handled by Monaco)
  // Cmd+P — open palette focused on file search
  // Cmd+W — close active tab
  // Cmd+Shift+[ / ] — prev/next tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k" && !editorFocusedRef.current) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isMod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isMod && e.key.toLowerCase() === "w") {
        if (activeTabId != null) {
          e.preventDefault();
          closeTab(activeTabId);
        }
        return;
      }
      // Cmd+Shift+F — Find in files
      if (isMod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen((o) => !o);
        return;
      }
      // F2 — rename active tab (ignore when typing in an input/textarea)
      if (e.key === "F2") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        const inEditable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable;
        if (!inEditable && activeTabId != null) {
          const f = files?.find((x) => x.id === activeTabId);
          if (f) {
            e.preventDefault();
            setRenameFileId(f.id);
            setRenameValue(f.name);
          }
        }
        return;
      }
      if (isMod && e.shiftKey && (e.key === "[" || e.key === "]")) {
        if (openTabs.length > 1 && activeTabId != null) {
          e.preventDefault();
          const idx = openTabs.indexOf(activeTabId);
          const dir = e.key === "]" ? 1 : -1;
          const nextIdx = (idx + dir + openTabs.length) % openTabs.length;
          setActiveTabId(openTabs[nextIdx]);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTabId, openTabs, closeTab]);

  // Prune closed tabs when files are deleted server-side
  useEffect(() => {
    if (!files) return;
    const valid = new Set(files.map((f) => f.id));
    setOpenTabs((tabs) => {
      const filtered = tabs.filter((id) => valid.has(id));
      if (filtered.length !== tabs.length) return filtered;
      return tabs;
    });
    if (activeTabId != null && !valid.has(activeTabId)) {
      setActiveTabId(null);
    }
  }, [files, activeTabId]);

  // Inline AI edit: ask the server for a replacement and apply it on accept
  const fetchInlineEditReplacement = useCallback(
    async (instruction: string): Promise<string> => {
      const ctx = inlineEditCtxRef.current;
      if (!ctx) throw new Error("No editor context");
      const lang = selectedFile ? getLanguageFromPath(selectedFile.path) : "plaintext";
      const res = await fetch("/api/ai/inline-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction,
          selection: ctx.selection,
          contextBefore: ctx.contextBefore,
          contextAfter: ctx.contextAfter,
          language: lang,
          fileName: selectedFile?.name ?? "untitled",
          projectId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      return j.replacement ?? "";
    },
    [selectedFile, projectId]
  );

  const applyInlineEdit = useCallback((replacement: string) => {
    const ctx = inlineEditCtxRef.current;
    const editor = editorRef.current;
    if (!ctx || !editor) {
      setInlineEditOpen(false);
      return;
    }
    editor.executeEdits("luxi-inline-ai", [
      { range: ctx.range, text: replacement, forceMoveMarkers: true },
    ]);
    editor.focus();
    setInlineEditOpen(false);
    inlineEditCtxRef.current = null;
    toast.success("Edit applied");
  }, []);

  const handleFileAttach = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const maxSize = 5 * 1024 * 1024;
    Array.from(fileList).forEach((file) => {
      if (file.size > maxSize) {
        setAgentEvents((prev) => [...prev, { type: "error", content: `File "${file.name}" too large (max 5MB)` }]);
        return;
      }
      // Route image MIME types to the image attachments store
      if (/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] ?? "";
          if (!base64) return;
          setAttachedImages((prev) => [
            ...prev,
            { name: file.name, mimeType: file.type, dataBase64: base64, previewUrl: dataUrl },
          ].slice(0, 8));
        };
        reader.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setAttachedFiles((prev) => [...prev, { name: file.name, content }]);
      };
      reader.readAsText(file);
    });
  }, []);

  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length === 0) return;
    e.preventDefault();
    const dt = new DataTransfer();
    imageFiles.forEach((f) => dt.items.add(f));
    handleFileAttach(dt.files);
  }, [handleFileAttach]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    handleFileAttach(e.dataTransfer.files);
  }, [handleFileAttach]);

  const handleRunAgent = async () => {
    if (!agentInput.trim() || isAgentRunning) return;

    let userMessage = agentInput.trim();

    if (attachedFiles.length > 0) {
      const filesContext = attachedFiles.map((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        const isHar = ext === "har";
        const prefix = isHar
          ? `[ATTACHED HAR FILE: ${f.name}] — Parse this with parse_file tool to extract all HTTP requests and recreate the application.\n`
          : `[ATTACHED FILE: ${f.name}]\n`;
        return `${prefix}Content:\n\`\`\`\n${f.content.slice(0, 50000)}\n\`\`\``;
      }).join("\n\n");
      userMessage = `${userMessage}\n\n---\nATTACHED FILES:\n${filesContext}`;
    }
    const sentImages = attachedImages.map((img) => ({
      mimeType: img.mimeType,
      dataBase64: img.dataBase64,
    }));
    const sentImagePreviews = attachedImages.map((img) => ({
      mimeType: img.mimeType,
      dataBase64: img.previewUrl,
    }));

    setAttachedFiles([]);
    setAttachedImages([]);
    setAgentInput("");
    setIsAgentRunning(true);
    setExpandedTools(new Set());

    const previousEvents = agentEvents.filter(
      (e) => e.type === "user" || e.type === "message"
    );

    const history = previousEvents.map((e) => ({
      role: e.type === "user" ? "user" : "assistant",
      content: (e as any).content,
    }));

    const attachmentSummary = [
      attachedFiles.length > 0 ? `📎 ${attachedFiles.map(f => f.name).join(", ")}` : "",
      sentImages.length > 0 ? `🖼 ${sentImages.length} image${sentImages.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join("  ");
    const displayContent = agentInput.trim() + (attachmentSummary ? `\n${attachmentSummary}` : "");
    const userEvent: AgentEvent = { type: "user", content: displayContent, images: sentImagePreviews };
    setAgentEvents((prev) => [...prev, userEvent]);

    const convId = await getOrCreateConversation();
    if (convId) {
      await saveEventToDb(convId, userEvent);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    if (chatMode === "chat") {
      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage,
            projectId,
            history: history.slice(-20),
            mode: "message",
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const errData = await response.json().catch(() => ({ error: "Chat not available" }));
          setAgentEvents((prev) => [...prev, { type: "error", content: errData.error ?? "Something went wrong" }]);
          setIsAgentRunning(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let fullMessage = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (!data) continue;
              try {
                const event = JSON.parse(data);
                if (event.done) continue;
                if (event.content) {
                  fullMessage += event.content;
                }
                if (event.error) {
                  setAgentEvents((prev) => [...prev, { type: "error", content: event.error }]);
                }
              } catch {}
            }
          }
        }

        if (fullMessage) {
          const msgEvent: AgentEvent = { type: "message", content: fullMessage };
          setAgentEvents((prev) => [...prev, msgEvent]);
          if (convId) saveEventToDb(convId, msgEvent);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setAgentEvents((prev) => [...prev, { type: "error", content: "Connection error" }]);
        }
      }

      setIsAgentRunning(false);
      abortRef.current = null;
      return;
    }

    try {
      const response = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          projectId,
          history: history.slice(-20),
          images: sentImages,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({ error: "Agent not available" }));
        setAgentEvents((prev) => [...prev, { type: "error", content: errData.error ?? "Something went wrong" }]);
        setIsAgentRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const pendingSaves: Promise<void>[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data) continue;
            try {
              const event = JSON.parse(data) as AgentEvent;
              if (event.type === "done") continue;

              setAgentEvents((prev) => [...prev, event]);

              if (convId) {
                pendingSaves.push(saveEventToDb(convId, event));
              }

              if (event.type === "file_changed") {
                queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
              }
              if (event.type === "preview_port" && (event as any).port) {
                const port = (event as any).port;
                setPreviewUrl(`http://localhost:${port}`);
                setShowPreview(true);
                setPreviewKey((k) => k + 1);
              }
              if (event.type === "preview_url" && (event as any).url) {
                setPreviewUrl((event as any).url);
                setShowPreview(true);
                setPreviewKey((k) => k + 1);
              }
            } catch {}
          }
        }
      }

      await Promise.allSettled(pendingSaves);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setAgentEvents((prev) => [...prev, { type: "error", content: "Connection error" }]);
      }
    }

    setIsAgentRunning(false);
    abortRef.current = null;
    queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
  };

  const handleStopAgent = () => {
    abortRef.current?.abort();
    setIsAgentRunning(false);
  };

  const editorLanguage = selectedFile ? getLanguageFromPath(selectedFile.path) : "plaintext";
  const fileCount = files?.length ?? 0;

  const toggleToolExpand = (index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  let toolCallIndex = 0;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden" data-testid="ide-container">
      <header className="h-11 flex items-center px-3 border-b border-border/70 glass-strong flex-shrink-0 gap-2">
        <Link href="/">
          <button className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground" data-testid="button-back-home">
            <Home className="w-4 h-4" />
          </button>
        </Link>
        <div className="w-px h-4 bg-border" />
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gradient-brand glow-brand-sm">
          <Zap className="w-3 h-3 text-white" />
        </span>
        <span className="text-sm font-semibold text-foreground truncate max-w-xs tracking-tight">
          {project?.name ?? "Loading..."}
        </span>
        {project?.language && (
          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded", getLanguageBadgeColor(project.language))}>
            {project.language}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {isSaving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving...
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  showPreview ? "bg-primary/20 text-primary" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
                data-testid="button-toggle-preview"
              >
                <Globe className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Web Preview</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowTerminal(!showTerminal)}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  showTerminal ? "bg-primary/20 text-primary" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
                data-testid="button-toggle-terminal"
              >
                <Terminal className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Terminal (Ctrl+`)</TooltipContent>
          </Tooltip>
          <ProcessesPanel
            projectId={projectId}
            onOpenPreview={(port) => {
              setPreviewUrl(`http://localhost:${port}`);
              setShowPreview(true);
              setPreviewKey((k) => k + 1);
            }}
          />
          <ConversationsMenu
            projectId={projectId}
            currentConversationId={conversationId}
            onSwitch={handleSwitchConversation}
            onNew={handleNewConversation}
            refreshKey={convoListKey}
          />
          <FindingsPanel projectId={projectId} />
          <CodebasePanel
            projectId={projectId}
            onOpenFile={(path) => {
              const f = files?.find((x) => x.path === path);
              if (f) setSelectedFileId(f.id);
            }}
          />
          {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowShortcuts(!showShortcuts)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Keyboard shortcuts</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowCheckpoints(true)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                data-testid="button-checkpoints"
              >
                <History className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Checkpoints (rollback)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSecrets(true)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                data-testid="button-secrets"
              >
                <Key className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Project Secrets</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowGitHub(true)}
                className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                data-testid="button-github"
              >
                <GitBranch className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>GitHub (clone, push, create)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSSHSettings(true)}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  sshConfigured ? "text-emerald-400 hover:bg-emerald-500/10" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
                data-testid="button-ssh-settings"
              >
                <Server className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{sshConfigured ? "SSH Server (configured)" : "SSH Server Settings"}</TooltipContent>
          </Tooltip>
          <Link href="/admin">
            <button className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" data-testid="link-admin">
              <Settings className="w-4 h-4" />
            </button>
          </Link>
        </div>
      </header>

      {showShortcuts && (
        <div className="px-4 py-2 bg-primary/5 border-b border-border flex flex-wrap gap-4 text-[11px] text-muted-foreground font-mono">
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground">Ctrl+N</kbd> New file</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground">Ctrl+S</kbd> Force save</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground">Ctrl+J</kbd> Focus agent</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground">Ctrl+`</kbd> Terminal</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground">Esc</kbd> Stop agent</span>
        </div>
      )}

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <Panel defaultSize={16} minSize={12} maxSize={30} className="border-r border-border bg-card overflow-hidden flex flex-col relative">
          {findOpen && (
            <div className="absolute inset-0 z-30">
              <FindInFiles
                open={findOpen}
                onClose={() => setFindOpen(false)}
                files={(files ?? []).map((f) => ({ id: f.id, name: f.name, path: f.path, content: f.content ?? "" }))}
                onJump={(fileId, line, column) => {
                  openFileInTab(fileId);
                  setFindOpen(false);
                  pendingJumpRef.current = { fileId, line, column };
                  let attempts = 0;
                  const tryJump = () => {
                    const pending = pendingJumpRef.current;
                    if (!pending) return;
                    const ed = editorRef.current;
                    if (ed && selectedFileIdRef.current === pending.fileId) {
                      ed.revealLineInCenter(pending.line);
                      ed.setPosition({ lineNumber: pending.line, column: pending.column });
                      ed.focus();
                      pendingJumpRef.current = null;
                      return;
                    }
                    attempts++;
                    if (attempts < 30) setTimeout(tryJump, 50);
                    else pendingJumpRef.current = null;
                  };
                  tryJump();
                }}
              />
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-primary/70" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Files</span>
              {fileCount > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground/60">{fileCount}</span>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowNewFileDialog(true)}
                  className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  data-testid="button-new-file"
                >
                  <FilePlus className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New file (Ctrl+N)</TooltipContent>
            </Tooltip>
          </div>

          <ScrollArea className="flex-1">
            {filesLoading ? (
              <div className="p-3 space-y-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-7 bg-muted/40 rounded animate-pulse" />
                ))}
              </div>
            ) : files && files.length > 0 ? (
              <div className="py-1">
                {files.map((file) => (
                  <ContextMenu key={file.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          "flex items-center justify-between px-3 py-1.5 group cursor-pointer hover:bg-muted/50 transition-colors",
                          selectedFileId === file.id && "bg-primary/10 border-r-2 border-primary"
                        )}
                        onClick={() => {
                          isUserEditingRef.current = false;
                          openFileInTab(file.id);
                        }}
                        onDoubleClick={() => {
                          setRenameFileId(file.id);
                          setRenameValue(file.name);
                        }}
                        data-testid={`file-item-${file.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <File className={cn("w-3.5 h-3.5 flex-shrink-0", selectedFileId === file.id ? "text-primary" : "text-muted-foreground")} />
                          {renameFileId === file.id ? (
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  const newName = renameValue.trim();
                                  if (!newName || newName === file.name) {
                                    setRenameFileId(null);
                                    return;
                                  }
                                  // Recompute path: replace last segment of file.path with newName
                                  const segs = file.path.split("/");
                                  segs[segs.length - 1] = newName;
                                  const newPath = segs.join("/");
                                  updateFile.mutate(
                                    {
                                      projectId,
                                      fileId: file.id,
                                      data: { content: file.content, name: newName, path: newPath },
                                    },
                                    {
                                      onSuccess: () => {
                                        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
                                        toast.success(`Renamed to ${newName}`);
                                        setRenameFileId(null);
                                      },
                                      onError: (err: any) => {
                                        toast.error(`Rename failed: ${err?.message ?? "unknown"}`);
                                        setRenameFileId(null);
                                      },
                                    }
                                  );
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  setRenameFileId(null);
                                }
                              }}
                              onBlur={() => setRenameFileId(null)}
                              className="text-xs font-mono bg-background border border-primary/40 rounded px-1.5 py-0.5 min-w-0 flex-1 outline-none focus:ring-1 focus:ring-primary"
                              data-testid={`input-rename-${file.id}`}
                            />
                          ) : (
                            <span className={cn("text-xs truncate font-mono", selectedFileId === file.id ? "text-foreground" : "text-muted-foreground")}>
                              {file.name}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(file.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-all text-muted-foreground"
                          data-testid={`button-delete-file-${file.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem onSelect={() => openFileInTab(file.id)}>
                        <File className="w-3.5 h-3.5 mr-2" /> Open
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => { setRenameFileId(file.id); setRenameValue(file.name); }}>
                        <FileEdit className="w-3.5 h-3.5 mr-2" /> Rename
                        <span className="ml-auto text-[10px] text-muted-foreground font-mono">F2</span>
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          navigator.clipboard.writeText(file.path).then(
                            () => toast.success("Path copied"),
                            () => toast.error("Copy failed")
                          );
                        }}
                      >
                        <Copy className="w-3.5 h-3.5 mr-2" /> Copy path
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          navigator.clipboard.writeText(file.content ?? "").then(
                            () => toast.success("Contents copied"),
                            () => toast.error("Copy failed")
                          );
                        }}
                      >
                        <Copy className="w-3.5 h-3.5 mr-2" /> Copy contents
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onSelect={() => setDeleteConfirmId(file.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-3">No files yet</p>
                <Button size="sm" variant="outline" onClick={() => setShowNewFileDialog(true)} className="text-xs">
                  <FilePlus className="w-3 h-3 mr-1" />
                  New file
                </Button>
              </div>
            )}
          </ScrollArea>
        </Panel>

        <PanelResizeHandle className="w-px bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

        <Panel defaultSize={50} minSize={30} className="flex flex-col overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">
            {!terminalMaximized && (
              <div className="flex-1 flex flex-col min-h-0">
                <PanelGroup direction="horizontal" className="flex-1">
                  <Panel defaultSize={showPreview ? 50 : 100} minSize={20} className="flex flex-col min-h-0">
                    {openTabs.length > 0 || selectedFile ? (
                      <>
                        {/* Tab strip */}
                        <div className="flex items-center h-9 border-b border-border bg-card overflow-x-auto scrollbar-thin flex-shrink-0">
                          {openTabs.map((tabId) => {
                            const tabFile = files?.find((f) => f.id === tabId);
                            if (!tabFile) return null;
                            const isActive = tabId === activeTabId;
                            return (
                              <div
                                key={tabId}
                                onClick={() => setActiveTabId(tabId)}
                                onMouseDown={(e) => {
                                  // Middle-click closes the tab
                                  if (e.button === 1) {
                                    e.preventDefault();
                                    closeTab(tabId);
                                  }
                                }}
                                className={cn(
                                  "group/tab flex items-center gap-2 px-3 h-full border-r border-border cursor-pointer transition-colors flex-shrink-0 max-w-[200px]",
                                  isActive
                                    ? "bg-background text-foreground border-b-2 border-b-primary -mb-px"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                )}
                                data-testid={`tab-${tabId}`}
                                title={tabFile.path}
                              >
                                <File className={cn("w-3 h-3 flex-shrink-0", isActive && "text-primary")} />
                                <span className="text-xs font-mono truncate">{tabFile.name}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tabId);
                                  }}
                                  className={cn(
                                    "p-0.5 rounded hover:bg-muted-foreground/20 transition-all",
                                    isActive ? "opacity-60" : "opacity-0 group-hover/tab:opacity-60"
                                  )}
                                  data-testid={`button-close-tab-${tabId}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                          {selectedFile && (
                            <div className="flex items-center gap-2 px-3 ml-auto flex-shrink-0">
                              <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded", getLanguageBadgeColor(editorLanguage))}>
                                {editorLanguage}
                              </span>
                              {isSaving ? (
                                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                              ) : (
                                <Check className="w-3 h-3 text-emerald-400/70" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 overflow-hidden relative">
                          {selectedFile ? (
                            <Editor
                              height="100%"
                              theme="vs-dark"
                              language={editorLanguage}
                              value={editorContent}
                              onChange={handleEditorChange}
                              onMount={(editor, monaco) => {
                                editorRef.current = editor;
                                monacoRef.current = monaco;
                                editor.onDidFocusEditorWidget(() => { editorFocusedRef.current = true; });
                                editor.onDidBlurEditorWidget(() => { editorFocusedRef.current = false; });
                                // Cmd+K / Ctrl+K — inline AI edit on selection
                                editor.addCommand(
                                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
                                  () => {
                                    const sel = editor.getSelection();
                                    const model = editor.getModel();
                                    if (!sel || !model) return;
                                    const selectionText = model.getValueInRange(sel);
                                    const fullText = model.getValue();
                                    const startOffset = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
                                    const endOffset = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
                                    inlineEditCtxRef.current = {
                                      selection: selectionText,
                                      range: sel,
                                      contextBefore: fullText.slice(Math.max(0, startOffset - 4000), startOffset),
                                      contextAfter: fullText.slice(endOffset, endOffset + 4000),
                                    };
                                    // Position the prompt under the selection
                                    const coords = editor.getScrolledVisiblePosition({
                                      lineNumber: sel.endLineNumber,
                                      column: 1,
                                    });
                                    setInlineEditPos(
                                      coords ? { top: coords.top + coords.height + 8, left: 16 } : { top: 16, left: 16 }
                                    );
                                    setInlineEditOpen(true);
                                  }
                                );
                              }}
                            loading={
                              <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span className="text-sm">Loading editor...</span>
                              </div>
                            }
                            options={{
                              fontSize: 13,
                              fontFamily: "'Geist Mono', 'Fira Code', 'JetBrains Mono', monospace",
                              fontLigatures: true,
                              minimap: { enabled: false },
                              scrollBeyondLastLine: false,
                              wordWrap: "on",
                              lineNumbers: "on",
                              renderLineHighlight: "line",
                              padding: { top: 12 },
                              smoothScrolling: true,
                              cursorBlinking: "smooth",
                              cursorSmoothCaretAnimation: "on",
                              tabSize: 2,
                              bracketPairColorization: { enabled: true },
                              autoClosingBrackets: "always",
                              autoClosingQuotes: "always",
                              formatOnPaste: true,
                              suggest: { preview: true, showMethods: true, showFunctions: true },
                              quickSuggestions: { other: true, comments: false, strings: true },
                              parameterHints: { enabled: true },
                            }}
                          />
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-center p-8 h-full">
                              <div className="text-xs text-muted-foreground">Loading file...</div>
                            </div>
                          )}
                          <InlineAiEdit
                            open={inlineEditOpen}
                            onCancel={() => { setInlineEditOpen(false); inlineEditCtxRef.current = null; }}
                            onApply={applyInlineEdit}
                            fetchReplacement={fetchInlineEditReplacement}
                            anchorTop={inlineEditPos?.top}
                            anchorLeft={inlineEditPos?.left}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center p-8">
                        <div>
                          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                            <File className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <h3 className="text-sm font-medium text-muted-foreground mb-2">No file open</h3>
                          <p className="text-xs text-muted-foreground/60 mb-4">Select a file from the sidebar, press <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted">⌘P</kbd> to search, or ask the agent to build something.</p>
                          <Button size="sm" variant="outline" onClick={() => setShowNewFileDialog(true)} className="text-xs">
                            <FilePlus className="w-3 h-3 mr-1" />
                            New file
                          </Button>
                        </div>
                      </div>
                    )}
                  </Panel>

                  {showPreview && (
                    <>
                      <PanelResizeHandle className="w-px bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />
                      <Panel defaultSize={50} minSize={20} className="flex flex-col min-h-0">
                        <div className="flex items-center h-9 px-3 bg-card border-b border-border gap-2 flex-shrink-0">
                          <Globe className="w-3 h-3 text-primary/70" />
                          <div className="flex-1 flex items-center bg-background/50 rounded px-2 py-0.5 border border-border/50">
                            <input
                              type="text"
                              value={previewUrl}
                              onChange={(e) => setPreviewUrl(e.target.value)}
                              placeholder="localhost:3000"
                              className="flex-1 text-[11px] bg-transparent border-none outline-none font-mono text-foreground placeholder:text-muted-foreground"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setPreviewKey((k) => k + 1);
                                }
                              }}
                            />
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => setPreviewKey((k) => k + 1)}
                                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                              >
                                <Play className="w-3 h-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Refresh preview</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => {
                                  if (previewUrl) window.open(previewUrl, "_blank");
                                }}
                                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                              >
                                <Globe className="w-3 h-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Open in new tab</TooltipContent>
                          </Tooltip>
                          <button
                            onClick={() => setShowPreview(false)}
                            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {previewUrl ? (
                          <iframe
                            key={previewKey}
                            src={previewUrl}
                            className="flex-1 w-full bg-white"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                          />
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs flex-col gap-2 bg-muted/20">
                            <Globe className="w-8 h-8 opacity-20" />
                            <span className="text-center px-4">The preview will appear here automatically when the agent starts a server</span>
                          </div>
                        )}
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              </div>
            )}
            {showTerminal && (
              <div className={cn(terminalMaximized ? "flex-1" : "h-[250px] min-h-[150px]", "border-t border-border")}>
                <TerminalPanel
                  isOpen={showTerminal}
                  onClose={() => { setShowTerminal(false); setTerminalMaximized(false); }}
                  onToggleMaximize={() => setTerminalMaximized(!terminalMaximized)}
                  isMaximized={terminalMaximized}
                  onReady={(handle) => { terminalHandleRef.current = handle; }}
                />
              </div>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

        <Panel defaultSize={34} minSize={24} maxSize={55} className="flex flex-col overflow-hidden border-l border-border bg-card">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setChatMode("agent")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
                  chatMode === "agent"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Cpu className="w-3 h-3" />
                Agent
              </button>
              <button
                onClick={() => setChatMode("chat")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
                  chatMode === "chat"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <MessageCircle className="w-3 h-3" />
                Chat
              </button>
            </div>
            <div className="flex items-center gap-1">
              {isAgentRunning && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleStopAgent}
                      className="p-1 rounded hover:bg-destructive/20 transition-colors text-destructive"
                      data-testid="button-stop-agent"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Stop agent (Esc)</TooltipContent>
                </Tooltip>
              )}
              {agentEvents.length > 0 && !isAgentRunning && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (conversationId) {
                          fetch(`/api/conversations/${conversationId}`, { method: "DELETE" }).catch(() => {});
                        }
                        setAgentEvents([]); setExpandedTools(new Set()); setConversationId(null);
                      }}
                      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Clear history</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 px-3 py-3">
            {chatLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading chat history...</span>
              </div>
            ) : agentEvents.length === 0 ? (
              <div className="text-center py-8">
                <div className="relative w-16 h-16 rounded-2xl bg-gradient-brand glow-brand flex items-center justify-center mx-auto mb-5 animate-float-soft">
                  {chatMode === "agent" ? <Bot className="text-white w-7 h-7 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" /> : <MessageCircle className="text-white w-7 h-7 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />}
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/20" />
                </div>
                <p className="text-base font-semibold tracking-tight mb-1">
                  <span className="text-gradient-brand">Luxi</span>{" "}
                  <span className="text-foreground">{chatMode === "agent" ? "Agent" : "Chat"}</span>
                </p>
                <p className="text-xs text-muted-foreground mb-1">
                  {chatMode === "agent"
                    ? "I can read, write, and edit your code. Run commands. Build anything."
                    : "Ask me anything about code, architecture, or your project."}
                </p>
                <p className="text-[11px] text-muted-foreground/80 mb-5">
                  {chatMode === "agent"
                    ? "Drop HAR/JSON/CSV files to analyze and recreate."
                    : "I'll answer questions without modifying your code."}
                </p>
                <div className="space-y-1.5">
                  {(chatMode === "agent" ? [
                    "Build me a complete website with login and signup",
                    "Create a REST API with Express and authentication",
                    "Set up a React dashboard with charts",
                    "Build a todo app with database and user accounts",
                    "Add authentication to my app",
                    "Find and fix all bugs in this project",
                  ] : [
                    "Explain how authentication works in this project",
                    "What's the best way to add a database?",
                    "How should I structure my React components?",
                    "What are the security concerns with this code?",
                    "Compare REST vs GraphQL for my use case",
                    "Help me understand async/await in TypeScript",
                  ]).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => { setAgentInput(suggestion); agentInputRef.current?.focus(); }}
                      className="group/sug block w-full text-left text-xs px-3 py-2 rounded-md border border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {(() => {
                  toolCallIndex = 0;
                  return null;
                })()}
                {agentEvents.map((event, i) => {
                  switch (event.type) {
                    case "user":
                      return (
                        <div key={i} className="flex gap-2 items-start">
                          <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <User className="w-3 h-3 text-primary" />
                          </div>
                          <div className="flex-1 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-[13px] text-foreground space-y-2">
                            <div className="whitespace-pre-wrap">{event.content}</div>
                            {Array.isArray((event as any).images) && (event as any).images.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {(event as any).images.map((img: any, k: number) => (
                                  <img
                                    key={k}
                                    src={img.dataBase64}
                                    alt={`upload-${k}`}
                                    className="max-h-32 rounded border border-border/60 object-contain bg-background/40"
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );

                    case "thinking":
                      return (
                        <div key={i} className="flex gap-2 items-start">
                          <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Zap className="w-3 h-3 text-yellow-400" />
                          </div>
                          <div className="flex-1 text-xs text-muted-foreground italic bg-yellow-500/5 border border-yellow-500/10 rounded-lg px-3 py-2">
                            {event.content}
                          </div>
                        </div>
                      );

                    case "tool_call": {
                      const currentIndex = toolCallIndex++;
                      const resultEvent = agentEvents.slice(i + 1).find(
                        (e) => e.type === "tool_result" && (e as any).id === event.id
                      ) as any;
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <ToolCallCard
                            tool={event.tool}
                            args={event.args}
                            result={resultEvent?.result}
                            isExpanded={expandedTools.has(currentIndex)}
                            onToggle={() => toggleToolExpand(currentIndex)}
                            onFix={(prompt) => {
                              setAgentInput(prompt);
                              agentInputRef.current?.focus();
                              agentInputRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                            }}
                          />
                        </motion.div>
                      );
                    }

                    case "tool_result":
                      return null;

                    case "file_changed": {
                      const hasDiff =
                        typeof (event as any).before === "string" &&
                        typeof (event as any).after === "string";
                      if (hasDiff) {
                        return (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <DiffView
                              before={(event as any).before ?? ""}
                              after={(event as any).after ?? ""}
                              path={event.path}
                              action={event.action}
                            />
                          </motion.div>
                        );
                      }
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-green-500/10 border border-green-500/20 text-xs"
                        >
                          <FileEdit className="w-3 h-3 text-green-400" />
                          <span className="text-green-400 font-medium">{event.action}</span>
                          <span className="text-foreground font-mono text-[11px]">{event.path}</span>
                        </motion.div>
                      );
                    }

                    case "preview_port":
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-xs"
                        >
                          <Globe className="w-3 h-3 text-blue-400" />
                          <span className="text-blue-400 font-medium">Live preview opened</span>
                          <span className="text-foreground font-mono text-[11px]">localhost:{(event as any).port}</span>
                        </motion.div>
                      );

                    case "preview_url":
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs"
                        >
                          <Globe className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400 font-medium">Deployed & live</span>
                          <a href={(event as any).url} target="_blank" rel="noopener noreferrer" className="text-emerald-300 font-mono text-[11px] underline hover:text-emerald-200">{(event as any).url}</a>
                        </motion.div>
                      );

                    case "message":
                      return (
                        <div key={i} className="flex gap-2 items-start">
                          <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Bot className="w-3 h-3 text-primary" />
                          </div>
                          <div className="flex-1 bg-muted/40 border border-border/50 rounded-lg px-3 py-2 text-foreground">
                            <MarkdownContent content={event.content} />
                          </div>
                        </div>
                      );

                    case "error":
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                          <Square className="w-3 h-3" />
                          {event.content}
                        </div>
                      );

                    default:
                      return null;
                  }
                })}
                {isAgentRunning && (
                  <div className="flex items-center gap-2 px-2 py-2 text-xs text-primary">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="animate-pulse">
                      {chatMode === "agent" ? "Agent is working..." : "Thinking..."}
                    </span>
                  </div>
                )}
                <div ref={agentBottomRef} />
              </div>
            )}
          </ScrollArea>

          <div
            className={cn("p-3 border-t border-border flex-shrink-0 relative", isDraggingFile && "ring-2 ring-primary ring-inset bg-primary/5")}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDraggingFile && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary/10 z-10 rounded-md border-2 border-dashed border-primary pointer-events-none">
                <div className="flex flex-col items-center gap-1 text-primary">
                  <Upload className="w-5 h-5" />
                  <span className="text-xs font-medium">Drop files here</span>
                  <span className="text-[10px] opacity-70">HAR, JSON, CSV, and more</span>
                </div>
              </div>
            )}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[10px] font-mono text-primary">
                    <Paperclip className="w-2.5 h-2.5" />
                    <span className="max-w-[120px] truncate">{f.name}</span>
                    <span className="text-[9px] opacity-60">({Math.round(f.content.length / 1024)}KB)</span>
                    <button
                      onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {attachedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="h-12 w-12 rounded border border-primary/30 object-cover"
                    />
                    <button
                      onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".har,.json,.csv,.xml,.yaml,.yml,.toml,.env,.txt,.html,.css,.js,.ts,.tsx,.jsx,.py,.rs,.go,.sh,.sql,.md,.log,.conf,.cfg,.ini"
                className="hidden"
                onChange={(e) => { handleFileAttach(e.target.files); e.target.value = ""; }}
              />
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => { handleFileAttach(e.target.files); e.target.value = ""; }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 flex-shrink-0 text-muted-foreground hover:text-primary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAgentRunning}
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach files (HAR, JSON, CSV...)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 flex-shrink-0 text-muted-foreground hover:text-primary"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={isAgentRunning}
                    data-testid="button-attach-image"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach image (or paste / drop)</TooltipContent>
              </Tooltip>
              <textarea
                ref={agentInputRef}
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                onPaste={handlePasteImage}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleRunAgent();
                  }
                }}
                placeholder={
                  chatMode === "agent"
                    ? (attachedFiles.length > 0 ? "Describe what to do with the attached files..." : "Tell Luxi what to build...")
                    : "Ask a question about your code..."
                }
                className="flex-1 resize-none text-xs bg-background border border-border rounded-md px-3 py-2 font-mono focus:outline-none focus:ring-1 focus:ring-primary min-h-[34px] max-h-[120px] text-foreground placeholder:text-muted-foreground"
                disabled={isAgentRunning}
                rows={1}
                data-testid="input-agent"
                style={{ height: "auto" }}
                onInput={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
              />
              <Button
                size="sm"
                onClick={isAgentRunning ? handleStopAgent : handleRunAgent}
                disabled={!isAgentRunning && !agentInput.trim()}
                className={cn("h-8 w-8 p-0 flex-shrink-0", isAgentRunning && "bg-destructive hover:bg-destructive/80")}
                data-testid="button-send-agent"
              >
                {isAgentRunning ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {chatMode === "agent" ? `${fileCount} files in project` : "Chat mode — no code changes"}
              {isAgentRunning && <span className="text-primary ml-1.5 animate-pulse">/ {chatMode === "agent" ? "agent running" : "thinking"}</span>}
            </p>
          </div>
        </Panel>
      </PanelGroup>

      <div className="h-6 flex items-center px-3 gap-4 border-t border-border bg-primary/5 text-[10px] text-muted-foreground font-mono flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-primary" />
          <span className="text-primary font-semibold">Luxi IDE</span>
        </div>
        <span>{project?.name}</span>
        {selectedFile && (
          <>
            <span className="opacity-40">/</span>
            <span>{selectedFile.path}</span>
            <span className="opacity-40">|</span>
            <span className={cn("px-1.5 py-0.5 rounded", getLanguageBadgeColor(editorLanguage))}>
              {editorLanguage}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span>{fileCount} files</span>
          {isAgentRunning && <span className="text-primary animate-pulse">Agent working...</span>}
        </div>
      </div>

      <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Input
              placeholder="e.g. index.ts, app.py, styles.css"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
              autoFocus
              className="font-mono"
              data-testid="input-file-name"
            />
            <p className="text-xs text-muted-foreground mt-2">Language will be detected from the file extension.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFileDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreateFile}
              disabled={!newFileName.trim() || createFile.isPending}
              data-testid="button-create-file"
            >
              {createFile.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will permanently delete <span className="font-mono text-foreground">{files?.find((f) => f.id === deleteConfirmId)?.name}</span>. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDeleteFile(deleteConfirmId)}
              disabled={deleteFile.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSSHSettings} onOpenChange={setShowSSHSettings}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              SSH Server Settings
              {sshConfigured && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Connected</span>}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Connect your server to auto-deploy and preview your projects live. Code is pushed to your server every time the agent builds something.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Host / IP</label>
                <Input
                  placeholder="192.168.1.1 or myserver.com"
                  value={sshForm.sshHost}
                  onChange={e => setSSHForm(f => ({ ...f, sshHost: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Port</label>
                <Input
                  placeholder="22"
                  value={sshForm.sshPort}
                  onChange={e => setSSHForm(f => ({ ...f, sshPort: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Username</label>
              <Input
                placeholder="root"
                value={sshForm.sshUser}
                onChange={e => setSSHForm(f => ({ ...f, sshUser: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Password (leave empty if using SSH key)</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={sshForm.sshPassword}
                onChange={e => setSSHForm(f => ({ ...f, sshPassword: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Shield className="w-3 h-3" /> SSH Private Key (optional)
                <button onClick={() => setSSHShowKey(!sshShowKey)} className="ml-auto text-primary text-[10px]">{sshShowKey ? "Hide" : "Show"}</button>
              </label>
              {sshShowKey && (
                <textarea
                  className="w-full h-24 bg-background border border-border rounded-md px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  value={sshForm.sshKey}
                  onChange={e => setSSHForm(f => ({ ...f, sshKey: e.target.value }))}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Remote Path</label>
                <Input
                  placeholder="/var/www/app"
                  value={sshForm.sshRemotePath}
                  onChange={e => setSSHForm(f => ({ ...f, sshRemotePath: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Domain / URL
                </label>
                <Input
                  placeholder="myapp.com or http://1.2.3.4:3000"
                  value={sshForm.sshDomain}
                  onChange={e => setSSHForm(f => ({ ...f, sshDomain: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Domain is used for the live preview URL. If empty, the host IP will be used.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSSHSettings(false)}>Cancel</Button>
            <Button onClick={saveSSHSettings} disabled={sshSaving || !sshForm.sshHost}>
              {sshSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Server className="w-4 h-4 mr-2" />}
              {sshSaving ? "Saving..." : "Save Connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CheckpointsDialog
        open={showCheckpoints}
        onOpenChange={setShowCheckpoints}
        projectId={projectId}
        onRestored={() => {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          isUserEditingRef.current = false;
        }}
      />
      <SecretsDialog open={showSecrets} onOpenChange={setShowSecrets} projectId={projectId} />
      <GitHubDialog
        open={showGitHub}
        onOpenChange={setShowGitHub}
        projectId={projectId}
        onCloned={() => {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
          isUserEditingRef.current = false;
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        files={(files ?? []).map((f) => ({ id: f.id, name: f.name, path: f.path, language: f.language }))}
        onOpenFile={(f) => openFileInTab(f.id)}
        actions={[
          { id: "new-file", label: "New file", icon: PaletteIcons.FilePlus, run: () => setShowNewFileDialog(true) },
          { id: "find-in-files", label: "Find in files", icon: Search, shortcut: "⌘⇧F", run: () => setFindOpen(true) },
          { id: "save-file", label: "Save current file", icon: PaletteIcons.Save, shortcut: "⌘S", run: () => flushSave(editorContent) },
          { id: "checkpoints", label: "Checkpoints", icon: PaletteIcons.History, run: () => setShowCheckpoints(true) },
          { id: "secrets", label: "Project secrets", icon: PaletteIcons.Lock, run: () => setShowSecrets(true) },
          { id: "github", label: "GitHub", icon: PaletteIcons.Github, run: () => setShowGitHub(true) },
          { id: "shortcuts", label: "Keyboard shortcuts", icon: PaletteIcons.Cog, run: () => setShowShortcuts(true) },
          { id: "preview", label: showPreview ? "Hide preview" : "Show preview", icon: PaletteIcons.Play, run: () => setShowPreview((s) => !s) },
          { id: "home", label: "Back to dashboard", icon: PaletteIcons.HomeIcon, run: () => setLocation("/") },
        ]}
      />
    </div>
  );
}
