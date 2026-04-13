import { Router, type IRouter } from "express";
import { db, filesTable, aiRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import {
  getActiveProvider,
  agentCall,
  type ToolDeclaration,
} from "../../lib/ai-providers";

const execAsync = promisify(exec);

const router: IRouter = Router();

const MAX_AGENT_ITERATIONS = 40;
const CMD_TIMEOUT = 30_000;

const toolDeclarations: ToolDeclaration[] = [
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
    description: "Read the full contents of a file by its path",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file with new content. Creates the file if it doesn't exist.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to write" },
        content: { type: "STRING", description: "The full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "create_file",
    description: "Create a new file with the given name, path, and content",
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
    description: "Delete a file by its path",
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
    description: "Execute a shell command and return the output. Use for installing packages, running tests, git operations, building projects, starting servers, etc. Commands run in the user's home directory.",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "The shell command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "browse_website",
    description: "Fetch a website URL and return its text content, HTML structure, title, status code, and headers. Use for debugging websites, reading documentation, checking APIs, scraping data, or verifying deployments.",
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
    description: "Search the web using a search query and return top results with titles, URLs, and snippets. Use for finding documentation, troubleshooting errors, finding libraries, looking up API references, etc.",
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
    description: "Perform git operations: clone, init, add, commit, push, pull, status, log, branch, checkout, diff, remote, stash. Use for version control, cloning repositories, pushing changes, etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        operation: { type: "STRING", description: "Git operation: clone, init, add, commit, push, pull, status, log, branch, checkout, diff, remote, stash, merge, reset, fetch, tag" },
        args: { type: "STRING", description: "Arguments for the git operation (e.g. repo URL for clone, commit message for commit, branch name for checkout)" },
        cwd: { type: "STRING", description: "Working directory for the git command (defaults to home)" },
      },
      required: ["operation"],
    },
  },
  {
    name: "download_file",
    description: "Download a file from a URL and save it to disk. Use for fetching remote assets, downloading packages, getting configuration files from GitHub, etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "The URL to download from" },
        destination: { type: "STRING", description: "Local file path to save the download (relative to home directory)" },
      },
      required: ["url", "destination"],
    },
  },
  {
    name: "read_logs",
    description: "Read the last N lines from a log file or from the output of a running process. Use for debugging server issues, checking error logs, monitoring application output.",
    parameters: {
      type: "OBJECT",
      properties: {
        source: { type: "STRING", description: "Log file path, or 'stdout'/'stderr' to read recent process output" },
        lines: { type: "NUMBER", description: "Number of lines to read from the end (default: 50)" },
        filter: { type: "STRING", description: "Optional grep filter pattern to search logs" },
      },
      required: ["source"],
    },
  },
  {
    name: "manage_process",
    description: "Start, stop, or check the status of a background process. Use for running dev servers, watch processes, database servers, etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "Action: start, stop, list, or status" },
        command: { type: "STRING", description: "Command to start (for 'start' action)" },
        name: { type: "STRING", description: "Process name/identifier (for start/stop/status)" },
      },
      required: ["action"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing a specific text string with new text. More precise than write_file — only changes the targeted section without rewriting the entire file. Use for small, targeted edits.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "The file path to edit" },
        old_text: { type: "STRING", description: "The exact text to find and replace (must match exactly, including whitespace)" },
        new_text: { type: "STRING", description: "The replacement text" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "find_and_replace",
    description: "Find and replace text across all files in the project using regex. Use for renaming variables, updating imports, bulk refactoring across multiple files.",
    parameters: {
      type: "OBJECT",
      properties: {
        pattern: { type: "STRING", description: "Regex pattern to search for" },
        replacement: { type: "STRING", description: "Replacement text (can use $1, $2 for capture groups)" },
        file_pattern: { type: "STRING", description: "Optional glob pattern to filter files (e.g. '*.ts', 'src/**/*.js')" },
      },
      required: ["pattern", "replacement"],
    },
  },
  {
    name: "parse_file",
    description: "Parse a structured file (HAR, JSON, CSV, XML, YAML, TOML, .env) and return its contents in a readable format. Especially useful for HAR files — extracts all HTTP requests with URLs, methods, headers, request bodies, response status, and response bodies. Use when the user provides a HAR file, data file, or any structured format that needs analysis.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: { type: "STRING", description: "Path to the file to parse" },
        format: { type: "STRING", description: "File format: har, json, csv, xml, yaml, toml, env, auto (default: auto-detect from extension)" },
        extract: { type: "STRING", description: "What to extract (for HAR: 'requests', 'responses', 'all', 'summary'). Default: 'all'" },
      },
      required: ["path"],
    },
  },
  {
    name: "check_port",
    description: "Check if a service is running on a given port. Returns whether the port is open, the HTTP status code, response time, and a snippet of the response body. Use to verify dev servers started successfully, check API health, confirm deployments.",
    parameters: {
      type: "OBJECT",
      properties: {
        port: { type: "NUMBER", description: "Port number to check (e.g. 3000, 8080)" },
        path: { type: "STRING", description: "URL path to request (default: '/')" },
        method: { type: "STRING", description: "HTTP method (default: GET)" },
        expectedStatus: { type: "NUMBER", description: "Expected HTTP status code (default: 200). Tool reports success/failure based on this." },
      },
      required: ["port"],
    },
  },
  {
    name: "test_api",
    description: "Send an HTTP request and validate the response — like a built-in API tester / Postman. Send requests with custom headers, body, and validate status code, response body content, response time. Use after building APIs to verify they work correctly.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: { type: "STRING", description: "Full URL to test (e.g. http://localhost:3000/api/users)" },
        method: { type: "STRING", description: "HTTP method: GET, POST, PUT, DELETE, PATCH (default: GET)" },
        headers: { type: "STRING", description: "JSON string of headers, e.g. '{\"Content-Type\": \"application/json\"}'" },
        body: { type: "STRING", description: "Request body (for POST/PUT/PATCH)" },
        expect_status: { type: "NUMBER", description: "Expected status code — reports PASS/FAIL (default: 200)" },
        expect_body_contains: { type: "STRING", description: "String that should appear in the response body — reports PASS/FAIL" },
        expect_json_path: { type: "STRING", description: "JSON path to check in response, e.g. 'data.users.length'. Reports the value found." },
      },
      required: ["url"],
    },
  },
];

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", css: "css", scss: "scss",
    html: "html", json: "json", md: "markdown", sh: "shell",
    yaml: "yaml", yml: "yaml", sql: "sql", toml: "toml",
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
          try {
            const d = new URL(req.url).hostname;
            domains[d] = (domains[d] || 0) + 1;
          } catch {}
        }
        return {
          result: JSON.stringify({
            totalRequests: entries.length,
            methods,
            statuses,
            domains,
            browser: har.log?.browser?.name,
            version: har.log?.version,
          }, null, 2),
        };
      }
      const parsed = entries.slice(0, 50).map((e: any, i: number) => {
        const req = e.request;
        const resp = e.response;
        const entry: any = {
          index: i,
          method: req.method,
          url: req.url,
          status: resp.status,
          statusText: resp.statusText,
          time: `${Math.round(e.time)}ms`,
          responseSize: resp.content?.size ?? 0,
          mimeType: resp.content?.mimeType ?? "unknown",
        };
        if (extract === "all" || extract === "requests") {
          entry.requestHeaders = req.headers?.slice(0, 10)?.map((h: any) => `${h.name}: ${h.value}`);
          if (req.postData) {
            entry.requestBody = req.postData.text?.slice(0, 2000) ?? req.postData.mimeType;
          }
          if (req.queryString?.length > 0) {
            entry.queryParams = req.queryString.map((q: any) => `${q.name}=${q.value}`);
          }
        }
        if (extract === "all" || extract === "responses") {
          entry.responseHeaders = resp.headers?.slice(0, 10)?.map((h: any) => `${h.name}: ${h.value}`);
          if (resp.content?.text) {
            entry.responseBody = resp.content.text.slice(0, 2000);
          }
        }
        return entry;
      });
      const totalNote = entries.length > 50 ? `\n(Showing first 50 of ${entries.length} entries)` : "";
      return { result: JSON.stringify(parsed, null, 2) + totalNote };
    }

    if (detectedFormat === "csv") {
      const lines = content.split("\n").filter((l) => l.trim());
      const headers = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1, 101).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const row: Record<string, string> = {};
        headers?.forEach((h, i) => { row[h] = vals[i] ?? ""; });
        return row;
      });
      const totalNote = lines.length > 101 ? `\n(Showing first 100 of ${lines.length - 1} rows)` : "";
      return {
        result: `Columns: ${headers?.join(", ")}\nRow count: ${lines.length - 1}\n\n${JSON.stringify(rows, null, 2)}${totalNote}`,
      };
    }

    if (detectedFormat === "env") {
      const vars = content.split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .map((l) => {
          const eq = l.indexOf("=");
          return eq > 0 ? { key: l.slice(0, eq).trim(), value: l.slice(eq + 1).trim().replace(/^["']|["']$/g, "") } : null;
        })
        .filter(Boolean);
      return { result: JSON.stringify(vars, null, 2) };
    }

    if (detectedFormat === "json") {
      const parsed = JSON.parse(content);
      return { result: JSON.stringify(parsed, null, 2).slice(0, 15000) };
    }

    return { result: content.slice(0, 15000) };
  } catch (err: any) {
    return { result: `Parse error for ${detectedFormat}: ${err.message}\n\nRaw content (first 3000 chars):\n${content.slice(0, 3000)}` };
  }
}

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  projectId: number
): Promise<{ result: string; fileChanged?: { path: string; action: string } }> {
  switch (toolName) {
    case "list_files": {
      const files = await db.select({
        id: filesTable.id,
        name: filesTable.name,
        path: filesTable.path,
        language: filesTable.language,
      }).from(filesTable).where(eq(filesTable.projectId, projectId));
      return { result: JSON.stringify(files, null, 2) };
    }

    case "read_file": {
      const path = args.path as string;
      const files = await db.select().from(filesTable)
        .where(eq(filesTable.projectId, projectId));
      const file = files.find((f) => f.path === path || f.name === path);
      if (!file) return { result: `Error: File "${path}" not found in project` };
      return { result: file.content };
    }

    case "write_file": {
      const path = args.path as string;
      const content = args.content as string;
      const files = await db.select().from(filesTable)
        .where(eq(filesTable.projectId, projectId));
      const existing = files.find((f) => f.path === path || f.name === path);

      if (existing) {
        await db.update(filesTable)
          .set({ content, updatedAt: new Date() })
          .where(eq(filesTable.id, existing.id));
        return {
          result: `File "${path}" updated successfully (${content.length} chars)`,
          fileChanged: { path, action: "updated" },
        };
      } else {
        const name = path.split("/").pop() ?? path;
        const lang = getLanguageFromPath(path);
        await db.insert(filesTable).values({ projectId, name, path, content, language: lang });
        return {
          result: `File "${path}" created successfully (${content.length} chars)`,
          fileChanged: { path, action: "created" },
        };
      }
    }

    case "create_file": {
      const name = args.name as string;
      const path = args.path as string;
      const content = args.content as string;
      const lang = getLanguageFromPath(path);

      const existing = await db.select().from(filesTable)
        .where(eq(filesTable.projectId, projectId));
      const exists = existing.find((f) => f.path === path);
      if (exists) {
        await db.update(filesTable)
          .set({ content, updatedAt: new Date() })
          .where(eq(filesTable.id, exists.id));
        return {
          result: `File "${path}" already existed — updated with new content`,
          fileChanged: { path, action: "updated" },
        };
      }

      await db.insert(filesTable).values({ projectId, name, path, content, language: lang });
      return {
        result: `File "${path}" created (${content.length} chars)`,
        fileChanged: { path, action: "created" },
      };
    }

    case "delete_file": {
      const path = args.path as string;
      const files = await db.select().from(filesTable)
        .where(eq(filesTable.projectId, projectId));
      const file = files.find((f) => f.path === path || f.name === path);
      if (!file) return { result: `Error: File "${path}" not found` };
      await db.delete(filesTable).where(eq(filesTable.id, file.id));
      return {
        result: `File "${path}" deleted`,
        fileChanged: { path, action: "deleted" },
      };
    }

    case "search_files": {
      const query = (args.query as string).toLowerCase();
      const files = await db.select().from(filesTable)
        .where(eq(filesTable.projectId, projectId));
      const matches = files.filter(
        (f) => f.name.toLowerCase().includes(query) ||
               f.path.toLowerCase().includes(query) ||
               f.content.toLowerCase().includes(query)
      );
      if (matches.length === 0) return { result: `No files matching "${args.query}"` };
      const results = matches.map((f) => {
        const lines = f.content.split("\n");
        const matchingLines = lines
          .map((l, i) => ({ line: i + 1, text: l }))
          .filter((l) => l.text.toLowerCase().includes(query))
          .slice(0, 5);
        return {
          path: f.path,
          matches: matchingLines.length,
          preview: matchingLines.map((l) => `L${l.line}: ${l.text.trim()}`).join("\n"),
        };
      });
      return { result: JSON.stringify(results, null, 2) };
    }

    case "run_command": {
      const command = args.command as string;
      const blocked = [
        "rm -rf /", "rm -rf /*", "rm -rf ~", "rm -rf $HOME",
        ":(){ :|:& };:", "mkfs", "dd if=", "chmod -R 777 /",
        "shutdown", "reboot", "halt", "poweroff",
        "> /dev/sda",
      ];
      if (blocked.some((b) => command.includes(b))) {
        return { result: "Error: Command blocked for safety" };
      }
      if (command.length > 4000) {
        return { result: "Error: Command too long (max 4000 chars)" };
      }
      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: CMD_TIMEOUT,
          maxBuffer: 1024 * 1024,
          cwd: process.env.HOME || "/home/runner",
          env: { ...process.env, NODE_ENV: "development" },
        });
        const output = (stdout + (stderr ? "\nSTDERR:\n" + stderr : "")).trim();
        return { result: output || "(no output)" };
      } catch (err: any) {
        const output = (err.stdout || "") + (err.stderr ? "\nSTDERR:\n" + err.stderr : "");
        return {
          result: `Command failed (exit ${err.code ?? "?"}): ${(output || err.message || "").slice(0, 4000)}`,
        };
      }
    }

    case "browse_website": {
      const url = args.url as string;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return { result: "Error: URL must start with http:// or https://" };
      }
      try {
        const method = (args.method as string || "GET").toUpperCase();
        const customHeaders: Record<string, string> = {};
        if (args.headers) {
          try {
            Object.assign(customHeaders, JSON.parse(args.headers));
          } catch {
            return { result: "Error: Invalid headers JSON" };
          }
        }

        const fetchOpts: RequestInit = {
          method,
          headers: {
            "User-Agent": "Luxi-Agent/1.0 (Web Fetcher)",
            ...customHeaders,
          },
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        };

        if (args.body && ["POST", "PUT", "PATCH"].includes(method)) {
          fetchOpts.body = args.body;
          if (!customHeaders["content-type"] && !customHeaders["Content-Type"]) {
            (fetchOpts.headers as Record<string, string>)["Content-Type"] = "application/json";
          }
        }

        const response = await fetch(url, fetchOpts);
        const contentType = response.headers.get("content-type") ?? "";
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((val, key) => { responseHeaders[key] = val; });

        let body: string;
        if (contentType.includes("json")) {
          const json = await response.json();
          body = JSON.stringify(json, null, 2);
        } else {
          body = await response.text();
        }

        if (contentType.includes("html")) {
          body = body
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
        }

        const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : null;

        const result = [
          `Status: ${response.status} ${response.statusText}`,
          `URL: ${response.url}`,
          title ? `Title: ${title}` : null,
          `Content-Type: ${contentType}`,
          `Headers: ${JSON.stringify(responseHeaders, null, 2)}`,
          `\nBody (${body.length} chars):\n${body.slice(0, 15000)}`,
          body.length > 15000 ? "\n...(truncated)" : "",
        ].filter(Boolean).join("\n");

        return { result };
      } catch (err: any) {
        return { result: `Error fetching ${url}: ${err.message}` };
      }
    }

    case "web_search": {
      const query = args.query as string;
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": "Luxi-Agent/1.0",
          },
          signal: AbortSignal.timeout(10_000),
        });
        const html = await response.text();

        const results: { title: string; url: string; snippet: string }[] = [];
        const resultBlocks = html.split(/class="result__body"/);

        for (let i = 1; i < Math.min(resultBlocks.length, 11); i++) {
          const block = resultBlocks[i];
          const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
          const urlMatch = block.match(/href="([^"]+)"/);
          const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

          if (titleMatch && urlMatch) {
            let url = urlMatch[1];
            if (url.includes("uddg=")) {
              const decoded = decodeURIComponent(url.split("uddg=")[1]?.split("&")[0] ?? "");
              if (decoded) url = decoded;
            }
            results.push({
              title: titleMatch[1].replace(/<[^>]+>/g, "").trim(),
              url,
              snippet: snippetMatch
                ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
                : "",
            });
          }
        }

        if (results.length === 0) {
          return { result: `No search results found for "${query}". Try different keywords.` };
        }

        const formatted = results.map((r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
        ).join("\n\n");

        return { result: `Search results for "${query}":\n\n${formatted}` };
      } catch (err: any) {
        return { result: `Search error: ${err.message}. Try using browse_website to visit a documentation URL directly.` };
      }
    }

    case "git_operation": {
      const operation = args.operation as string;
      const gitArgs = args.args as string || "";
      const cwd = args.cwd as string || process.env.HOME || "/home/runner";

      const allowedOps = [
        "clone", "init", "add", "commit", "push", "pull", "status", "log",
        "branch", "checkout", "diff", "remote", "stash", "merge", "reset",
        "fetch", "tag", "show", "rev-parse", "config",
      ];

      if (!allowedOps.includes(operation)) {
        return { result: `Error: Unsupported git operation "${operation}". Allowed: ${allowedOps.join(", ")}` };
      }

      let fullCmd = `git ${operation}`;
      if (gitArgs) fullCmd += ` ${gitArgs}`;

      try {
        const { stdout, stderr } = await execAsync(fullCmd, {
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          cwd,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=no -o BatchMode=yes",
          },
        });
        const output = (stdout + (stderr ? "\n" + stderr : "")).trim();
        return { result: output || `git ${operation} completed successfully` };
      } catch (err: any) {
        const output = (err.stdout || "") + (err.stderr ? "\n" + err.stderr : "");
        return { result: `Git error: ${(output || err.message || "").slice(0, 4000)}` };
      }
    }

    case "download_file": {
      const url = args.url as string;
      const destination = args.destination as string;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return { result: "Error: URL must start with http:// or https://" };
      }
      try {
        const home = process.env.HOME || "/home/runner";
        const destPath = destination.startsWith("/") ? destination : `${home}/${destination}`;

        const mkdirCmd = `mkdir -p "$(dirname "${destPath}")"`;
        await execAsync(mkdirCmd, { timeout: 5000 });

        const { stdout, stderr } = await execAsync(
          `curl -fsSL -o "${destPath}" "${url}" && echo "Downloaded to ${destPath} ($(stat -c%s "${destPath}" 2>/dev/null || echo 'unknown') bytes)"`,
          { timeout: 60_000, maxBuffer: 1024 * 256, cwd: home }
        );
        return { result: (stdout + stderr).trim() || `Downloaded ${url} to ${destPath}` };
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
          const procs = Array.from(managedProcesses.entries()).map(([name, p]) => ({
            name,
            output: p.output.slice(-lines).join("\n"),
          }));
          if (procs.length === 0) return { result: "No managed processes running" };
          return {
            result: procs.map((p) => `=== ${p.name} ===\n${p.output}`).join("\n\n"),
          };
        }

        let cmd = `tail -n ${Math.min(lines, 1000)} "${source}"`;
        if (filter) {
          cmd += ` | grep -i "${filter.replace(/"/g, '\\"')}"`;
        }

        const { stdout } = await execAsync(cmd, {
          timeout: 10_000,
          maxBuffer: 1024 * 512,
          cwd: process.env.HOME || "/home/runner",
        });
        return { result: stdout.trim() || "(empty log)" };
      } catch (err: any) {
        return { result: `Error reading logs: ${(err.stderr || err.message || "").slice(0, 2000)}` };
      }
    }

    case "manage_process": {
      const action = args.action as string;

      switch (action) {
        case "start": {
          const command = args.command as string;
          const name = args.name as string || `proc_${Date.now()}`;
          if (!command) return { result: "Error: command required for start action" };

          if (managedProcesses.has(name)) {
            const existing = managedProcesses.get(name)!;
            try { existing.proc.kill(); } catch {}
            managedProcesses.delete(name);
          }

          const proc = spawn("sh", ["-c", command], {
            cwd: process.env.HOME || "/home/runner",
            env: { ...process.env, NODE_ENV: "development" },
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
          });

          const output: string[] = [];
          proc.stdout?.on("data", (data) => {
            const lines = data.toString().split("\n");
            output.push(...lines);
            if (output.length > 500) output.splice(0, output.length - 500);
          });
          proc.stderr?.on("data", (data) => {
            const lines = data.toString().split("\n");
            output.push(...lines.map((l: string) => `[stderr] ${l}`));
            if (output.length > 500) output.splice(0, output.length - 500);
          });
          proc.on("exit", (code) => {
            output.push(`\n[Process exited with code ${code}]`);
          });

          managedProcesses.set(name, { proc, output });
          return { result: `Process "${name}" started (PID: ${proc.pid}): ${command}` };
        }

        case "stop": {
          const name = args.name as string;
          if (!name) return { result: "Error: name required for stop action" };
          const entry = managedProcesses.get(name);
          if (!entry) return { result: `No process found with name "${name}"` };
          try { entry.proc.kill("SIGTERM"); } catch {}
          managedProcesses.delete(name);
          return { result: `Process "${name}" stopped` };
        }

        case "list": {
          const procs = Array.from(managedProcesses.entries()).map(([name, p]) => ({
            name,
            pid: p.proc.pid,
            alive: !p.proc.killed,
            lastOutput: p.output.slice(-3).join(" | "),
          }));
          return { result: procs.length > 0 ? JSON.stringify(procs, null, 2) : "No managed processes" };
        }

        case "status": {
          const name = args.name as string;
          if (!name) return { result: "Error: name required for status action" };
          const entry = managedProcesses.get(name);
          if (!entry) return { result: `No process found with name "${name}"` };
          return {
            result: JSON.stringify({
              name,
              pid: entry.proc.pid,
              alive: !entry.proc.killed,
              recentOutput: entry.output.slice(-20).join("\n"),
            }, null, 2),
          };
        }

        default:
          return { result: `Unknown process action: ${action}. Use: start, stop, list, status` };
      }
    }

    case "edit_file": {
      const path = args.path as string;
      const oldText = args.old_text as string;
      const newText = args.new_text as string;

      const files = await db.select().from(filesTable)
        .where(eq(filesTable.projectId, projectId));
      const file = files.find((f) => f.path === path || f.name === path);
      if (!file) return { result: `Error: File "${path}" not found` };

      if (!file.content.includes(oldText)) {
        return { result: `Error: Could not find the exact text to replace in "${path}". Make sure old_text matches exactly (including whitespace).` };
      }

      const occurrences = file.content.split(oldText).length - 1;
      const newContent = file.content.replace(oldText, newText);

      await db.update(filesTable)
        .set({ content: newContent, updatedAt: new Date() })
        .where(eq(filesTable.id, file.id));

      return {
        result: `Edited "${path}": replaced ${occurrences} occurrence(s) (${oldText.length} → ${newText.length} chars)`,
        fileChanged: { path, action: "updated" },
      };
    }

    case "find_and_replace": {
      const pattern = args.pattern as string;
      const replacement = args.replacement as string;
      const filePattern = args.file_pattern as string || "";

      try {
        const files = await db.select().from(filesTable)
          .where(eq(filesTable.projectId, projectId));

        const regex = new RegExp(pattern, "g");
        const results: { path: string; replacements: number }[] = [];

        for (const file of files) {
          if (filePattern) {
            const ext = filePattern.replace("*", "").replace(".", "");
            if (ext && !file.path.endsWith(ext) && !file.name.endsWith(ext)) continue;
          }

          const matches = file.content.match(regex);
          if (matches && matches.length > 0) {
            const newContent = file.content.replace(regex, replacement);
            await db.update(filesTable)
              .set({ content: newContent, updatedAt: new Date() })
              .where(eq(filesTable.id, file.id));
            results.push({ path: file.path, replacements: matches.length });
          }
        }

        if (results.length === 0) {
          return { result: `No matches found for pattern "${pattern}"` };
        }

        return {
          result: `Find & replace complete:\n${results.map((r) => `  ${r.path}: ${r.replacements} replacement(s)`).join("\n")}\nTotal: ${results.reduce((s, r) => s + r.replacements, 0)} replacements across ${results.length} file(s)`,
          fileChanged: { path: results[0].path, action: "updated" },
        };
      } catch (err: any) {
        return { result: `Regex error: ${err.message}` };
      }
    }

    case "parse_file": {
      const filePath = args.path as string;
      const format = (args.format as string) || "auto";
      const extract = (args.extract as string) || "all";

      try {
        const files = await db.select().from(filesTable)
          .where(eq(filesTable.projectId, projectId));
        const file = files.find((f) => f.path === filePath || f.name === filePath);

        if (!file) {
          const fs = await import("fs/promises");
          const homeDir = process.env.HOME || "/home/runner";
          const absPath = filePath.startsWith("/") ? filePath : `${homeDir}/${filePath}`;
          try {
            const diskContent = await fs.readFile(absPath, "utf-8");
            return parseFileContent(diskContent, filePath, format, extract);
          } catch {
            return { result: `Error: File "${filePath}" not found in project or on disk` };
          }
        }

        return parseFileContent(file.content, filePath, format, extract);
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(`http://localhost:${port}${urlPath}`, {
          method,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        const elapsed = Date.now() - start;
        const bodyText = await resp.text().catch(() => "");
        const snippet = bodyText.slice(0, 500);
        const statusMatch = resp.status === expectedStatus;

        return {
          result: JSON.stringify({
            status: statusMatch ? "PASS" : "FAIL",
            port,
            path: urlPath,
            httpStatus: resp.status,
            expectedStatus,
            responseTimeMs: elapsed,
            contentType: resp.headers.get("content-type") || "unknown",
            bodyPreview: snippet,
          }, null, 2),
        };
      } catch (err: any) {
        return {
          result: JSON.stringify({
            status: "FAIL",
            port,
            error: err.name === "AbortError" ? "Connection timed out (5s)" : err.message,
            hint: "Service may not be running. Use manage_process to start it, or run_command to check.",
          }, null, 2),
        };
      }
    }

    case "test_api": {
      const url = args.url as string;
      const method = (args.method as string) || "GET";
      const expectStatus = (args.expect_status as number) || 200;
      const expectBodyContains = args.expect_body_contains as string;
      const expectJsonPath = args.expect_json_path as string;

      let headers: Record<string, string> = {};
      if (args.headers) {
        try { headers = JSON.parse(args.headers as string); } catch {}
      }

      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const resp = await fetch(url, {
          method,
          headers,
          body: args.body ? (args.body as string) : undefined,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        const elapsed = Date.now() - start;
        const bodyText = await resp.text().catch(() => "");
        
        const tests: { name: string; pass: boolean; detail: string }[] = [];

        tests.push({
          name: "Status Code",
          pass: resp.status === expectStatus,
          detail: `Expected ${expectStatus}, got ${resp.status}`,
        });

        if (expectBodyContains) {
          const found = bodyText.includes(expectBodyContains);
          tests.push({
            name: "Body Contains",
            pass: found,
            detail: found ? `Found "${expectBodyContains}"` : `"${expectBodyContains}" not found in response`,
          });
        }

        let jsonPathValue: any = undefined;
        if (expectJsonPath) {
          try {
            const json = JSON.parse(bodyText);
            const pathParts = expectJsonPath.split(".");
            let val: any = json;
            for (const part of pathParts) {
              val = val?.[part];
            }
            jsonPathValue = val;
            tests.push({
              name: `JSON Path: ${expectJsonPath}`,
              pass: val !== undefined && val !== null,
              detail: `Value: ${JSON.stringify(val)}`,
            });
          } catch {
            tests.push({
              name: `JSON Path: ${expectJsonPath}`,
              pass: false,
              detail: "Response is not valid JSON",
            });
          }
        }

        const allPassed = tests.every((t) => t.pass);

        return {
          result: JSON.stringify({
            overall: allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED",
            url,
            method,
            responseTimeMs: elapsed,
            httpStatus: resp.status,
            contentType: resp.headers.get("content-type") || "unknown",
            tests,
            bodyPreview: bodyText.slice(0, 1000),
          }, null, 2),
        };
      } catch (err: any) {
        return {
          result: JSON.stringify({
            overall: "REQUEST FAILED",
            url,
            method,
            error: err.name === "AbortError" ? "Request timed out (15s)" : err.message,
            hint: "Check that the server is running and the URL is correct.",
          }, null, 2),
        };
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
  req.on("close", () => {
    aborted = true;
    activeAbort?.abort();
  });

  let toolCallCounter = 0;

  const sendEvent = (event: Record<string, any>) => {
    if (!aborted) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    const projectFiles = await db.select({
      name: filesTable.name,
      path: filesTable.path,
    }).from(filesTable).where(eq(filesTable.projectId, projectId));

    const fileList = projectFiles.map((f) => f.path).join(", ") || "No files yet";

    const systemPrompt = `You are Luxi — an elite autonomous AI coding agent, as powerful as Replit's AI agent. You can do ANYTHING a software developer can do: read/write/edit files, run any shell command, browse websites, search the web, manage git repos, download files, start/stop processes, read logs, parse data files, test APIs, and debug applications — completely autonomously.

CURRENT PROJECT FILES: ${fileList}

YOUR COMPLETE TOOLSET (18 tools):

FILE OPERATIONS:
- list_files: See all files in the project
- read_file(path): Read a file's contents
- write_file(path, content): Write/overwrite a file with full content
- create_file(name, path, content): Create a new file
- delete_file(path): Delete a file
- edit_file(path, old_text, new_text): Surgically edit a specific part of a file
- search_files(query): Search filenames and content
- find_and_replace(pattern, replacement, file_pattern): Regex find & replace across files
- parse_file(path, format, extract): Parse HAR/JSON/CSV/XML/YAML/.env files

EXECUTION:
- run_command(command): Run ANY shell command (30s timeout)
- manage_process(action, command, name): Start/stop/monitor background processes
- read_logs(source, lines, filter): Read log files or process output

WEB & NETWORK:
- browse_website(url, method, headers, body): Fetch any URL
- web_search(query): Search the web
- download_file(url, destination): Download files from the internet

TESTING & DEBUGGING:
- check_port(port, path, method, expectedStatus): Check if a service is running
- test_api(url, method, headers, body, expect_status, expect_body_contains, expect_json_path): Full API testing

VERSION CONTROL:
- git_operation(operation, args, cwd): Full git operations

WORKFLOW — Follow this for EVERY task:
1. UNDERSTAND: Read the request carefully. Parse uploaded files with parse_file.
2. INVESTIGATE: Read existing files, search the codebase, check dependencies.
3. PLAN: Think about changes needed. Consider edge cases and dependencies.
4. IMPLEMENT: Write complete, production-quality code.
5. INSTALL: Run package installs or builds needed.
6. VERIFY: Run the code, check for errors, use check_port and test_api.
7. ITERATE: If anything fails, fix it and try again. Repeat until it works.
8. SUMMARIZE: Explain what you did and what changed.

CRITICAL RETRY BEHAVIOR:
- NEVER give up after a single failure.
- You have 40 iterations — USE THEM until the task is 100% complete.
- Read errors carefully, fix the specific issue, verify the fix worked.

RULES:
- Always read files before modifying them
- Write COMPLETE files — never partial snippets, placeholders, or TODO comments
- Install dependencies when adding new packages
- Use edit_file for small targeted changes instead of rewriting entire files
- NEVER say "I can't do this" — you have ALL the tools you need`;

    const chatHistory: any[] = (history ?? []).slice(-20).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    let contents = [
      ...chatHistory,
      { role: "user", parts: [{ text: message }] },
    ];

    for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
      if (aborted) break;

      activeAbort = new AbortController();
      const agentResult = await agentCall(
        settings,
        systemPrompt,
        contents,
        toolDeclarations,
        activeAbort.signal
      );
      activeAbort = null;

      if (agentResult.finishReason?.startsWith("error:")) {
        logger.error({ reason: agentResult.finishReason }, "AI API error in agent");
        sendEvent({ type: "error", content: `AI error: ${agentResult.finishReason}` });
        break;
      }

      if (agentResult.finishReason === "no_content") {
        sendEvent({ type: "error", content: "No response from AI" });
        break;
      }

      if (agentResult.textParts.length > 0 && agentResult.toolCalls.length === 0) {
        const fullText = agentResult.textParts.join("");
        sendEvent({ type: "message", content: fullText });
        break;
      }

      if (agentResult.toolCalls.length > 0) {
        const modelParts: any[] = [];
        for (const tp of agentResult.textParts) {
          modelParts.push({ text: tp });
        }
        for (const tc of agentResult.toolCalls) {
          modelParts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
        contents.push({ role: "model", parts: modelParts });

        const functionResponses: any[] = [];

        for (const tc of agentResult.toolCalls) {
          const callId = `tc_${toolCallCounter++}`;

          sendEvent({
            type: "tool_call",
            id: callId,
            tool: tc.name,
            args: tc.name === "write_file" || tc.name === "create_file"
              ? { ...tc.args, content: `(${(tc.args.content?.length ?? 0)} chars)` }
              : tc.args,
          });

          const { result, fileChanged } = await executeTool(tc.name, tc.args, projectId);
          const truncatedResult = result.length > 10000 ? result.slice(0, 10000) + "\n...(truncated)" : result;

          sendEvent({
            type: "tool_result",
            id: callId,
            tool: tc.name,
            result: truncatedResult.length > 500 ? truncatedResult.slice(0, 500) + "..." : truncatedResult,
          });

          if (fileChanged) {
            sendEvent({ type: "file_changed", ...fileChanged });
          }

          functionResponses.push({
            functionResponse: {
              name: tc.name,
              response: { result: truncatedResult },
            },
          });
        }

        contents.push({ role: "user", parts: functionResponses });

        if (agentResult.textParts.length > 0) {
          sendEvent({ type: "thinking", content: agentResult.textParts.join("") });
        }
      }

      if ((agentResult.finishReason === "STOP" || agentResult.finishReason === "end_turn" || agentResult.finishReason === "stop") && agentResult.toolCalls.length === 0) {
        break;
      }
    }

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
