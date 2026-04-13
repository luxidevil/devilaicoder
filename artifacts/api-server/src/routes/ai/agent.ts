import { Router, type IRouter } from "express";
import { db, filesTable, aiRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as pathLib from "path";
import {
  getActiveProvider,
  agentCall,
  type ToolDeclaration,
} from "../../lib/ai-providers";

const execAsync = promisify(exec);

const router: IRouter = Router();

const MAX_AGENT_ITERATIONS = 50;
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
    description: "Check if a service is running on a given port and return HTTP status.",
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
): Promise<{ result: string; fileChanged?: { path: string; action: string } }> {
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
        return { result: JSON.stringify({ status: resp.status === expectedStatus ? "PASS" : "FAIL", port, httpStatus: resp.status, expectedStatus, responseTimeMs: elapsed, bodyPreview: body.slice(0, 500) }, null, 2) };
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

    const systemPrompt = `You are Luxi — an elite autonomous AI coding agent, as powerful as the best AI coding assistants in the world. You build production-quality, visually stunning applications from scratch autonomously.

## ENVIRONMENT
All files exist on the REAL FILESYSTEM at ${projectDir}. Commands execute there. This is a full development environment.

CURRENT PROJECT FILES: ${fileList}

## TOOLS (22)
**Thinking**: think (USE THIS FIRST for complex tasks)
**File ops**: list_files, read_file, write_file, create_file, delete_file, edit_file, batch_write_files
**Search**: grep, search_files, find_and_replace, parse_file
**Execution**: run_command, install_package (3min timeout), manage_process, read_logs
**Web**: browse_website, web_search, download_file
**Testing**: check_port, test_api
**VCS**: git_operation

## WORKFLOW — Follow this EXACTLY for building apps:

### Step 1: THINK
Always start with the \`think\` tool to plan your architecture:
- What files are needed? What's the directory structure?
- What dependencies? What's the tech stack?
- Any edge cases or potential issues?

### Step 2: WRITE ALL FILES
Use \`batch_write_files\` to write multiple files in ONE call. This is MUCH faster.
Write COMPLETE files. Every. Single. Time. No placeholders, no TODOs, no "..." or "// rest of code".

### Step 3: INSTALL & RUN
- install_package for dependencies
- manage_process to start servers in background
- check_port to verify it's working

### Step 4: ITERATE
If something fails, read the error, fix the specific file, retry. You have ${MAX_AGENT_ITERATIONS} iterations.

## DESIGN STANDARDS — Make everything look INCREDIBLE:
- Modern CSS: gradients (linear-gradient), box-shadows, border-radius, smooth transitions (0.2-0.3s)
- Dark mode by default: rich backgrounds (#0f172a, #1e293b), accent colors (#3b82f6, #8b5cf6, #10b981)
- Typography: system font stack (-apple-system, BlinkMacSystemFont, 'Segoe UI', ...)
- Responsive: flexbox/grid, mobile-first, clamp() for fluid sizing
- Micro-interactions: hover scale(1.02), focus rings, loading skeletons, toast notifications
- Cards with subtle borders, shadows, hover states
- Form inputs: focus outlines, validation states, placeholder text
- Animations: @keyframes for loaders, fadeIn for content, smooth scrolling
- Professional color system: primary, secondary, accent, danger, success, muted
- Status indicators, badges, avatars, progress bars

## ARCHITECTURE PATTERNS:

### Node.js/Express (DEFAULT for most web apps):
\`\`\`
package.json → server.js → public/index.html + public/style.css + public/app.js
\`\`\`
- express.static("public"), cors(), express.json()
- bcryptjs for passwords, jsonwebtoken for auth tokens
- better-sqlite3 for database (sync, zero-config, fast)
- PORT = process.env.PORT || 3000

### Python/Flask:
\`\`\`
requirements.txt → app.py → templates/*.html + static/style.css + static/app.js
\`\`\`

### React (with Vite):
\`\`\`
package.json → vite.config.js → index.html → src/main.jsx → src/App.jsx → src/components/*.jsx
\`\`\`

### Static sites:
\`\`\`
index.html + style.css + script.js → npx serve .
\`\`\`

## ANTI-PATTERNS — NEVER do these:
- ❌ Writing partial files with "..." or "// remaining code here"
- ❌ Saying "I can't" or "I'm unable to" — you CAN do everything
- ❌ Installing packages without package.json first
- ❌ Starting a server without verifying it with check_port
- ❌ Using placeholder data when real implementation is needed
- ❌ Forgetting to handle errors in routes
- ❌ Skipping the think step for complex tasks
- ❌ Writing one file at a time when batch_write_files is available

## DEBUGGING PROTOCOL:
1. Read the FULL error message carefully
2. Use \`grep\` to find related code patterns
3. Use \`read_file\` to see the file with the error
4. Use \`edit_file\` for surgical fixes (not full rewrites)
5. Re-run and verify

## CRITICAL RULES:
1. NEVER give up. Fix errors and retry until it works.
2. ALWAYS write COMPLETE files — every line of code.
3. ALWAYS install dependencies before running.
4. ALWAYS verify servers with check_port after starting.
5. NEVER say "I can't" — you have every tool needed.
6. Use batch_write_files for multi-file creation.
7. Use grep for finding code patterns.
8. Use think for planning complex tasks.
9. Hash passwords, validate inputs, handle errors — always.
10. After install_package, new files auto-sync to the project.`;

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
          sendEvent({ type: "thinking", content: "Rate limited. Waiting..." });
          await new Promise(r => setTimeout(r, 5000));
          emptyResponseCount++;
          if (emptyResponseCount >= 3) { sendEvent({ type: "error", content: "Rate limited too many times." }); break; }
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

        const readOnlyTools = new Set(["think", "list_files", "read_file", "search_files", "grep", "check_port", "test_api", "read_logs", "browse_website", "web_search", "parse_file"]);
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
            const { result, fileChanged } = results[i];
            const compacted = compactToolResult(tc.name, result);

            sendEvent({
              type: "tool_result", id: callIds[i], tool: tc.name,
              result: compacted.length > 800 ? compacted.slice(0, 800) + "..." : compacted,
            });

            if (fileChanged) sendEvent({ type: "file_changed", ...fileChanged });
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
                  : tc.args;

            sendEvent({ type: "tool_call", id: callId, tool: tc.name, args: displayArgs });

            const { result, fileChanged } = await executeTool(tc.name, tc.args, projectId, projectDir);
            const compacted = compactToolResult(tc.name, result);

            sendEvent({
              type: "tool_result", id: callId, tool: tc.name,
              result: compacted.length > 800 ? compacted.slice(0, 800) + "..." : compacted,
            });

            if (fileChanged) sendEvent({ type: "file_changed", ...fileChanged });
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
