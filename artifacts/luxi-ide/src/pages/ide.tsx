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
} from "lucide-react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { TerminalPanel } from "@/components/terminal";

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
  | { type: "user"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; id: string; tool: string; args: Record<string, any> }
  | { type: "tool_result"; id: string; tool: string; result: string }
  | { type: "file_changed"; path: string; action: string }
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

function ToolCallCard({ tool, args, result, isExpanded, onToggle }: {
  tool: string;
  args: Record<string, any>;
  result?: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
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

  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
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
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const agentBottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const agentInputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<any>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [chatLoading, setChatLoading] = useState(true);
  const chatLoadRequestRef = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    setAgentEvents([]);
    setConversationId(null);
    setChatLoading(true);
    const requestId = ++chatLoadRequestRef.current;
    fetch(`/api/projects/${projectId}/conversations`)
      .then(r => r.json())
      .then((convos: any[]) => {
        if (requestId !== chatLoadRequestRef.current) return [];
        if (convos.length > 0) {
          const latest = convos[0];
          setConversationId(latest.id);
          return fetch(`/api/conversations/${latest.id}/messages`).then(r => r.json());
        }
        return [];
      })
      .then((msgs: any[]) => {
        if (requestId !== chatLoadRequestRef.current) return;
        if (msgs && msgs.length > 0) {
          const events: AgentEvent[] = [];
          for (const m of msgs) {
            if (m.role.startsWith("event:")) {
              try {
                events.push(JSON.parse(m.content) as AgentEvent);
              } catch {}
            } else {
              events.push({
                type: m.role === "user" ? "user" : "message",
                content: m.content,
              });
            }
          }
          setAgentEvents(events);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === chatLoadRequestRef.current) setChatLoading(false);
      });
  }, [projectId]);

  const saveMessageToDb = useCallback(async (convId: number, role: string, content: string) => {
    try {
      await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content }),
      });
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

  const selectedFile = files?.find((f) => f.id === selectedFileId);

  useEffect(() => {
    if (files && files.length > 0 && !selectedFileId) {
      setSelectedFileId(files[0].id);
    }
  }, [files, selectedFileId]);

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

  const handleFileAttach = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const maxSize = 5 * 1024 * 1024;
    Array.from(fileList).forEach((file) => {
      if (file.size > maxSize) {
        setAgentEvents((prev) => [...prev, { type: "error", content: `File "${file.name}" too large (max 5MB)` }]);
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
    setAttachedFiles([]);
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

    const displayContent = agentInput.trim() + (attachedFiles.length > 0 ? `\n📎 ${attachedFiles.map(f => f.name).join(", ")}` : "");
    const userEvent: AgentEvent = { type: "user", content: displayContent };
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
      <header className="h-10 flex items-center px-3 border-b border-border bg-card flex-shrink-0 gap-2">
        <Link href="/">
          <button className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" data-testid="button-back-home">
            <Home className="w-4 h-4" />
          </button>
        </Link>
        <div className="w-px h-4 bg-border" />
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="text-sm font-medium text-foreground truncate max-w-xs">
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
        <Panel defaultSize={16} minSize={12} maxSize={30} className="border-r border-border bg-card overflow-hidden flex flex-col">
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
                  <div
                    key={file.id}
                    className={cn(
                      "flex items-center justify-between px-3 py-1.5 group cursor-pointer hover:bg-muted/50 transition-colors",
                      selectedFileId === file.id && "bg-primary/10 border-r-2 border-primary"
                    )}
                    onClick={() => {
                      isUserEditingRef.current = false;
                      setSelectedFileId(file.id);
                    }}
                    data-testid={`file-item-${file.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <File className={cn("w-3.5 h-3.5 flex-shrink-0", selectedFileId === file.id ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-xs truncate font-mono", selectedFileId === file.id ? "text-foreground" : "text-muted-foreground")}>
                        {file.name}
                      </span>
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
                    {selectedFile ? (
                      <>
                        <div className="flex items-center h-9 px-3 border-b border-border bg-card gap-2 flex-shrink-0">
                          <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded", getLanguageBadgeColor(editorLanguage))}>
                            {editorLanguage}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">{selectedFile.path}</span>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <Editor
                            height="100%"
                            theme="vs-dark"
                            language={editorLanguage}
                            value={editorContent}
                            onChange={handleEditorChange}
                            onMount={(editor) => { editorRef.current = editor; }}
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
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center p-8">
                        <div>
                          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                            <File className="w-8 h-8 text-muted-foreground" />
                          </div>
                          <h3 className="text-sm font-medium text-muted-foreground mb-2">No file selected</h3>
                          <p className="text-xs text-muted-foreground/60 mb-4">Select a file from the sidebar or ask the agent to build something.</p>
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
                <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                  {chatMode === "agent" ? <Bot className="text-primary w-6 h-6" /> : <MessageCircle className="text-primary w-6 h-6" />}
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {chatMode === "agent" ? "Luxi Agent" : "Luxi Chat"}
                </p>
                <p className="text-xs text-muted-foreground mb-1">
                  {chatMode === "agent"
                    ? "I can read, write, and edit your code. Run commands. Build anything."
                    : "Ask me anything about code, architecture, or your project."}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
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
                      className="block w-full text-left text-xs px-3 py-1.5 rounded border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
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
                          <div className="flex-1 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-[13px] text-foreground">
                            {event.content}
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
                          />
                        </motion.div>
                      );
                    }

                    case "tool_result":
                      return null;

                    case "file_changed":
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
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".har,.json,.csv,.xml,.yaml,.yml,.toml,.env,.txt,.html,.css,.js,.ts,.tsx,.jsx,.py,.rs,.go,.sh,.sql,.md,.log,.conf,.cfg,.ini"
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
              <textarea
                ref={agentInputRef}
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
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
    </div>
  );
}
