import { Router, type IRouter } from "express";
import { db, filesTable, aiRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as pathLib from "path";
import { Client as SSHClient } from "ssh2";
import {
  getActiveProvider,
  agentCall,
  type ToolDeclaration,
} from "../../lib/ai-providers";

const execAsync = promisify(exec);

const router: IRouter = Router();

const MAX_AGENT_ITERATIONS = 200;
const CMD_TIMEOUT = 120_000;
const INSTALL_TIMEOUT = 180_000;
const PROJECTS_ROOT = pathLib.join(process.env.HOME || "/home/runner", "projects");

function getProjectDir(projectId: number): string {
  return pathLib.join(PROJECTS_ROOT, String(projectId));
}

async function ensureProjectDir(projectId: number): Promise<string> {
  const dir = getProjectDir(projectId);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

async function syncFileToDisk(projectDir: string, filePath: string, content: string): Promise<void> {
  const fullPath = pathLib.join(projectDir, filePath);
  await fsPromises.mkdir(pathLib.dirname(fullPath), { recursive: true });
  await fsPromises.writeFile(fullPath, content, "utf-8");
}

async function deleteFileFromDisk(projectDir: string, filePath: string): Promise<void> {
  const fullPath = pathLib.join(projectDir, filePath);
  try {
    await fsPromises.unlink(fullPath);
  } catch {}
}

async function syncAllFilesToDisk(projectId: number): Promise<string> {
  const projectDir = await ensureProjectDir(projectId);
  const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
  for (const file of files) {
    await syncFileToDisk(projectDir, file.path, file.content);
  }
  return projectDir;
}

async function readFileFromDisk(projectDir: string, filePath: string): Promise<string | null> {
  const fullPath = pathLib.join(projectDir, filePath);
  try {
    return await fsPromises.readFile(fullPath, "utf-8");
  } catch {
    return null;
  }
}

async function scanDiskForNewFiles(projectId: number, projectDir: string): Promise<void> {
  const dbFiles = await db.select({ path: filesTable.path }).from(filesTable).where(eq(filesTable.projectId, projectId));
  const dbPaths = new Set(dbFiles.map(f => f.path));

  async function walk(dir: string, prefix: string) {
    let entries;
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "__pycache__" || entry.name === ".next" || entry.name === "dist" || entry.name === "build" || entry.name === ".cache" || entry.name === "venv" || entry.name === ".venv") continue;
      if (entry.isDirectory()) {
        await walk(pathLib.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (!dbPaths.has(relPath)) {
          try {
            const stat = await fsPromises.stat(pathLib.join(dir, entry.name));
            if (stat.size > 500_000) continue;
            const content = await fsPromises.readFile(pathLib.join(dir, entry.name), "utf-8");
            const name = entry.name;
            const lang = getLanguageFromPath(relPath);
            await db.insert(filesTable).values({ projectId, name, path: relPath, content, language: lang });
          } catch {}
        }
      }
    }
  }

  await walk(projectDir, "");
}

const toolDeclarations: ToolDeclaration[] = [
  {
    name: "think",
    description: "Use this tool to think through complex problems step-by-step BEFORE taking action. Use it for: planning multi-file architectures, debugging complex errors, deciding between approaches, analyzing requirements. This tool has no side effects — it just records your thinking. ALWAYS use this before building anything complex.",
    parameters: {
      type: "OBJECT",
      properties: {
        thought: { type: "STRING", description: "Your detailed thinking, analysis, or plan" },
      },
      required: ["thought"],
    },
  },
  {
    name: "batch_write_files",
    description: "Write multiple files at once. MUCH faster than calling write_file repeatedly. Use this when creating a new project or making changes across multiple files. Each file gets written to both database and disk.",
    parameters: {
      type: "OBJECT",
      properties: {
        files: { type: "STRING", description: "JSON array of objects with 'path' and 'content' fields, e.g. [{\"path\":\"server.js\",\"content\":\"...\"}]" },
      },
      required: ["files"],
    },
  },
  {
    name: "grep",
    description: "Search file contents using grep (regex support). Much faster and more powerful than search_files for finding code patterns. Searches the real filesystem.",
    parameters: {
      type: "OBJECT",
      properties: {
        pattern: { type: "STRING", description: "Search pattern (regex supported)" },
        path: { type: "STRING", description: "Directory or file to search in (default: project root)" },
        include: { type: "STRING", description: "File glob pattern to include (e.g. '*.ts', '*.js')" },
        flags: { type: "STRING", description: "Additional grep flags (e.g. '-i' for case-insensitive, '-l' for files-only, '-c' for count)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_files",
    description: "List all files in the current project with their paths and languages",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "read_file",
    description: "Read the full contents of a file by its path. Can read both project files and any file on the filesystem.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to read (project-relative or absolute)" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file with new content. Creates the file if it doesn't exist. Writes to both the project database AND the filesystem so commands can access it. Always write COMPLETE file content — never partial.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to write (e.g. server.js, src/index.ts, public/index.html)" },
        content: { type: "STRING", description: "The COMPLETE file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file with the given name, path, and content. Writes to both database and filesystem.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "The file name (e.g. index.ts)" },
        path: { type: "STRING", description: "The file path (e.g. src/index.ts)" },
        content: { type: "STRING", description: "The initial file content" },
      },
      required: ["name", "path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file by its path from both database and filesystem",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to delete" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Search for files by name pattern or search file contents for a text pattern",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "Search query — matches against file name or content" },
      },
      required: ["query"],
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command in the project directory and return the output. All files you create are on disk here. Use for running tests, builds, starting servers, checking versions, etc. For package installs, prefer install_package.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "The shell command to execute" },
        timeout: { type: "NUMBER", description: "Optional timeout in milliseconds (default: 120000, max: 300000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "install_package",
    description: "Install packages using npm, pip, or any package manager. Has extended 3-minute timeout for large installs. Runs in the project directory. Always use this instead of run_command for package installations.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "The full install command, e.g. 'npm install express bcryptjs jsonwebtoken cors' or 'pip install flask'" },
      },
      required: ["command"],
    },
  },
  {
    name: "browse_website",
    description: "Fetch a website URL and return its content. Use for reading documentation, checking APIs, scraping data, or verifying deployments.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "The URL to fetch (must start with http:// or https://)" },
        method: { type: "STRING", description: "HTTP method: GET, POST, PUT, DELETE, PATCH, HEAD. Default: GET" },
        headers: { type: "STRING", description: "JSON string of custom headers, e.g. '{\"Authorization\": \"Bearer ...\"}'" },
        body: { type: "STRING", description: "Request body for POST/PUT/PATCH requests" },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description: "Search the web using a search query and return top results with titles, URLs, and snippets.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "The search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "git_operation",
    description: "Perform git operations in the project directory: clone, init, add, commit, push, pull, status, log, branch, checkout, diff, etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        operation: { type: "STRING", description: "Git operation: clone, init, add, commit, push, pull, status, log, branch, checkout, diff, remote, stash, merge, reset, fetch, tag" },
        args: { type: "STRING", description: "Arguments for the git operation" },
      },
      required: ["operation"],
    },
  },
  {
    name: "download_file",
    description: "Download a file from a URL and save it to the project directory.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "The URL to download from" },
        destination: { type: "STRING", description: "Local file path to save (relative to project directory)" },
      },
      required: ["url", "destination"],
    },
  },
  {
    name: "read_logs",
    description: "Read recent output from managed background processes or log files.",
    parameters: {
      type: "OBJECT",
      properties: {
        source: { type: "STRING", description: "Process name, log file path, or 'stdout' for all process output" },
        lines: { type: "NUMBER", description: "Number of lines to read (default: 50)" },
        filter: { type: "STRING", description: "Optional grep filter pattern" },
      },
      required: ["source"],
    },
  },
  {
    name: "manage_process",
    description: "Start, stop, or check the status of a background process (runs in project directory). Use for running dev servers, watch processes, etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "Action: start, stop, list, or status" },
        command: { type: "STRING", description: "Command to start (for 'start' action)" },
        name: { type: "STRING", description: "Process name/identifier" },
      },
      required: ["action"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing a specific text string with new text. More precise than write_file for small changes. Syncs to disk automatically.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to edit" },
        old_text: { type: "STRING", description: "The exact text to find and replace (must match exactly)" },
        new_text: { type: "STRING", description: "The replacement text" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "find_and_replace",
    description: "Find and replace text across all files using regex. Syncs changes to disk.",
    parameters: {
      type: "OBJECT",
      properties: {
        pattern: { type: "STRING", description: "Regex pattern to search for" },
        replacement: { type: "STRING", description: "Replacement text (can use $1, $2 for capture groups)" },
        file_pattern: { type: "STRING", description: "Optional glob pattern to filter files (e.g. '*.ts')" },
      },
      required: ["pattern", "replacement"],
    },
  },
  {
    name: "parse_file",
    description: "Parse structured files (HAR, JSON, CSV, XML, YAML, .env) and return contents in readable format.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Path to the file to parse" },
        format: { type: "STRING", description: "Format: har, json, csv, xml, yaml, toml, env, auto" },
        extract: { type: "STRING", description: "What to extract (for HAR: 'requests', 'responses', 'all', 'summary')" },
      },
      required: ["path"],
    },
  },
  {
    name: "check_port",
    description: "Check if a service is running on a given port and return HTTP status. If successful, the user's browser will automatically show a live preview.",
    parameters: {
      type: "OBJECT",
      properties: {
        port: { type: "NUMBER", description: "Port number to check" },
        path: { type: "STRING", description: "URL path (default: '/')" },
        method: { type: "STRING", description: "HTTP method (default: GET)" },
        expectedStatus: { type: "NUMBER", description: "Expected HTTP status (default: 200)" },
      },
      required: ["port"],
    },
  },
  {
    name: "test_api",
    description: "Full API testing — send HTTP requests and validate responses.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "Full URL to test" },
        method: { type: "STRING", description: "HTTP method (default: GET)" },
        headers: { type: "STRING", description: "JSON string of headers" },
        body: { type: "STRING", description: "Request body" },
        expect_status: { type: "NUMBER", description: "Expected status code (default: 200)" },
        expect_body_contains: { type: "STRING", description: "String that should appear in response" },
        expect_json_path: { type: "STRING", description: "JSON path to check, e.g. 'data.users.length'" },
      },
      required: ["url"],
    },
  },
  {
    name: "todowrite",
    description: "Create or update a task list to track your progress on complex requests. Shows the user what you're working on. ALWAYS use this at the start of multi-step tasks to show your plan, and update status as you complete each step. Statuses: pending, in_progress, done, error.",
    parameters: {
      type: "OBJECT",
      properties: {
        todos: { type: "STRING", description: "JSON array of todo objects: [{\"id\":\"1\",\"task\":\"Set up project structure\",\"status\":\"done\"},{\"id\":\"2\",\"task\":\"Install dependencies\",\"status\":\"in_progress\"}]. Statuses: pending, in_progress, done, error" },
      },
      required: ["todos"],
    },
  },
  {
    name: "project_memory",
    description: "Read or write persistent project notes that survive across conversations. Use this to remember architectural decisions, tech stack, key patterns, gotchas, and preferences. Read at the start of conversations to recall context. Write after making important decisions.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "read or write" },
        content: { type: "STRING", description: "Content to write (for write action). Markdown format recommended." },
      },
      required: ["action"],
    },
  },
  {
    name: "shell",
    description: "Execute multiple shell commands in sequence, stopping on first error. More powerful than run_command for multi-step operations. Each command runs in the project directory.",
    parameters: {
      type: "OBJECT",
      properties: {
        commands: { type: "STRING", description: "JSON array of commands to run in sequence, e.g. [\"mkdir -p src\",\"touch src/index.ts\",\"npm init -y\"]" },
        stop_on_error: { type: "BOOLEAN", description: "Stop on first error (default: true)" },
      },
      required: ["commands"],
    },
  },
  {
    name: "deploy_ssh",
    description: "Deploy the project to a remote server via SSH. Uploads project files and runs setup/deploy commands. The user must have configured their SSH credentials in project settings. Use this when the user says 'deploy', 'publish', 'push to server', etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        host: { type: "STRING", description: "SSH host (IP or domain)" },
        username: { type: "STRING", description: "SSH username (default: root)" },
        password: { type: "STRING", description: "SSH password" },
        privateKey: { type: "STRING", description: "SSH private key (alternative to password)" },
        port: { type: "NUMBER", description: "SSH port (default: 22)" },
        remotePath: { type: "STRING", description: "Remote directory to deploy to (default: /var/www/app)" },
        setupCommands: { type: "STRING", description: "JSON array of commands to run after upload, e.g. [\"npm install\", \"pm2 restart app\"]" },
      },
      required: ["host"],
    },
  },
];

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", css: "css", scss: "scss",
    html: "html", json: "json", md: "markdown", sh: "shell",
    yaml: "yaml", yml: "yaml", sql: "sql", toml: "toml",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", java: "java",
    kt: "kotlin", swift: "swift", rb: "ruby", php: "php",
    vue: "html", svelte: "html", xml: "xml",
    env: "ini", makefile: "makefile", dockerfile: "dockerfile",
    ejs: "html", hbs: "html", pug: "html", less: "css",
  };
  return map[ext] ?? "plaintext";
}

const managedProcesses = new Map<string, { proc: ReturnType<typeof spawn>; output: string[] }>();

function parseFileContent(
  content: string,
  filePath: string,
  format: string,
  extract: string
): { result: string; fileChanged?: { path: string; action: string } } {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const detectedFormat = format === "auto"
    ? (ext === "har" ? "har" : ext === "csv" ? "csv" : ext === "xml" || ext === "html" ? "xml"
      : ext === "yaml" || ext === "yml" ? "yaml" : ext === "toml" ? "toml"
      : ext === "env" ? "env" : "json")
    : format;

  try {
    if (detectedFormat === "har") {
      const har = JSON.parse(content);
      const entries = har.log?.entries ?? [];
      if (extract === "summary") {
        const methods: Record<string, number> = {};
        const statuses: Record<number, number> = {};
        const domains: Record<string, number> = {};
        for (const e of entries) {
          const req = e.request;
          methods[req.method] = (methods[req.method] || 0) + 1;
          statuses[e.response.status] = (statuses[e.response.status] || 0) + 1;
          try { const d = new URL(req.url).hostname; domains[d] = (domains[d] || 0) + 1; } catch {}
        }
        return {
          result: JSON.stringify({ totalRequests: entries.length, methods, statuses, domains, browser: har.log?.browser?.name }, null, 2),
        };
      }
      const parsed = entries.slice(0, 50).map((e: any, i: number) => {
        const req = e.request;
        const resp = e.response;
        const entry: any = {
          index: i, method: req.method, url: req.url, status: resp.status,
          time: `${Math.round(e.time)}ms`, mimeType: resp.content?.mimeType ?? "unknown",
        };
        if (extract === "all" || extract === "requests") {
          entry.requestHeaders = req.headers?.slice(0, 10)?.map((h: any) => `${h.name}: ${h.value}`);
          if (req.postData) entry.requestBody = req.postData.text?.slice(0, 2000);
          if (req.queryString?.length > 0) entry.queryParams = req.queryString.map((q: any) => `${q.name}=${q.value}`);
        }
        if (extract === "all" || extract === "responses") {
          if (resp.content?.text) entry.responseBody = resp.content.text.slice(0, 2000);
        }
        return entry;
      });
      return { result: JSON.stringify(parsed, null, 2) + (entries.length > 50 ? `\n(Showing 50 of ${entries.length})` : "") };
    }
    if (detectedFormat === "csv") {
      const lines = content.split("\n").filter(l => l.trim());
      const headers = lines[0]?.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1, 101).map(line => {
        const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        const row: Record<string, string> = {};
        headers?.forEach((h, i) => { row[h] = vals[i] ?? ""; });
        return row;
      });
      return { result: `Columns: ${headers?.join(", ")}\nRows: ${lines.length - 1}\n\n${JSON.stringify(rows, null, 2)}` };
    }
    if (detectedFormat === "env") {
      const vars = content.split("\n").filter(l => l.trim() && !l.startsWith("#")).map(l => {
        const eq = l.indexOf("=");
        return eq > 0 ? { key: l.slice(0, eq).trim(), value: l.slice(eq + 1).trim().replace(/^["']|["']$/g, "") } : null;
      }).filter(Boolean);
      return { result: JSON.stringify(vars, null, 2) };
    }
    if (detectedFormat === "json") {
      return { result: JSON.stringify(JSON.parse(content), null, 2).slice(0, 15000) };
    }
    return { result: content.slice(0, 15000) };
  } catch (err: any) {
    return { result: `Parse error: ${err.message}\n\nRaw (first 3000 chars):\n${content.slice(0, 3000)}` };
  }
}

function compactToolResult(toolName: string, result: string): string {
  if (result.length <= 12000) return result;

  if (toolName === "run_command" || toolName === "install_package") {
    const lines = result.split("\n");
    if (lines.length > 80) {
      const head = lines.slice(0, 20).join("\n");
      const tail = lines.slice(-40).join("\n");
      return `${head}\n\n... (${lines.length - 60} lines omitted) ...\n\n${tail}`;
    }
  }

  if (toolName === "read_file" || toolName === "browse_website") {
    return result.slice(0, 12000) + `\n\n... (truncated from ${result.length} chars)`;
  }

  return result.slice(0, 15000) + `\n...(truncated from ${result.length} chars)`;
}

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  projectId: number,
  projectDir: string
): Promise<{ result: string; fileChanged?: { path: string; action: string }; previewPort?: number }> {
  switch (toolName) {
    case "think": {
      return { result: "Thinking recorded. Continue with your plan." };
    }

    case "batch_write_files": {
      const filesStr = args.files as string;
      let fileList: { path: string; content: string }[];
      try {
        fileList = JSON.parse(filesStr);
      } catch (err: any) {
        return { result: `Error parsing files JSON: ${err.message}` };
      }
      if (!Array.isArray(fileList) || fileList.length === 0) {
        return { result: "Error: files must be a non-empty JSON array" };
      }

      const results: string[] = [];
      let lastChanged: { path: string; action: string } | undefined;

      for (const f of fileList) {
        if (!f.path || f.content === undefined) {
          results.push(`Skipped: missing path or content`);
          continue;
        }
        const filePath = f.path;
        const content = f.content;

        await syncFileToDisk(projectDir, filePath, content);

        const existing = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
        const ex = existing.find(e => e.path === filePath);

        if (ex) {
          await db.update(filesTable).set({ content, updatedAt: new Date() }).where(eq(filesTable.id, ex.id));
          results.push(`Updated ${filePath} (${content.length} chars)`);
        } else {
          const name = filePath.split("/").pop() ?? filePath;
          const lang = getLanguageFromPath(filePath);
          await db.insert(filesTable).values({ projectId, name, path: filePath, content, language: lang });
          results.push(`Created ${filePath} (${content.length} chars)`);
        }
        lastChanged = { path: filePath, action: ex ? "updated" : "created" };
      }

      return {
        result: `Batch wrote ${fileList.length} file(s):\n${results.join("\n")}`,
        fileChanged: lastChanged,
      };
    }

    case "grep": {
      const pattern = args.pattern as string;
      const searchPath = args.path ? pathLib.join(projectDir, args.path as string) : projectDir;
      const include = args.include as string || "";
      const flags = args.flags as string || "";
      try {
        let cmd = `grep -rn ${flags} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=dist --exclude-dir=.next --exclude-dir=.cache --exclude-dir=venv`;
        if (include) cmd += ` --include="${include}"`;
        cmd += ` "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -100`;

        const { stdout } = await execAsync(cmd, { timeout: 10_000, maxBuffer: 512 * 1024 });
        const output = stdout.trim();
        if (!output) return { result: `No matches for "${pattern}"` };
        const cleaned = output.replace(new RegExp(projectDir + "/", "g"), "");
        return { result: cleaned };
      } catch (err: any) {
        if (err.code === 1) return { result: `No matches for "${pattern}"` };
        return { result: `Grep error: ${(err.stderr || err.message || "").slice(0, 2000)}` };
      }
    }

    case "list_files": {
      const files = await db.select({
        id: filesTable.id, name: filesTable.name, path: filesTable.path, language: filesTable.language,
      }).from(filesTable).where(eq(filesTable.projectId, projectId));

      try {
        const { stdout } = await execAsync("find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/.cache/*' | head -200", {
          cwd: projectDir, timeout: 5000, maxBuffer: 256 * 1024,
        });
        const diskFiles = stdout.trim().split("\n").filter(Boolean).map(f => f.replace("./", ""));
        const dbPaths = new Set(files.map(f => f.path));
        const extraDisk = diskFiles.filter(f => !dbPaths.has(f));
        if (extraDisk.length > 0) {
          const combined = [
            ...files.map(f => ({ path: f.path, language: f.language, source: "project" })),
            ...extraDisk.map(f => ({ path: f, language: getLanguageFromPath(f), source: "disk-only" })),
          ];
          return { result: JSON.stringify(combined, null, 2) };
        }
      } catch {}

      if (files.length === 0) return { result: "No files in this project yet. Use write_file to create files." };
      return { result: JSON.stringify(files, null, 2) };
    }

    case "read_file": {
      const filePath = args.path as string;
      const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const file = files.find(f => f.path === filePath || f.name === filePath);

      if (file) return { result: file.content };

      const diskContent = await readFileFromDisk(projectDir, filePath);
      if (diskContent !== null) return { result: diskContent };

      if (filePath.startsWith("/")) {
        try {
          const absContent = await fsPromises.readFile(filePath, "utf-8");
          return { result: absContent.slice(0, 100000) };
        } catch {}
      }

      return { result: `Error: File "${filePath}" not found. Available: ${files.map(f => f.path).join(", ") || "none"}` };
    }

    case "write_file": {
      const filePath = args.path as string;
      const content = args.content as string;
      if (!content && content !== "") return { result: "Error: content is required" };

      const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const existing = files.find(f => f.path === filePath || f.name === filePath);

      await syncFileToDisk(projectDir, filePath, content);

      if (existing) {
        await db.update(filesTable).set({ content, updatedAt: new Date() }).where(eq(filesTable.id, existing.id));
        return { result: `Updated "${filePath}" (${content.length} chars) — saved to project + disk`, fileChanged: { path: filePath, action: "updated" } };
      } else {
        const name = filePath.split("/").pop() ?? filePath;
        const lang = getLanguageFromPath(filePath);
        await db.insert(filesTable).values({ projectId, name, path: filePath, content, language: lang });
        return { result: `Created "${filePath}" (${content.length} chars) — saved to project + disk`, fileChanged: { path: filePath, action: "created" } };
      }
    }

    case "create_file": {
      const name = args.name as string;
      const filePath = args.path as string;
      const content = args.content as string;

      await syncFileToDisk(projectDir, filePath, content);

      const existing = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const exists = existing.find(f => f.path === filePath);
      if (exists) {
        await db.update(filesTable).set({ content, updatedAt: new Date() }).where(eq(filesTable.id, exists.id));
        return { result: `Updated "${filePath}" (${content.length} chars)`, fileChanged: { path: filePath, action: "updated" } };
      }
      const lang = getLanguageFromPath(filePath);
      await db.insert(filesTable).values({ projectId, name, path: filePath, content, language: lang });
      return { result: `Created "${filePath}" (${content.length} chars)`, fileChanged: { path: filePath, action: "created" } };
    }

    case "delete_file": {
      const filePath = args.path as string;
      const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const file = files.find(f => f.path === filePath || f.name === filePath);
      if (!file) return { result: `Error: File "${filePath}" not found` };
      await db.delete(filesTable).where(eq(filesTable.id, file.id));
      await deleteFileFromDisk(projectDir, filePath);
      return { result: `Deleted "${filePath}"`, fileChanged: { path: filePath, action: "deleted" } };
    }

    case "search_files": {
      const query = (args.query as string).toLowerCase();
      const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const matches = files.filter(f =>
        f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query) || f.content.toLowerCase().includes(query)
      );
      if (matches.length === 0) return { result: `No files matching "${args.query}"` };
      const results = matches.map(f => {
        const lines = f.content.split("\n");
        const matchingLines = lines.map((l, i) => ({ line: i + 1, text: l })).filter(l => l.text.toLowerCase().includes(query)).slice(0, 5);
        return { path: f.path, matches: matchingLines.length, preview: matchingLines.map(l => `L${l.line}: ${l.text.trim()}`).join("\n") };
      });
      return { result: JSON.stringify(results, null, 2) };
    }

    case "run_command": {
      const command = args.command as string;
      const customTimeout = Math.min(Number(args.timeout) || CMD_TIMEOUT, 300_000);
      const blocked = ["rm -rf /", "rm -rf /*", ":(){ :|:& };:", "mkfs", "> /dev/sda", "shutdown", "reboot", "halt", "poweroff"];
      if (blocked.some(b => command.includes(b))) return { result: "Error: Command blocked for safety" };
      if (command.length > 8000) return { result: "Error: Command too long" };

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: customTimeout,
          maxBuffer: 4 * 1024 * 1024,
          cwd: projectDir,
          env: { ...process.env, NODE_ENV: "development", FORCE_COLOR: "0", HOME: process.env.HOME || "/home/runner", PATH: process.env.PATH },
        });
        const output = (stdout + (stderr ? "\nSTDERR:\n" + stderr : "")).trim();
        return { result: output || "(no output)" };
      } catch (err: any) {
        const output = (err.stdout || "") + (err.stderr ? "\nSTDERR:\n" + err.stderr : "");
        if (err.killed) return { result: `Command timed out after ${customTimeout / 1000}s. Output:\n${(output || "").slice(0, 6000)}` };
        return { result: `Exit ${err.code ?? "?"}: ${(output || err.message || "").slice(0, 6000)}` };
      }
    }

    case "install_package": {
      const command = args.command as string;
      if (!command) return { result: "Error: command is required" };

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: INSTALL_TIMEOUT,
          maxBuffer: 4 * 1024 * 1024,
          cwd: projectDir,
          env: { ...process.env, NODE_ENV: "development", FORCE_COLOR: "0", CI: "true", HOME: process.env.HOME || "/home/runner", PATH: process.env.PATH },
        });
        const output = (stdout + (stderr ? "\n" + stderr : "")).trim();
        const lines = output.split("\n");
        const relevantLines = lines.filter(l =>
          l.includes("added") || l.includes("removed") || l.includes("changed") ||
          l.includes("up to date") || l.includes("Successfully installed") ||
          l.includes("ERROR") || l.includes("error") || l.includes("WARN") ||
          l.includes("npm warn") || l.includes("packages in") || l.trim() === ""
        );
        const summary = relevantLines.length > 0 ? relevantLines.join("\n") : output.slice(-2000);

        await scanDiskForNewFiles(projectId, projectDir);

        return { result: summary || "Install completed successfully" };
      } catch (err: any) {
        const output = (err.stdout || "") + (err.stderr ? "\n" + err.stderr : "");
        return { result: `Install failed (exit ${err.code ?? "?"}): ${(output || err.message || "").slice(0, 6000)}` };
      }
    }

    case "browse_website": {
      const url = args.url as string;
      if (!url.startsWith("http://") && !url.startsWith("https://")) return { result: "Error: URL must start with http:// or https://" };
      try {
        const method = (args.method as string || "GET").toUpperCase();
        const customHeaders: Record<string, string> = {};
        if (args.headers) { try { Object.assign(customHeaders, JSON.parse(args.headers)); } catch { return { result: "Error: Invalid headers JSON" }; } }
        const fetchOpts: RequestInit = {
          method, headers: { "User-Agent": "Luxi-Agent/1.0", ...customHeaders }, redirect: "follow", signal: AbortSignal.timeout(15_000),
        };
        if (args.body && ["POST", "PUT", "PATCH"].includes(method)) {
          fetchOpts.body = args.body;
          if (!customHeaders["content-type"] && !customHeaders["Content-Type"]) (fetchOpts.headers as Record<string, string>)["Content-Type"] = "application/json";
        }
        const response = await fetch(url, fetchOpts);
        const contentType = response.headers.get("content-type") ?? "";
        let body: string;
        if (contentType.includes("json")) { body = JSON.stringify(await response.json(), null, 2); }
        else { body = await response.text(); }
        if (contentType.includes("html")) {
          body = body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
        }
        return { result: `Status: ${response.status}\nURL: ${response.url}\nContent-Type: ${contentType}\n\nBody (${body.length} chars):\n${body.slice(0, 15000)}` };
      } catch (err: any) {
        return { result: `Error fetching ${url}: ${err.message}` };
      }
    }

    case "web_search": {
      const query = args.query as string;
      try {
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          headers: { "User-Agent": "Luxi-Agent/1.0" }, signal: AbortSignal.timeout(10_000),
        });
        const html = await response.text();
        const results: { title: string; url: string; snippet: string }[] = [];
        const blocks = html.split(/class="result__body"/);
        for (let i = 1; i < Math.min(blocks.length, 11); i++) {
          const b = blocks[i];
          const titleMatch = b.match(/class="result__a"[^>]*>([^<]+)</);
          const urlMatch = b.match(/href="([^"]+)"/);
          const snippetMatch = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
          if (titleMatch && urlMatch) {
            let rUrl = urlMatch[1];
            if (rUrl.includes("uddg=")) { const d = decodeURIComponent(rUrl.split("uddg=")[1]?.split("&")[0] ?? ""); if (d) rUrl = d; }
            results.push({ title: titleMatch[1].replace(/<[^>]+>/g, "").trim(), url: rUrl, snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "" });
          }
        }
        if (results.length === 0) return { result: `No results for "${query}".` };
        return { result: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n") };
      } catch (err: any) {
        return { result: `Search error: ${err.message}` };
      }
    }

    case "git_operation": {
      const operation = args.operation as string;
      const gitArgs = args.args as string || "";
      const allowedOps = ["clone", "init", "add", "commit", "push", "pull", "status", "log", "branch", "checkout", "diff", "remote", "stash", "merge", "reset", "fetch", "tag", "show", "rev-parse", "config"];
      if (!allowedOps.includes(operation)) return { result: `Unsupported: "${operation}". Allowed: ${allowedOps.join(", ")}` };
      try {
        const { stdout, stderr } = await execAsync(`git ${operation}${gitArgs ? " " + gitArgs : ""}`, {
          timeout: 60_000, maxBuffer: 1024 * 1024, cwd: projectDir,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=no -o BatchMode=yes" },
        });
        return { result: (stdout + (stderr ? "\n" + stderr : "")).trim() || `git ${operation} completed` };
      } catch (err: any) {
        return { result: `Git error: ${((err.stdout || "") + (err.stderr || "") || err.message).slice(0, 4000)}` };
      }
    }

    case "download_file": {
      const url = args.url as string;
      const destination = args.destination as string;
      if (!url.startsWith("http://") && !url.startsWith("https://")) return { result: "Error: URL must start with http:// or https://" };
      try {
        const destPath = pathLib.join(projectDir, destination);
        await fsPromises.mkdir(pathLib.dirname(destPath), { recursive: true });
        const { stdout, stderr } = await execAsync(
          `curl -fsSL -o "${destPath}" "${url}" && echo "Downloaded ($(stat -c%s "${destPath}" 2>/dev/null || echo '?') bytes)"`,
          { timeout: 60_000, maxBuffer: 256 * 1024, cwd: projectDir }
        );
        return { result: (stdout + stderr).trim() || `Downloaded to ${destination}` };
      } catch (err: any) {
        return { result: `Download failed: ${(err.stderr || err.message || "").slice(0, 2000)}` };
      }
    }

    case "read_logs": {
      const source = args.source as string;
      const lines = (args.lines as number) || 50;
      const filter = args.filter as string || "";
      try {
        if (source === "stdout" || source === "stderr") {
          const procs = Array.from(managedProcesses.entries()).map(([name, p]) => ({ name, output: p.output.slice(-lines).join("\n") }));
          if (procs.length === 0) return { result: "No managed processes running" };
          return { result: procs.map(p => `=== ${p.name} ===\n${p.output}`).join("\n\n") };
        }
        const entry = managedProcesses.get(source);
        if (entry) {
          let output = entry.output.slice(-lines).join("\n");
          if (filter) output = output.split("\n").filter(l => l.toLowerCase().includes(filter.toLowerCase())).join("\n");
          return { result: output || "(no output)" };
        }
        let cmd = `tail -n ${Math.min(lines, 1000)} "${source}"`;
        if (filter) cmd += ` | grep -i "${filter.replace(/"/g, '\\"')}"`;
        const { stdout } = await execAsync(cmd, { timeout: 10_000, maxBuffer: 512 * 1024, cwd: projectDir });
        return { result: stdout.trim() || "(empty)" };
      } catch (err: any) {
        return { result: `Error: ${(err.stderr || err.message || "").slice(0, 2000)}` };
      }
    }

    case "manage_process": {
      const action = args.action as string;
      switch (action) {
        case "start": {
          const command = args.command as string;
          const name = args.name as string || `proc_${Date.now()}`;
          if (!command) return { result: "Error: command required" };
          if (managedProcesses.has(name)) {
            const ex = managedProcesses.get(name)!;
            try { ex.proc.kill(); } catch {}
            managedProcesses.delete(name);
          }
          const proc = spawn("sh", ["-c", command], {
            cwd: projectDir,
            env: { ...process.env, NODE_ENV: "development", HOME: process.env.HOME || "/home/runner", PATH: process.env.PATH },
            stdio: ["ignore", "pipe", "pipe"], detached: false,
          });
          const output: string[] = [];
          proc.stdout?.on("data", data => { const l = data.toString().split("\n"); output.push(...l); if (output.length > 500) output.splice(0, output.length - 500); });
          proc.stderr?.on("data", data => { const l = data.toString().split("\n"); output.push(...l.map((s: string) => `[stderr] ${s}`)); if (output.length > 500) output.splice(0, output.length - 500); });
          proc.on("exit", code => { output.push(`[Process exited: ${code}]`); });
          managedProcesses.set(name, { proc, output });
          await new Promise(r => setTimeout(r, 2000));
          return { result: `"${name}" started (PID ${proc.pid}): ${command}\n\n${output.slice(-15).join("\n") || "(starting...)"}` };
        }
        case "stop": {
          const name = args.name as string;
          if (!name) return { result: "Error: name required" };
          const entry = managedProcesses.get(name);
          if (!entry) return { result: `No process "${name}"` };
          try { entry.proc.kill("SIGTERM"); } catch {}
          managedProcesses.delete(name);
          return { result: `"${name}" stopped` };
        }
        case "list": {
          const procs = Array.from(managedProcesses.entries()).map(([name, p]) => ({ name, pid: p.proc.pid, alive: !p.proc.killed, lastOutput: p.output.slice(-3).join(" | ") }));
          return { result: procs.length > 0 ? JSON.stringify(procs, null, 2) : "No managed processes" };
        }
        case "status": {
          const name = args.name as string;
          if (!name) return { result: "Error: name required" };
          const entry = managedProcesses.get(name);
          if (!entry) return { result: `No process "${name}"` };
          return { result: JSON.stringify({ name, pid: entry.proc.pid, alive: !entry.proc.killed, recentOutput: entry.output.slice(-20).join("\n") }, null, 2) };
        }
        default: return { result: `Unknown action: ${action}. Use: start, stop, list, status` };
      }
    }

    case "edit_file": {
      const filePath = args.path as string;
      const oldText = args.old_text as string;
      const newText = args.new_text as string;
      const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const file = files.find(f => f.path === filePath || f.name === filePath);
      if (!file) return { result: `Error: File "${filePath}" not found` };

      let fileContent = file.content;
      let matched = false;

      if (fileContent.includes(oldText)) {
        fileContent = fileContent.replace(oldText, newText);
        matched = true;
      } else {
        const nc = fileContent.replace(/\r\n/g, "\n");
        const no = oldText.replace(/\r\n/g, "\n");
        if (nc.includes(no)) { fileContent = nc.replace(no, newText); matched = true; }
        else {
          const tc = nc.split("\n").map(l => l.trimEnd()).join("\n");
          const to = no.split("\n").map(l => l.trimEnd()).join("\n");
          if (tc.includes(to)) { fileContent = tc.replace(to, newText); matched = true; }
        }
      }

      if (!matched) {
        return { result: `Error: Text not found in "${filePath}". Make sure old_text matches exactly.\n\nFile preview:\n${file.content.slice(0, 800)}` };
      }

      await db.update(filesTable).set({ content: fileContent, updatedAt: new Date() }).where(eq(filesTable.id, file.id));
      await syncFileToDisk(projectDir, filePath, fileContent);
      return { result: `Edited "${filePath}" successfully`, fileChanged: { path: filePath, action: "updated" } };
    }

    case "find_and_replace": {
      const pattern = args.pattern as string;
      const replacement = args.replacement as string;
      const filePattern = args.file_pattern as string || "";
      try {
        const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
        const regex = new RegExp(pattern, "g");
        const results: { path: string; count: number }[] = [];
        for (const file of files) {
          if (filePattern) { const ext = filePattern.replace("*", "").replace(".", ""); if (ext && !file.path.endsWith(ext)) continue; }
          const matches = file.content.match(regex);
          if (matches && matches.length > 0) {
            const newContent = file.content.replace(regex, replacement);
            await db.update(filesTable).set({ content: newContent, updatedAt: new Date() }).where(eq(filesTable.id, file.id));
            await syncFileToDisk(projectDir, file.path, newContent);
            results.push({ path: file.path, count: matches.length });
          }
        }
        if (results.length === 0) return { result: `No matches for "${pattern}"` };
        const total = results.reduce((s, r) => s + r.count, 0);
        return { result: `Replaced ${total} match(es) in ${results.length} file(s):\n${results.map(r => `  ${r.path}: ${r.count}`).join("\n")}`, fileChanged: { path: results[0].path, action: "updated" } };
      } catch (err: any) {
        return { result: `Regex error: ${err.message}` };
      }
    }

    case "parse_file": {
      const filePath = args.path as string;
      const format = (args.format as string) || "auto";
      const extract = (args.extract as string) || "all";
      try {
        const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
        const file = files.find(f => f.path === filePath || f.name === filePath);
        if (file) return parseFileContent(file.content, filePath, format, extract);
        const diskContent = await readFileFromDisk(projectDir, filePath);
        if (diskContent !== null) return parseFileContent(diskContent, filePath, format, extract);
        if (filePath.startsWith("/")) {
          try { const c = await fsPromises.readFile(filePath, "utf-8"); return parseFileContent(c, filePath, format, extract); } catch {}
        }
        return { result: `Error: File "${filePath}" not found` };
      } catch (err: any) {
        return { result: `Parse error: ${err.message}` };
      }
    }

    case "check_port": {
      const port = args.port as number;
      const urlPath = (args.path as string) || "/";
      const method = (args.method as string) || "GET";
      const expectedStatus = (args.expectedStatus as number) || 200;
      try {
        const start = Date.now();
        const resp = await fetch(`http://localhost:${port}${urlPath}`, { method, signal: AbortSignal.timeout(5000) });
        const elapsed = Date.now() - start;
        const body = await resp.text().catch(() => "");
        const passed = resp.status === expectedStatus;
        return {
          result: JSON.stringify({ status: passed ? "PASS" : "FAIL", port, httpStatus: resp.status, expectedStatus, responseTimeMs: elapsed, bodyPreview: body.slice(0, 500) }, null, 2),
          previewPort: passed ? port : undefined,
        };
      } catch (err: any) {
        return { result: JSON.stringify({ status: "FAIL", port, error: err.name === "AbortError" ? "Timed out (5s)" : err.message, hint: "Service not running. Start it with manage_process." }, null, 2) };
      }
    }

    case "test_api": {
      const url = args.url as string;
      const method = (args.method as string) || "GET";
      const expectStatus = (args.expect_status as number) || 200;
      const expectBody = args.expect_body_contains as string;
      const expectJson = args.expect_json_path as string;
      let headers: Record<string, string> = {};
      if (args.headers) { try { headers = JSON.parse(args.headers as string); } catch {} }
      try {
        const start = Date.now();
        const resp = await fetch(url, { method, headers, body: args.body || undefined, signal: AbortSignal.timeout(15000) });
        const elapsed = Date.now() - start;
        const body = await resp.text().catch(() => "");
        const tests: { name: string; pass: boolean; detail: string }[] = [
          { name: "Status", pass: resp.status === expectStatus, detail: `Expected ${expectStatus}, got ${resp.status}` },
        ];
        if (expectBody) tests.push({ name: "Body", pass: body.includes(expectBody), detail: body.includes(expectBody) ? `Found "${expectBody}"` : `Not found` });
        if (expectJson) {
          try {
            const json = JSON.parse(body);
            let val: any = json;
            for (const p of expectJson.split(".")) val = val?.[p];
            tests.push({ name: `JSON ${expectJson}`, pass: val != null, detail: `Value: ${JSON.stringify(val)}` });
          } catch { tests.push({ name: `JSON ${expectJson}`, pass: false, detail: "Not valid JSON" }); }
        }
        return { result: JSON.stringify({ overall: tests.every(t => t.pass) ? "ALL PASSED" : "SOME FAILED", url, method, responseTimeMs: elapsed, httpStatus: resp.status, tests, bodyPreview: body.slice(0, 1000) }, null, 2) };
      } catch (err: any) {
        return { result: JSON.stringify({ overall: "FAILED", url, error: err.name === "AbortError" ? "Timed out (15s)" : err.message }, null, 2) };
      }
    }

    case "todowrite": {
      const todosStr = args.todos as string;
      try {
        const todos = JSON.parse(todosStr) as { id: string; task: string; status: string }[];
        const formatted = todos.map(t => {
          const icon = t.status === "done" ? "✓" : t.status === "in_progress" ? "→" : t.status === "error" ? "✗" : "○";
          return `${icon} [${t.id}] ${t.task} (${t.status})`;
        }).join("\n");
        return { result: `Todo list updated:\n${formatted}` };
      } catch (err: any) {
        return { result: `Error parsing todos JSON: ${err.message}` };
      }
    }

    case "project_memory": {
      const action = args.action as string;
      const memoryPath = pathLib.join(projectDir, ".luxi", "memory.md");
      if (action === "read") {
        try {
          await fsPromises.mkdir(pathLib.dirname(memoryPath), { recursive: true });
          const content = await fsPromises.readFile(memoryPath, "utf-8");
          return { result: content || "(empty memory)" };
        } catch {
          return { result: "(no memory file yet — use write to create one)" };
        }
      } else if (action === "write") {
        const content = args.content as string;
        if (!content) return { result: "Error: content is required for write action" };
        try {
          await fsPromises.mkdir(pathLib.dirname(memoryPath), { recursive: true });
          await fsPromises.writeFile(memoryPath, content, "utf-8");
          return { result: `Memory saved (${content.length} chars)` };
        } catch (err: any) {
          return { result: `Error writing memory: ${err.message}` };
        }
      }
      return { result: "Error: action must be 'read' or 'write'" };
    }

    case "shell": {
      const commandsStr = args.commands as string;
      const stopOnError = args.stop_on_error !== false;
      let commands: string[];
      try {
        commands = JSON.parse(commandsStr);
      } catch {
        commands = [commandsStr];
      }
      if (!Array.isArray(commands) || commands.length === 0) {
        return { result: "Error: commands must be a non-empty JSON array of strings" };
      }

      const results: string[] = [];
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const blocked = ["rm -rf /", "rm -rf /*", ":(){ :|:& };:", "mkfs", "> /dev/sda", "shutdown", "reboot"];
        if (blocked.some(b => cmd.includes(b))) {
          results.push(`[${i + 1}] $ ${cmd}\nBlocked for safety`);
          if (stopOnError) break;
          continue;
        }
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            timeout: CMD_TIMEOUT,
            maxBuffer: 4 * 1024 * 1024,
            cwd: projectDir,
            env: { ...process.env, NODE_ENV: "development", FORCE_COLOR: "0", HOME: process.env.HOME || "/home/runner", PATH: process.env.PATH },
          });
          const output = (stdout + (stderr ? "\n" + stderr : "")).trim();
          results.push(`[${i + 1}] $ ${cmd}\n${output || "(ok)"}`);
        } catch (err: any) {
          const output = (err.stdout || "") + (err.stderr ? "\n" + err.stderr : "");
          results.push(`[${i + 1}] $ ${cmd}\nExit ${err.code ?? "?"}: ${(output || err.message || "").slice(0, 3000)}`);
          if (stopOnError) break;
        }
      }
      return { result: results.join("\n\n") };
    }

    case "deploy_ssh": {
      const host = args.host as string;
      const username = (args.username as string) || "root";
      const password = args.password as string || undefined;
      const privateKey = args.privateKey as string || undefined;
      const sshPort = (args.port as number) || 22;
      const remotePath = (args.remotePath as string) || "/var/www/app";
      let setupCommands: string[] = [];
      if (args.setupCommands) {
        try { setupCommands = JSON.parse(args.setupCommands as string); } catch { setupCommands = [args.setupCommands as string]; }
      }

      if (!password && !privateKey) {
        return { result: "Error: Either password or privateKey is required for SSH authentication" };
      }

      const sshExec = (conn: InstanceType<typeof SSHClient>, cmd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
        return new Promise((resolve, reject) => {
          conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer) => { stdout += data.toString(); });
            stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
            stream.on("close", (code: number) => { resolve({ stdout, stderr, code }); });
          });
        });
      };

      try {
        const conn = new SSHClient();
        await new Promise<void>((resolve, reject) => {
          conn.on("ready", () => resolve());
          conn.on("error", (err) => reject(err));
          const config: any = { host, port: sshPort, username, readyTimeout: 15000 };
          if (privateKey) config.privateKey = privateKey;
          else config.password = password;
          conn.connect(config);
        });

        const results: string[] = [];

        await sshExec(conn, `mkdir -p ${remotePath}`);
        results.push(`Created remote directory: ${remotePath}`);

        const tarName = `deploy_${Date.now()}.tar.gz`;
        const localTar = pathLib.join(projectDir, `../${tarName}`);
        await execAsync(
          `tar czf "${localTar}" --exclude=node_modules --exclude=.git --exclude=__pycache__ --exclude=dist --exclude=venv --exclude=.next -C "${projectDir}" .`,
          { timeout: 30_000 }
        );

        const tarStat = await fsPromises.stat(localTar);
        results.push(`Created archive: ${(tarStat.size / 1024).toFixed(0)}KB`);

        await new Promise<void>((resolve, reject) => {
          conn.sftp((err, sftp) => {
            if (err) return reject(err);
            const readStream = fs.createReadStream(localTar);
            const writeStream = sftp.createWriteStream(`${remotePath}/${tarName}`);
            writeStream.on("close", () => resolve());
            writeStream.on("error", (e: Error) => reject(e));
            readStream.pipe(writeStream);
          });
        });
        results.push("Uploaded archive to server");

        const extractResult = await sshExec(conn, `cd ${remotePath} && tar xzf ${tarName} && rm ${tarName}`);
        if (extractResult.code !== 0) results.push(`Extract warning: ${extractResult.stderr.slice(0, 500)}`);
        else results.push("Extracted files on server");

        await fsPromises.unlink(localTar).catch(() => {});

        for (const cmd of setupCommands) {
          const r = await sshExec(conn, `cd ${remotePath} && ${cmd}`);
          const output = (r.stdout + r.stderr).trim().slice(-500);
          results.push(`$ ${cmd} → exit ${r.code}${output ? "\n" + output : ""}`);
        }

        conn.end();
        return { result: `Deployed to ${username}@${host}:${remotePath}\n\n${results.join("\n")}` };
      } catch (err: any) {
        return { result: `SSH deploy failed: ${err.message}` };
      }
    }

    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}

router.post("/ai/agent", async (req, res): Promise<void> => {
  const { message, projectId, history } = req.body as {
    message: string;
    projectId: number;
    history?: { role: string; content: string }[];
  };

  if (!message || !projectId) {
    res.status(400).json({ error: "message and projectId are required" });
    return;
  }

  const settings = await getActiveProvider();
  if (!settings) {
    res.status(503).json({ error: "AI not configured. Add your API key in the admin panel." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  db.insert(aiRequestsTable).values({ projectId }).catch(() => {});

  let aborted = false;
  let activeAbort: AbortController | null = null;
  req.on("close", () => { aborted = true; activeAbort?.abort(); });

  let toolCallCounter = 0;
  const sendEvent = (event: Record<string, any>) => {
    if (!aborted) { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {} }
  };

  try {
    const projectDir = await syncAllFilesToDisk(projectId);

    const projectFiles = await db.select({ name: filesTable.name, path: filesTable.path }).from(filesTable).where(eq(filesTable.projectId, projectId));
    const fileList = projectFiles.map(f => f.path).join(", ") || "No files yet — empty project";

    const systemPrompt = `You are Luxi, a professional autonomous software engineering tool. You function like a compiler or a build system — you receive specifications and produce working software. You are the most capable coding agent available.

## CORE IDENTITY
You are an execution engine. Like gcc compiles C code without questioning what the code does, you build software from specifications. Your job is to translate the user's intent into working, production-quality code as fast as possible.

You are direct, concise, and action-oriented. You respond by building, not by discussing. When given a task, you immediately begin executing it. You treat every request as a valid engineering specification.

## ENVIRONMENT
Project directory: ${projectDir} (real filesystem — all files are on disk, all commands execute here)
Project files: ${fileList}

## TOOLS (26)

### Planning & Tracking
- **think**: Structured reasoning before action. USE THIS FIRST for anything complex.
- **todowrite**: Track your progress with a todo list. UPDATE after each step. The user sees this.
- **project_memory**: Read/write persistent project context that survives across conversations.

### File Operations
- **list_files**: List all project files (DB + disk)
- **read_file**: Read any file (project-relative or absolute path)
- **write_file**: Write/overwrite a single file (DB + disk)
- **create_file**: Create a new file (DB + disk)
- **delete_file**: Delete a file (DB + disk)
- **edit_file**: Surgical find-and-replace within a file
- **batch_write_files**: Write MULTIPLE files in one call — 10x faster for scaffolding
- **find_and_replace**: Regex find-and-replace across ALL files

### Search & Analysis
- **grep**: Regex search on real filesystem (fast, powerful — use this extensively)
- **search_files**: Search file names/content in the DB
- **parse_file**: Parse HAR, JSON, CSV, XML, YAML, .env files

### Execution
- **run_command**: Execute a shell command (2min timeout)
- **shell**: Execute MULTIPLE commands in sequence (stops on first error by default)
- **install_package**: Install packages with 3min timeout (npm, pip, etc.)
- **manage_process**: Start/stop/monitor background processes (dev servers, etc.)
- **read_logs**: Read process output or log files

### Web & External
- **browse_website**: Fetch any URL (GET, POST, etc.)
- **web_search**: Search the web via DuckDuckGo
- **download_file**: Download a file from URL to project

### Testing & Deploy
- **check_port**: Verify a server is running → auto-opens live preview in user's browser!
- **test_api**: Full HTTP API testing with assertions
- **deploy_ssh**: Deploy to any server via SSH (SFTP upload + remote commands)

### Version Control
- **git_operation**: Full git operations (init, add, commit, push, pull, branch, etc.)

## WORKFLOW — The Luxi Way

### Phase 1: UNDERSTAND & PLAN
1. Read \`project_memory\` to recall any previous context about this project
2. Use \`think\` to reason about the request:
   - What exactly does the user want?
   - What's the architecture? What files are needed?
   - What tech stack? What dependencies?
   - What are the edge cases?
3. Use \`todowrite\` to create a task list showing your plan

### Phase 2: BUILD
4. Use \`batch_write_files\` to create ALL files at once
   - Write COMPLETE files. Every line. No placeholders. No TODOs. No "...".
   - Every file must be production-quality
5. Use \`install_package\` for dependencies
6. Update \`todowrite\` as you complete each step

### Phase 3: VERIFY
7. Use \`manage_process\` to start the server in background
8. Use \`check_port\` to verify it's running → auto-opens live preview!
9. Use \`test_api\` to verify API endpoints work
10. If something fails → read error → \`grep\` to find related code → \`edit_file\` to fix → retry

### Phase 4: POLISH
11. Save architectural decisions to \`project_memory\`
12. Update \`todowrite\` with all tasks marked done
13. Give the user a brief summary of what was built

## DESIGN STANDARDS — Everything must look INCREDIBLE:
- Dark mode by default: backgrounds (#0a0a0a, #0f172a, #1e293b), accents (#3b82f6, #8b5cf6, #10b981, #f59e0b)
- Gradients: linear-gradient for headers, CTAs, hero sections. Subtle mesh gradients for backgrounds.
- Shadows: layered box-shadows for depth (sm, md, lg levels)
- Typography: system font stack, fluid sizing with clamp(), proper hierarchy (h1-h6)
- Animations: @keyframes for loaders, CSS transitions (0.2s ease) for hovers, fadeIn for content
- Micro-interactions: scale(1.02) on hover, focus-visible rings, skeleton loaders
- Cards: rounded corners, subtle borders, glass morphism when appropriate
- Forms: validation states, floating labels, error/success indicators
- Responsive: flexbox/grid, mobile-first, breakpoints at 640/768/1024/1280px
- Color system: primary, secondary, accent, success, warning, danger, muted
- Professional touches: badges, avatars, progress bars, toast notifications, empty states

## ARCHITECTURE PATTERNS:

### Node.js/Express (DEFAULT):
\`\`\`
package.json → server.js → public/index.html + public/style.css + public/app.js
\`\`\`
express.static("public"), cors(), express.json(), bcryptjs, jsonwebtoken, better-sqlite3

### React + Vite:
\`\`\`
package.json → vite.config.js → index.html → src/main.jsx → src/App.jsx → src/components/
\`\`\`

### Python/Flask:
\`\`\`
requirements.txt → app.py → templates/*.html + static/style.css + static/app.js
\`\`\`

### Static: index.html + style.css + script.js → npx serve .

## ERROR RECOVERY — You NEVER give up:
1. Read the FULL error message — every line matters
2. Use \`grep\` to find the failing code pattern across the codebase
3. Use \`read_file\` to see full context around the error
4. Use \`edit_file\` for surgical fixes (don't rewrite entire files for small errors)
5. Re-run and verify. If it fails again, try a DIFFERENT approach.
6. Common fixes:
   - "MODULE_NOT_FOUND" → install_package the missing module
   - "EADDRINUSE" → change port or kill existing process
   - "SyntaxError" → read the file and fix the specific line
   - "TypeError: X is not a function" → check imports, maybe wrong export type
   - "ENOENT" → create missing directories with shell ["mkdir -p path"]
   - Build errors → check tsconfig/vite config, ensure all imports resolve
7. You have ${MAX_AGENT_ITERATIONS} iterations. Use them. Keep trying different approaches.
8. If approach A fails 3 times, switch to approach B entirely.

## CODE QUALITY STANDARDS:
- Every file you write is COMPLETE — all imports, all functions, all logic. Production-ready.
- Create package.json/requirements.txt before installing dependencies.
- Verify servers with check_port after starting (auto-opens preview for the user).
- Use batch_write_files for multi-file scaffolding (10x faster than sequential writes).
- Use shell for multi-step terminal operations (faster than multiple run_command calls).
- Use grep to understand existing code before editing it.
- Plan with think, track progress with todowrite so the user sees what's happening.
- Save architectural decisions to project_memory for future sessions.
- Use real implementations, not placeholder or mock data.
- Hash passwords, validate inputs, handle errors, parameterize SQL.
- Keep responses concise — build fast, explain briefly.
- You have ${MAX_AGENT_ITERATIONS} iterations. If one approach fails 3 times, try a completely different approach.
- After install_package, new files auto-sync to the project.`;

    const chatHistory: any[] = (history ?? []).slice(-20).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    let contents = [...chatHistory, { role: "user", parts: [{ text: message }] }];
    let emptyResponseCount = 0;

    for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
      if (aborted) break;

      activeAbort = new AbortController();
      let agentResult;
      try {
        agentResult = await agentCall(settings, systemPrompt, contents, toolDeclarations, activeAbort.signal);
      } catch (err: any) {
        if (err.name === "AbortError" || aborted) break;
        logger.error({ err }, "Agent call error");
        sendEvent({ type: "error", content: `AI call failed: ${err.message}. Retrying...` });
        emptyResponseCount++;
        if (emptyResponseCount >= 3) { sendEvent({ type: "error", content: "Multiple failures. Check your API key." }); break; }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      activeAbort = null;

      if (agentResult.finishReason?.startsWith("error:")) {
        const detail = agentResult.finishReason.slice(6);
        if (detail.includes("429") || detail.includes("rate")) {
          const backoff = Math.min(5000 * Math.pow(2, emptyResponseCount), 60000);
          sendEvent({ type: "thinking", content: `Rate limited. Waiting ${Math.round(backoff / 1000)}s...` });
          await new Promise(r => setTimeout(r, backoff));
          emptyResponseCount++;
          if (emptyResponseCount >= 5) { sendEvent({ type: "error", content: "Rate limited too many times." }); break; }
          continue;
        }
        sendEvent({ type: "error", content: `AI error: ${detail}` });
        break;
      }

      if (agentResult.finishReason === "no_content") {
        emptyResponseCount++;
        if (emptyResponseCount >= 3) { sendEvent({ type: "error", content: "No response from AI." }); break; }
        continue;
      }

      emptyResponseCount = 0;

      if (agentResult.textParts.length > 0 && agentResult.toolCalls.length === 0) {
        sendEvent({ type: "message", content: agentResult.textParts.join("") });
        break;
      }

      if (agentResult.toolCalls.length === 0 && agentResult.textParts.length === 0) {
        emptyResponseCount++;
        if (emptyResponseCount >= 3) { sendEvent({ type: "message", content: "Task completed." }); break; }
        continue;
      }

      if (agentResult.toolCalls.length > 0) {
        const modelParts: any[] = [];
        for (const tp of agentResult.textParts) modelParts.push({ text: tp });
        for (const tc of agentResult.toolCalls) modelParts.push({ functionCall: { name: tc.name, args: tc.args } });
        contents.push({ role: "model", parts: modelParts });

        if (agentResult.textParts.length > 0) sendEvent({ type: "thinking", content: agentResult.textParts.join("") });

        const functionResponses: any[] = [];

        const readOnlyTools = new Set(["think", "todowrite", "list_files", "read_file", "search_files", "grep", "check_port", "test_api", "read_logs", "browse_website", "web_search", "parse_file", "project_memory"]);
        const canParallelize = agentResult.toolCalls.length > 1 && agentResult.toolCalls.every(tc => readOnlyTools.has(tc.name));

        if (canParallelize) {
          const callIds = agentResult.toolCalls.map(() => `tc_${toolCallCounter++}`);
          for (let i = 0; i < agentResult.toolCalls.length; i++) {
            const tc = agentResult.toolCalls[i];
            sendEvent({
              type: "tool_call", id: callIds[i], tool: tc.name,
              args: tc.name === "think" ? { thought: "(thinking...)" } : tc.args,
            });
          }

          const results = await Promise.all(
            agentResult.toolCalls.map(tc => executeTool(tc.name, tc.args, projectId, projectDir))
          );

          for (let i = 0; i < results.length; i++) {
            const tc = agentResult.toolCalls[i];
            const { result, fileChanged, previewPort } = results[i];
            const compacted = compactToolResult(tc.name, result);

            sendEvent({
              type: "tool_result", id: callIds[i], tool: tc.name,
              result: compacted.length > 800 ? compacted.slice(0, 800) + "..." : compacted,
            });

            if (fileChanged) sendEvent({ type: "file_changed", ...fileChanged });
            if (previewPort) sendEvent({ type: "preview_port", port: previewPort });
            functionResponses.push({ functionResponse: { name: tc.name, response: { result: compacted } } });
          }
        } else {
          for (const tc of agentResult.toolCalls) {
            if (aborted) break;
            const callId = `tc_${toolCallCounter++}`;

            const displayArgs = (tc.name === "write_file" || tc.name === "create_file")
              ? { ...tc.args, content: `(${(tc.args.content?.length ?? 0)} chars)` }
              : tc.name === "batch_write_files"
                ? { files: `(batch of files)` }
                : tc.name === "think"
                  ? { thought: "(thinking...)" }
                  : tc.name === "deploy_ssh"
                    ? { host: tc.args.host, remotePath: tc.args.remotePath || "/var/www/app" }
                    : tc.name === "todowrite"
                      ? { todos: "(task list)" }
                      : tc.name === "project_memory"
                        ? { action: tc.args.action }
                        : tc.name === "shell"
                          ? (() => { try { const cmds = JSON.parse(tc.args.commands); return { commands: `(${cmds.length} commands)` }; } catch { return tc.args; } })()
                          : tc.args;

            sendEvent({ type: "tool_call", id: callId, tool: tc.name, args: displayArgs });

            const { result, fileChanged, previewPort } = await executeTool(tc.name, tc.args, projectId, projectDir);
            const compacted = compactToolResult(tc.name, result);

            sendEvent({
              type: "tool_result", id: callId, tool: tc.name,
              result: compacted.length > 800 ? compacted.slice(0, 800) + "..." : compacted,
            });

            if (fileChanged) sendEvent({ type: "file_changed", ...fileChanged });
            if (previewPort) sendEvent({ type: "preview_port", port: previewPort });
            functionResponses.push({ functionResponse: { name: tc.name, response: { result: compacted } } });
          }
        }

        contents.push({ role: "user", parts: functionResponses });

        if (contents.length > 40) {
          const systemParts = contents.slice(0, 2);
          const recentParts = contents.slice(-30);
          const droppedCount = contents.length - 32;
          const compressionNote = { role: "user", parts: [{ text: `[Context: ${droppedCount} earlier conversation turns were compressed to save memory. Key context is preserved in recent messages.]` }] };
          contents = [...systemParts, compressionNote, ...recentParts];
        }
      }

      if ((agentResult.finishReason === "STOP" || agentResult.finishReason === "end_turn" || agentResult.finishReason === "stop") && agentResult.toolCalls.length === 0) break;
    }

    await scanDiskForNewFiles(projectId, projectDir);
    sendEvent({ type: "done" });
    res.end();
  } catch (err: any) {
    if (!aborted) {
      logger.error({ err }, "Agent error");
      sendEvent({ type: "error", content: "Agent error: " + (err.message ?? "unknown") });
      sendEvent({ type: "done" });
      res.end();
    }
  }
});

export default router;
