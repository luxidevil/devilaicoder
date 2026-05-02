import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ProjectFile {
  id: number;
  project_id: number;
  name: string;
  path: string;
  content: string;
  language: string;
}

interface ProjectDoc {
  title: string;
  content: string;
}

function send(ctrl: ReadableStreamDefaultController, event: unknown) {
  ctrl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", css: "css", scss: "css", sass: "css",
    html: "html", json: "json", md: "markdown", mdx: "markdown",
    yml: "yaml", yaml: "yaml", toml: "toml", sh: "shell", bash: "shell",
    sql: "sql", graphql: "graphql", vue: "vue", svelte: "svelte",
    rb: "ruby", php: "php", java: "java", kt: "kotlin", swift: "swift",
    c: "c", cpp: "cpp", cs: "csharp", dockerfile: "dockerfile",
  };
  return map[ext] ?? "plaintext";
}

function buildEnhancedPrompt(message: string, files: ProjectFile[], docs: ProjectDoc[], mode: string, appTesting = false): string {
  const parts: string[] = [];
  parts.push(`USER REQUEST:\n${message}`);
  if (docs.length > 0) {
    parts.push(`\nPROJECT DOCUMENTATION:\n${docs.map((d) => `### ${d.title}\n${d.content.slice(0, 6000)}`).join("\n\n")}`);
  }
  if (files.length > 0) {
    parts.push(`\nCURRENT PROJECT FILES:\n${files.map((f) => `--- ${f.path} (${f.language}) ---\n${f.content.slice(0, 8000)}`).join("\n\n")}`);
  } else {
    parts.push("\nNo files in project yet. Start fresh.");
  }
  if (mode === "agent") {
    parts.push("\nINSTRUCTIONS: Use the available tools to fulfill the request. Be thorough, write complete working code, create all necessary files. Never truncate file contents.");
  }
  if (appTesting) {
    parts.push("\nAPP TESTING MODE: Before you declare success on any runnable app or UI change, you must validate it yourself. Start or reuse the dev server, open the app with browser_action, exercise the requested flow, inspect any failures, fix them, and re-test. If browser testing is impossible because the runner or Puppeteer is unavailable, explicitly say so and fall back to the best available runtime checks.");
  }
  return parts.join("\n");
}

const AGENT_SYSTEM_PROMPT = `You are LUXI, a world-class AI software engineer. You understand plain English and do exactly what the user asks — no setup required, no technical knowledge needed.

## HOW TO RESPOND — FOLLOW THIS WITHOUT EXCEPTION

**Decide what the user wants:**
- If they want something BUILT, CHANGED, or FIXED → use tools to make it happen. Write code to files, run commands, search the web. Never explain what you're going to do, just do it.
- If they're asking a QUESTION or want an EXPLANATION → answer clearly in plain English. You may show code in chat for explanations only.
- If it's AMBIGUOUS → default to taking action (build it).

**Code always goes into files, never chat:**
When building or modifying code, use write_file / edit_file / batch_write_files. Never paste implementation code into the chat response — the user wants it done, not described.

**Examples of plain English → actions:**
- "add a dark mode toggle" → edit the relevant files, add the feature
- "make the button red" → find and edit the file, change the color
- "build me a todo app" → create all files, write complete working code
- "why isn't this working" → read the files, diagnose, fix it
- "what does this function do" → explain in plain English (no files needed)
- "search for the best charting library" → use web_search, give a recommendation

## Your Capabilities (Tools Available)

### File Operations
- **write_file(path, content)** — Create or overwrite any file with complete content
- **read_file(path)** — Read the full content of a file
- **edit_file(path, old_str, new_str)** — Make targeted edits by replacing exact text
- **delete_file(path)** — Remove a file
- **rename_file(old_path, new_path)** — Rename or move a file
- **list_files()** — List all project files
- **search_files(query)** — Search file names by pattern
- **grep(pattern, path?)** — Search file contents for a pattern
- **batch_write_files(files)** — Write multiple files at once efficiently

### Web & Research
- **browse_website(url)** — Fetch and read any website, API docs, GitHub repo, or web page (static HTML fetch)
- **web_search(query, num_results?)** — Search the web for current information, documentation, tutorials, packages, APIs, research papers. Use this BEFORE browsing to find the right URL.

### Real Command Execution (if runner is connected)
- **run_command(command, cwd?, timeout?)** — Execute REAL shell commands. Returns actual output. Use for: npm install, pip install, git commands, running tests, building projects, starting servers, ANY shell operation. NOT simulated.
- **install_package(packages, manager?)** — Install npm/pip/yarn packages. Faster than run_command for package installs.
- **execute_code(code, language, stdin?)** — Execute code directly and get real output. Supports: python, javascript, bash, ruby, go, rust (if installed).
- **read_local_file(path)** — Read a file from the runner's local filesystem (outside project sandbox).
- **write_local_file(path, content)** — Write a file to the runner's local filesystem.
- **list_local_dir(dir?)** — List files in the runner's local filesystem.

### Browser Automation (if runner + Puppeteer installed)
- **browser_action(action, ...)** — Control a REAL Chromium browser. Use for JS-rendered pages, SPAs, DOM manipulation, form automation, scraping dynamic content, testing UIs.
  Actions available: launch, navigate, get_text, get_html, click, type, fill, select, scroll, evaluate, screenshot, wait_for, hover, press_key, query_all, get_attribute, get_cookies, set_cookies, current_url, close.
  - launch: Start a browser session (use sessionId to reuse across calls)
  - navigate: Go to a URL, waits for network idle and full JS execution
  - get_text: Get visible text of page or a specific element (selector optional)
  - get_html: Get raw HTML of page or element
  - click: Click element by CSS selector or x,y coordinates
  - type: Type text into an input with human-like delay
  - fill: Instantly set input value and fire input/change events
  - select: Choose option in a select element
  - evaluate: Run arbitrary JavaScript in the page context (DOM manipulation, localStorage, etc.)
  - screenshot: Capture page as base64 PNG
  - wait_for: Wait for selector, navigation, or N milliseconds
  - scroll: Scroll to element or coordinates
  - hover: Hover over element
  - press_key: Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.)
  - query_all: Get all matching elements with text/href/id/class
  - get_attribute: Read an element attribute
  - get_cookies / set_cookies: Cookie management
  - current_url: Get current page URL and title
  - close: Close browser session
  Always use the same sessionId across sequential actions to keep the browser open.

### When runner is NOT connected:
- run_command, install_package, execute_code, read_local_file, write_local_file, list_local_dir, browser_action will show what would be run and explain setup.

## How You Work
1. Read the request. Understand the intent. Act immediately.
2. For builds/changes: use batch_write_files for new projects, edit_file for targeted changes
3. Research when needed: web_search → browse_website to find docs, APIs, packages
4. Run real commands when runner is connected: install packages, run tests, start servers
5. Never truncate — write complete, full implementations
6. After doing something, give a SHORT plain-English summary (what changed, any next steps)

## Code Standards
- Production-quality, idiomatic code for the language/framework in use
- Proper error handling and types
- For web: modern patterns (React hooks, async/await, TypeScript)
- For Python: PEP8, type hints
- Always install required packages before using them

## Tone
- Talk to users like a smart colleague, not a manual
- Short summaries after actions ("Done — added dark mode toggle to the header")
- For questions: clear, direct answers in plain English`;

const CHAT_SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT;

function buildSystemPrompt(mode: string, appTesting = false): string {
  if (mode !== "agent" || !appTesting) return mode === "agent" ? AGENT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;

  return `${AGENT_SYSTEM_PROMPT}

## APP TESTING MODE
- Treat browser validation as part of the task, not an optional extra.
- After changing a runnable app, you MUST verify the user-facing behavior yourself before finishing.
- Preferred flow:
  1. Inspect the project and determine how to run it.
  2. Install missing dependencies if needed.
  3. Start or reuse the app/dev server with run_command.
  4. Use browser_action with a persistent sessionId to open the app and exercise the requested flow.
  5. If the browser shows errors, broken UI, failing interactions, or unexpected output, fix the code and test again.
  6. Only stop when the requested behavior works or when you can clearly explain the concrete blocker.
- Always mention the browser/runtime checks you actually performed in the final summary.
- If runner/browser automation is unavailable, say that clearly and fall back to the best available validation.`;
}
const SAFE_MAX_OUTPUT_TOKENS = 8192;
const EXCLUSIVE_MAX_OUTPUT_TOKENS_LIMIT = 65536;

function buildGenerationConfig() {
  return {
    temperature: 0.7,
    // Vertex rejects values equal to the exclusive upper bound (65536), so we clamp below it.
    maxOutputTokens: Math.min(SAFE_MAX_OUTPUT_TOKENS, EXCLUSIVE_MAX_OUTPUT_TOKENS_LIMIT - 1),
  };
}

async function checkAndDeductCredit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", userId)
    .maybeSingle();

  const tier = profile?.subscription_tier ?? "free";

  if (tier === "unlimited") return { allowed: true };

  const { data: credits } = await supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  const balance = credits?.balance ?? 0;
  if (balance <= 0) {
    return {
      allowed: false,
      reason: `You have 0 credits remaining. To continue using the platform AI, contact the admin to purchase more credits, or add your own API key using the key icon in the toolbar.`,
    };
  }

  await supabase.from("user_credits").update({
    balance: balance - 1,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  await supabase.from("credit_transactions").insert({
    user_id: userId,
    amount: -1,
    reason: "ai_request",
    note: "Platform AI usage",
  });

  return { allowed: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { message, projectId, files, docs = [], history, mode, appTesting = false, userKeys, userId } = await req.json();

    const { data: rows } = await supabase.from("settings").select("key, value").in("key", ["provider", "model", "gemini_key", "anthropic_key", "openai_key", "vertex_key"]);
    const cfg: Record<string, string> = {};
    (rows ?? []).forEach((r: { key: string; value: string }) => { cfg[r.key] = r.value; });

    const usingOwnKey = !!(
      (userKeys?.provider === "gemini" && userKeys?.gemini_key) ||
      (userKeys?.provider === "anthropic" && userKeys?.anthropic_key) ||
      (userKeys?.provider === "openai" && userKeys?.openai_key) ||
      (userKeys?.provider === "vertex" && userKeys?.vertex_key)
    );

    if (!usingOwnKey && userId) {
      const creditCheck = await checkAndDeductCredit(supabase, userId);
      if (!creditCheck.allowed) {
        const stream = new ReadableStream({
          start(ctrl) {
            send(ctrl, { type: "error", content: creditCheck.reason ?? "No credits remaining." });
            send(ctrl, { type: "done" });
            ctrl.close();
          },
        });
        return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
      }
    }

    const provider = (userKeys?.provider || cfg["provider"] || "gemini") as string;
    const model = (userKeys?.model || cfg["model"] || "gemini-2.0-flash") as string;

    const resolvedKeys = {
      gemini: userKeys?.gemini_key || cfg["gemini_key"] || "",
      anthropic: userKeys?.anthropic_key || cfg["anthropic_key"] || "",
      openai: userKeys?.openai_key || cfg["openai_key"] || "",
      vertex: userKeys?.vertex_key || cfg["vertex_key"] || "",
    };

    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          const systemPrompt = buildSystemPrompt(mode, appTesting);
          const enhancedMessage = buildEnhancedPrompt(message, files as ProjectFile[], docs as ProjectDoc[], mode, appTesting);

          if (provider === "gemini" && resolvedKeys.gemini) {
            await runGemini(ctrl, enhancedMessage, history, systemPrompt, model, resolvedKeys.gemini, mode, supabase, projectId, files);
          } else if (provider === "anthropic" && resolvedKeys.anthropic) {
            await runAnthropic(ctrl, enhancedMessage, history, systemPrompt, model, resolvedKeys.anthropic, mode, supabase, projectId, files);
          } else if (provider === "openai" && resolvedKeys.openai) {
            await runOpenAI(ctrl, enhancedMessage, history, systemPrompt, model, resolvedKeys.openai, mode, supabase, projectId, files);
          } else if (provider === "vertex" && resolvedKeys.vertex) {
            await runVertex(ctrl, enhancedMessage, history, systemPrompt, model, resolvedKeys.vertex, mode, supabase, projectId, files);
          } else {
            send(ctrl, { type: "error", content: "No AI provider configured. Click the key icon in the IDE toolbar to add your API key, or ask the admin to configure a platform key." });
          }
        } catch (e) { send(ctrl, { type: "error", content: String(e) }); }
        send(ctrl, { type: "done" });
        ctrl.close();
      },
    });

    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function getRunnerConfig(supabase: ReturnType<typeof createClient>): Promise<{ url: string; secret: string } | null> {
  const { data } = await supabase.from("settings").select("key, value").in("key", ["runner_url", "runner_secret"]);
  if (!data || data.length === 0) return null;
  const m: Record<string, string> = {};
  data.forEach((r: { key: string; value: string }) => { m[r.key] = r.value; });
  if (!m["runner_url"]) return null;
  return { url: m["runner_url"].replace(/\/$/, ""), secret: m["runner_secret"] ?? "" };
}

async function runnerFetch(runnerUrl: string, secret: string, endpoint: string, body: unknown, timeoutMs = 30000): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;
  const res = await fetch(`${runnerUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Runner ${endpoint} ${res.status}: ${text}`);
  }
  return res.json();
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  projectId: number,
  files: ProjectFile[],
  ctrl: ReadableStreamDefaultController,
): Promise<string> {
  if (name === "write_file") {
    const path = String(args.path), content = String(args.content);
    const existing = files.find((f) => f.path === path || f.name === path);
    if (existing) {
      await supabase.from("files").update({ content, updated_at: new Date().toISOString() }).eq("id", existing.id);
      existing.content = content;
    } else {
      const lang = detectLanguage(path);
      const { data } = await supabase.from("files").insert({ project_id: projectId, name: path.split("/").pop() || path, path, content, language: lang }).select().single();
      if (data) files.push(data);
    }
    send(ctrl, { type: "file_changed", path, action: existing ? "updated" : "created" });
    return `File ${path} written successfully (${content.length} chars)`;
  }

  if (name === "edit_file") {
    const path = String(args.path);
    const oldStr = String(args.old_str ?? args.old ?? "");
    const newStr = String(args.new_str ?? args.new ?? "");
    const file = files.find((f) => f.path === path || f.name === path);
    if (!file) return `File not found: ${path}`;
    if (!file.content.includes(oldStr)) return `Could not find the text to replace in ${path}. Use write_file to rewrite the entire file instead.`;
    const newContent = file.content.replace(oldStr, newStr);
    await supabase.from("files").update({ content: newContent, updated_at: new Date().toISOString() }).eq("id", file.id);
    file.content = newContent;
    send(ctrl, { type: "file_changed", path, action: "updated" });
    return `File ${path} edited successfully`;
  }

  if (name === "batch_write_files") {
    const fileList = args.files as { path: string; content: string }[];
    if (!Array.isArray(fileList)) return "Invalid files argument — must be an array of {path, content}";
    const results: string[] = [];
    for (const f of fileList) {
      const path = String(f.path), content = String(f.content);
      const existing = files.find((fi) => fi.path === path || fi.name === path);
      if (existing) {
        await supabase.from("files").update({ content, updated_at: new Date().toISOString() }).eq("id", existing.id);
        existing.content = content;
      } else {
        const lang = detectLanguage(path);
        const { data } = await supabase.from("files").insert({ project_id: projectId, name: path.split("/").pop() || path, path, content, language: lang }).select().single();
        if (data) files.push(data);
      }
      send(ctrl, { type: "file_changed", path, action: existing ? "updated" : "created" });
      results.push(`${path} (${existing ? "updated" : "created"})`);
    }
    return `Written ${results.length} files: ${results.join(", ")}`;
  }

  if (name === "read_file") {
    const path = String(args.path);
    const file = files.find((f) => f.path === path || f.name === path);
    return file ? (file.content || "(empty file)") : `File not found: ${path}. Available files: ${files.map((f) => f.path).join(", ") || "none"}`;
  }

  if (name === "delete_file") {
    const path = String(args.path);
    const file = files.find((f) => f.path === path || f.name === path);
    if (!file) return `File not found: ${path}`;
    await supabase.from("files").delete().eq("id", file.id);
    files.splice(files.indexOf(file), 1);
    send(ctrl, { type: "file_changed", path, action: "deleted" });
    return `File ${path} deleted`;
  }

  if (name === "rename_file") {
    const oldPath = String(args.old_path), newPath = String(args.new_path);
    const file = files.find((f) => f.path === oldPath || f.name === oldPath);
    if (!file) return `File not found: ${oldPath}`;
    const newName = newPath.split("/").pop() || newPath;
    const lang = detectLanguage(newPath);
    await supabase.from("files").update({ path: newPath, name: newName, language: lang, updated_at: new Date().toISOString() }).eq("id", file.id);
    const oldPathCopy = file.path;
    file.path = newPath; file.name = newName; file.language = lang;
    send(ctrl, { type: "file_changed", path: oldPathCopy, action: "deleted" });
    send(ctrl, { type: "file_changed", path: newPath, action: "created" });
    return `Renamed ${oldPath} to ${newPath}`;
  }

  if (name === "list_files") {
    if (files.length === 0) return "No files in project yet.";
    return files.map((f) => `${f.path} (${f.language})`).join("\n");
  }

  if (name === "search_files") {
    const query = String(args.query ?? args.pattern ?? "").toLowerCase();
    const matches = files.filter((f) => f.path.toLowerCase().includes(query) || f.name.toLowerCase().includes(query));
    if (matches.length === 0) return `No files matching "${query}"`;
    return matches.map((f) => f.path).join("\n");
  }

  if (name === "grep") {
    const pattern = String(args.pattern ?? args.query ?? "");
    const targetPath = args.path ? String(args.path) : null;
    const targetFiles = targetPath ? files.filter((f) => f.path === targetPath || f.name === targetPath) : files;
    const results: string[] = [];
    try {
      const regex = new RegExp(pattern, "gi");
      for (const file of targetFiles) {
        const lines = file.content.split("\n");
        lines.forEach((line, idx) => {
          if (regex.test(line)) results.push(`${file.path}:${idx + 1}: ${line.trim()}`);
        });
      }
    } catch {
      for (const file of targetFiles) {
        const lines = file.content.split("\n");
        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(pattern.toLowerCase())) results.push(`${file.path}:${idx + 1}: ${line.trim()}`);
        });
      }
    }
    if (results.length === 0) return `No matches found for "${pattern}"`;
    return results.slice(0, 100).join("\n") + (results.length > 100 ? `\n... and ${results.length - 100} more matches` : "");
  }

  if (name === "browse_website") {
    const url = String(args.url ?? args.path ?? "");
    if (!url) return "Error: url parameter is required";
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.9",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return `HTTP ${res.status} ${res.statusText} — could not fetch ${url}`;
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      if (contentType.includes("application/json")) {
        return `URL: ${url}\nContent-Type: JSON\n\n${raw.slice(0, 20000)}`;
      }
      const stripped = raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{3,}/g, "\n\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      return `URL: ${url}\n\n${stripped.slice(0, 20000)}${stripped.length > 20000 ? "\n\n[...content truncated — use a more specific URL to see more...]" : ""}`;
    } catch (e) {
      return `Failed to fetch ${url}: ${String(e)}`;
    }
  }

  if (name === "web_search") {
    const query = String(args.query ?? args.q ?? "");
    const numResults = Number(args.num_results ?? args.n ?? 8);
    if (!query) return "Error: query parameter is required";
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://ddg-api.herokuapp.com/search?query=${encoded}&limit=${numResults}`, {
        headers: { "User-Agent": "LUXI-AI/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json() as { title: string; link: string; snippet: string }[];
        if (Array.isArray(data) && data.length > 0) {
          return `Web search results for: "${query}"\n\n` +
            data.map((r, i) => `${i + 1}. **${r.title}**\n   URL: ${r.link}\n   ${r.snippet}`).join("\n\n");
        }
      }
      const fallbackRes = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {
        headers: { "User-Agent": "LUXI-AI/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!fallbackRes.ok) return `Search failed for: ${query}. Try browse_website with a direct URL.`;
      const fallback = await fallbackRes.json() as {
        AbstractText?: string;
        AbstractURL?: string;
        RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
      };
      const results: string[] = [];
      if (fallback.AbstractText) results.push(`Summary: ${fallback.AbstractText}\nSource: ${fallback.AbstractURL}`);
      (fallback.RelatedTopics ?? []).slice(0, numResults).forEach((t) => {
        if (t.Text && t.FirstURL) results.push(`- ${t.Text}\n  URL: ${t.FirstURL}`);
        (t.Topics ?? []).slice(0, 3).forEach((sub) => {
          if (sub.Text && sub.FirstURL) results.push(`  - ${sub.Text}\n    URL: ${sub.FirstURL}`);
        });
      });
      if (results.length === 0) return `No results found for: "${query}". Try browse_website with a known URL.`;
      return `Web search results for: "${query}"\n\n${results.join("\n\n")}`;
    } catch (e) {
      return `Search error: ${String(e)}. Try browse_website with a direct URL instead.`;
    }
  }

  if (name === "run_command") {
    const command = String(args.command ?? args.cmd ?? "");
    const cwd = args.cwd ? String(args.cwd) : undefined;
    const timeout = args.timeout ? Number(args.timeout) : 30000;
    if (!command) return "Error: command parameter is required";

    const runner = await getRunnerConfig(supabase);
    if (!runner) {
      return `[RUNNER NOT CONNECTED]\n$ ${command}\n\nTo enable real command execution, set up the LUXI Runner:\n1. Run the runner/server.js on your server: node runner/server.js\n2. Go to Admin > Runner tab and enter the runner URL\n\nWithout runner, commands are not executed.`;
    }

    send(ctrl, { type: "command_start", command });
    try {
      const result = await runnerFetch(runner.url, runner.secret, "/run", {
        command,
        projectId: String(projectId),
        cwd,
        timeout,
      }, timeout + 5000) as { stdout: string; stderr: string; exitCode: number; cwd: string };

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? "\n[stderr]\n" : "") + result.stderr;
      const summary = `$ ${command}\n${output || "(no output)"}`;
      send(ctrl, { type: "command_done", exitCode: result.exitCode });
      return summary.slice(0, 30000);
    } catch (e) {
      return `Command failed: ${String(e)}`;
    }
  }

  if (name === "install_package") {
    const packages = args.packages;
    const manager = String(args.manager ?? "npm");
    const pkgStr = Array.isArray(packages) ? (packages as string[]).join(" ") : String(packages ?? "");
    if (!pkgStr) return "Error: packages required";

    const runner = await getRunnerConfig(supabase);
    if (!runner) {
      return `[RUNNER NOT CONNECTED] Would run: ${manager} install ${pkgStr}\n\nSet up the runner to enable real package installation.`;
    }

    send(ctrl, { type: "command_start", command: `${manager} install ${pkgStr}` });
    try {
      const result = await runnerFetch(runner.url, runner.secret, "/install", {
        projectId: String(projectId),
        packages: Array.isArray(packages) ? packages : pkgStr.split(" "),
        manager,
      }, 120000) as { stdout: string; stderr: string; ok: boolean };
      send(ctrl, { type: "command_done", exitCode: result.ok ? 0 : 1 });
      const out = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return `Installed ${pkgStr} via ${manager}\n${out.slice(0, 10000)}`;
    } catch (e) {
      return `Install failed: ${String(e)}`;
    }
  }

  if (name === "execute_code") {
    const code = String(args.code ?? "");
    const language = String(args.language ?? "python").toLowerCase();
    const stdin = args.stdin ? String(args.stdin) : undefined;
    if (!code) return "Error: code parameter is required";

    const langCmd: Record<string, string> = {
      python: "python3", python3: "python3", py: "python3",
      javascript: "node", js: "node", node: "node",
      bash: "bash", sh: "bash", shell: "bash",
      ruby: "ruby", rb: "ruby",
      go: "go run",
      rust: "rustc",
    };
    const interp = langCmd[language];
    if (!interp) return `Unsupported language: ${language}. Supported: python, javascript, bash, ruby, go`;

    const runner = await getRunnerConfig(supabase);
    if (!runner) {
      return `[RUNNER NOT CONNECTED] Would execute ${language} code (${code.length} chars)\n\nSet up the runner to enable real code execution.`;
    }

    const ext: Record<string, string> = { python: "py", javascript: "js", bash: "sh", ruby: "rb", go: "go", rust: "rs" };
    const tmpFile = `/tmp/luxi_exec_${Date.now()}.${ext[language] ?? "txt"}`;
    const stdinPipe = stdin ? `echo ${JSON.stringify(stdin)} | ` : "";
    const runCmd = language === "go"
      ? `echo ${JSON.stringify(code)} > ${tmpFile} && go run ${tmpFile}`
      : `echo ${JSON.stringify(code)} > ${tmpFile} && ${stdinPipe}${interp} ${tmpFile}`;

    send(ctrl, { type: "command_start", command: `[execute ${language} code]` });
    try {
      const result = await runnerFetch(runner.url, runner.secret, "/run", {
        command: runCmd,
        projectId: String(projectId),
        timeout: 30000,
      }, 35000) as { stdout: string; stderr: string; exitCode: number };

      send(ctrl, { type: "command_done", exitCode: result.exitCode });
      let out = "";
      if (result.stdout) out += result.stdout;
      if (result.stderr) out += (out ? "\n[stderr]\n" : "") + result.stderr;
      return `Exit code: ${result.exitCode}\n${out || "(no output)"}`.slice(0, 20000);
    } catch (e) {
      return `Execution failed: ${String(e)}`;
    }
  }

  if (name === "read_local_file") {
    const filePath = String(args.path ?? "");
    if (!filePath) return "Error: path required";
    const runner = await getRunnerConfig(supabase);
    if (!runner) return "[RUNNER NOT CONNECTED] Cannot read local files without runner.";
    try {
      const result = await runnerFetch(runner.url, runner.secret, "/read", {
        projectId: String(projectId),
        filePath,
      }) as { content: string };
      return result.content;
    } catch (e) {
      return `Failed to read ${filePath}: ${String(e)}`;
    }
  }

  if (name === "write_local_file") {
    const filePath = String(args.path ?? "");
    const content = String(args.content ?? "");
    if (!filePath) return "Error: path required";
    const runner = await getRunnerConfig(supabase);
    if (!runner) return "[RUNNER NOT CONNECTED] Cannot write local files without runner.";
    try {
      await runnerFetch(runner.url, runner.secret, "/write", {
        projectId: String(projectId),
        filePath,
        content,
      });
      return `Written ${filePath} (${content.length} chars)`;
    } catch (e) {
      return `Failed to write ${filePath}: ${String(e)}`;
    }
  }

  if (name === "browser_action") {
    const action = String(args.action ?? "");
    if (!action) return "Error: action parameter is required";

    const runner = await getRunnerConfig(supabase);
    if (!runner) {
      return `[RUNNER NOT CONNECTED] browser_action requires the LUXI runner with Puppeteer installed.\n\n1. Set up runner/server.js on your Mac/droplet\n2. Run: npm install puppeteer  (in the runner directory)\n3. Go to Admin > Runner tab and configure the URL`;
    }

    const payload: Record<string, unknown> = { action };
    const fields = ["sessionId", "url", "selector", "value", "script", "x", "y", "button", "waitFor", "timeout", "fullPage", "attribute", "cookies", "delay", "clear"];
    for (const f of fields) {
      if (args[f] !== undefined) payload[f] = args[f];
    }

    try {
      const result = await runnerFetch(runner.url, runner.secret, "/browser", payload, (Number(args.timeout ?? 30000)) + 5000) as Record<string, unknown>;
      if (!result.ok) return `Browser error: ${result.error ?? JSON.stringify(result)}`;

      const parts: string[] = [`Action: ${action} — OK`];
      if (result.url) parts.push(`URL: ${result.url}`);
      if (result.title) parts.push(`Title: ${result.title}`);
      if (result.message) parts.push(String(result.message));
      if (result.text) parts.push(`Text content:\n${String(result.text).slice(0, 10000)}`);
      if (result.html) parts.push(`HTML:\n${String(result.html).slice(0, 20000)}`);
      if (result.result !== undefined) parts.push(`Result: ${result.result}`);
      if (result.elements) parts.push(`Elements found: ${JSON.stringify(result.elements).slice(0, 5000)}`);
      if (result.value !== undefined) parts.push(`Attribute value: ${result.value}`);
      if (result.cookies) parts.push(`Cookies: ${JSON.stringify(result.cookies).slice(0, 2000)}`);
      if (result.screenshot) parts.push(`[Screenshot captured — base64 PNG, ${String(result.screenshot).length} chars]`);

      return parts.join("\n");
    } catch (e) {
      return `Browser action failed: ${String(e)}`;
    }
  }

  if (name === "list_local_dir") {
    const dir = String(args.dir ?? args.path ?? ".");
    const runner = await getRunnerConfig(supabase);
    if (!runner) return "[RUNNER NOT CONNECTED] Cannot list local files without runner.";
    try {
      const result = await runnerFetch(runner.url, runner.secret, "/ls", {
        projectId: String(projectId),
        dir,
      }) as { entries: { name: string; type: string; path: string }[] };
      if (result.entries.length === 0) return `Directory ${dir} is empty`;
      return result.entries.map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path}`).join("\n");
    } catch (e) {
      return `Failed to list ${dir}: ${String(e)}`;
    }
  }

  return `Unknown tool: ${name}`;
}

const GEMINI_TOOL_DECLARATIONS = [
  { name: "write_file", description: "Create or overwrite a file with complete content", parameters: { type: "OBJECT", properties: { path: { type: "STRING" }, content: { type: "STRING" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Make a targeted edit by replacing exact text in a file. Faster than rewriting whole files.", parameters: { type: "OBJECT", properties: { path: { type: "STRING" }, old_str: { type: "STRING", description: "Exact text to replace" }, new_str: { type: "STRING", description: "Replacement text" } }, required: ["path", "old_str", "new_str"] } },
  { name: "batch_write_files", description: "Write multiple files at once. Use for creating full projects.", parameters: { type: "OBJECT", properties: { files: { type: "ARRAY", items: { type: "OBJECT", properties: { path: { type: "STRING" }, content: { type: "STRING" } }, required: ["path", "content"] } } }, required: ["files"] } },
  { name: "read_file", description: "Read a file's content", parameters: { type: "OBJECT", properties: { path: { type: "STRING" } }, required: ["path"] } },
  { name: "delete_file", description: "Delete a file", parameters: { type: "OBJECT", properties: { path: { type: "STRING" } }, required: ["path"] } },
  { name: "rename_file", description: "Rename or move a file", parameters: { type: "OBJECT", properties: { old_path: { type: "STRING" }, new_path: { type: "STRING" } }, required: ["old_path", "new_path"] } },
  { name: "list_files", description: "List all project files", parameters: { type: "OBJECT", properties: {} } },
  { name: "search_files", description: "Search file names by pattern", parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
  { name: "grep", description: "Search file contents for a pattern", parameters: { type: "OBJECT", properties: { pattern: { type: "STRING" }, path: { type: "STRING", description: "Optional: limit to specific file" } }, required: ["pattern"] } },
  { name: "browse_website", description: "Fetch and read any website, docs, GitHub, or API endpoint. Use after web_search to read a specific page.", parameters: { type: "OBJECT", properties: { url: { type: "STRING" } }, required: ["url"] } },
  { name: "web_search", description: "Search the web for current info, docs, packages, APIs, research. Use FIRST before browse_website.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Search query" }, num_results: { type: "NUMBER", description: "Number of results (default 8)" } }, required: ["query"] } },
  { name: "run_command", description: "Execute a real shell command on the connected runner (npm install, python, git, etc). Returns actual output.", parameters: { type: "OBJECT", properties: { command: { type: "STRING" }, cwd: { type: "STRING", description: "Working directory (optional)" }, timeout: { type: "NUMBER", description: "Timeout in ms (default 30000)" } }, required: ["command"] } },
  { name: "install_package", description: "Install packages via npm/pip/yarn/pnpm. Faster than run_command for package installs.", parameters: { type: "OBJECT", properties: { packages: { type: "ARRAY", items: { type: "STRING" }, description: "Package names to install" }, manager: { type: "STRING", description: "npm | pip | pip3 | yarn | pnpm (default npm)" } }, required: ["packages"] } },
  { name: "execute_code", description: "Execute code in a given language and return the real output. Supports python, javascript, bash, ruby, go.", parameters: { type: "OBJECT", properties: { code: { type: "STRING" }, language: { type: "STRING", description: "python | javascript | bash | ruby | go" }, stdin: { type: "STRING", description: "Optional stdin input" } }, required: ["code", "language"] } },
  { name: "read_local_file", description: "Read a file from the runner's local filesystem (the server/droplet disk).", parameters: { type: "OBJECT", properties: { path: { type: "STRING" } }, required: ["path"] } },
  { name: "write_local_file", description: "Write a file to the runner's local filesystem.", parameters: { type: "OBJECT", properties: { path: { type: "STRING" }, content: { type: "STRING" } }, required: ["path", "content"] } },
  { name: "list_local_dir", description: "List files in the runner's local filesystem.", parameters: { type: "OBJECT", properties: { dir: { type: "STRING", description: "Directory path (default .)" } } } },
  {
    name: "browser_action",
    description: "Control a real Chromium browser via Puppeteer on the connected runner. Use for DOM manipulation, scraping JS-rendered pages, form filling, clicking buttons, running scripts in page context. Actions: launch, navigate, get_text, get_html, click, type, fill, select, scroll, evaluate, screenshot, wait_for, hover, press_key, query_all, get_attribute, get_cookies, set_cookies, current_url, close.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "One of: launch | navigate | get_text | get_html | click | type | fill | select | scroll | evaluate | screenshot | wait_for | hover | press_key | query_all | get_attribute | get_cookies | set_cookies | current_url | close" },
        sessionId: { type: "STRING", description: "Browser session ID (default: 'default'). Use same ID across actions to keep browser open." },
        url: { type: "STRING", description: "URL to navigate to (navigate action)" },
        selector: { type: "STRING", description: "CSS selector to target an element" },
        value: { type: "STRING", description: "Value for type/fill/select actions, or key name for press_key" },
        script: { type: "STRING", description: "JavaScript code to evaluate in page context (evaluate action)" },
        x: { type: "NUMBER", description: "X coordinate for click/scroll" },
        y: { type: "NUMBER", description: "Y coordinate for click/scroll" },
        waitFor: { type: "STRING", description: "For wait_for: CSS selector, 'navigation', or number of ms" },
        attribute: { type: "STRING", description: "Attribute name for get_attribute action" },
        fullPage: { type: "BOOLEAN", description: "Take full-page screenshot (screenshot action)" },
        timeout: { type: "NUMBER", description: "Timeout in ms (default 30000)" },
      },
      required: ["action"],
    },
  },
];

const ANTHROPIC_TOOLS = [
  { name: "write_file", description: "Create or overwrite a file with complete content", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Make a targeted edit by replacing exact text. Use for small changes.", input_schema: { type: "object", properties: { path: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" } }, required: ["path", "old_str", "new_str"] } },
  { name: "batch_write_files", description: "Write multiple files at once", input_schema: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }, required: ["files"] } },
  { name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "delete_file", description: "Delete a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "rename_file", description: "Rename or move a file", input_schema: { type: "object", properties: { old_path: { type: "string" }, new_path: { type: "string" } }, required: ["old_path", "new_path"] } },
  { name: "list_files", description: "List all project files", input_schema: { type: "object", properties: {} } },
  { name: "search_files", description: "Search file names", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "grep", description: "Search file contents for a pattern", input_schema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } },
  { name: "browse_website", description: "Fetch and read any website, docs, GitHub, or API endpoint.", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "web_search", description: "Search the web for current info, docs, packages, APIs, research. Use FIRST before browse_website.", input_schema: { type: "object", properties: { query: { type: "string" }, num_results: { type: "number" } }, required: ["query"] } },
  { name: "run_command", description: "Execute a real shell command on the connected runner. Returns actual output.", input_schema: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeout: { type: "number" } }, required: ["command"] } },
  { name: "install_package", description: "Install packages via npm/pip/yarn/pnpm.", input_schema: { type: "object", properties: { packages: { type: "array", items: { type: "string" } }, manager: { type: "string" } }, required: ["packages"] } },
  { name: "execute_code", description: "Execute code in python/javascript/bash/ruby/go and return real output.", input_schema: { type: "object", properties: { code: { type: "string" }, language: { type: "string" }, stdin: { type: "string" } }, required: ["code", "language"] } },
  { name: "read_local_file", description: "Read a file from the runner's local filesystem.", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_local_file", description: "Write a file to the runner's local filesystem.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "list_local_dir", description: "List files in the runner's local filesystem.", input_schema: { type: "object", properties: { dir: { type: "string" } } } },
  { name: "browser_action", description: "Control a real Chromium browser via Puppeteer. Use for DOM manipulation, JS-rendered page scraping, form filling, clicking, running scripts in page context. Actions: launch, navigate, get_text, get_html, click, type, fill, select, scroll, evaluate, screenshot, wait_for, hover, press_key, query_all, get_attribute, get_cookies, set_cookies, current_url, close.", input_schema: { type: "object", properties: { action: { type: "string", description: "launch|navigate|get_text|get_html|click|type|fill|select|scroll|evaluate|screenshot|wait_for|hover|press_key|query_all|get_attribute|get_cookies|set_cookies|current_url|close" }, sessionId: { type: "string" }, url: { type: "string" }, selector: { type: "string" }, value: { type: "string" }, script: { type: "string" }, x: { type: "number" }, y: { type: "number" }, waitFor: { type: "string" }, attribute: { type: "string" }, fullPage: { type: "boolean" }, timeout: { type: "number" } }, required: ["action"] } },
];

const OPENAI_TOOLS = [
  { type: "function", function: { name: "write_file", description: "Create or overwrite a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "edit_file", description: "Make a targeted edit by replacing exact text", parameters: { type: "object", properties: { path: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" } }, required: ["path", "old_str", "new_str"] } } },
  { type: "function", function: { name: "batch_write_files", description: "Write multiple files at once", parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }, required: ["files"] } } },
  { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "delete_file", description: "Delete a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "rename_file", description: "Rename or move a file", parameters: { type: "object", properties: { old_path: { type: "string" }, new_path: { type: "string" } }, required: ["old_path", "new_path"] } } },
  { type: "function", function: { name: "list_files", description: "List all files", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_files", description: "Search file names", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "grep", description: "Search file contents", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "browse_website", description: "Fetch and read any website, docs, GitHub, or API endpoint.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "web_search", description: "Search the web for current info, docs, packages, APIs, research.", parameters: { type: "object", properties: { query: { type: "string" }, num_results: { type: "number" } }, required: ["query"] } } },
  { type: "function", function: { name: "run_command", description: "Execute a real shell command on the connected runner. Returns actual output.", parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string" }, timeout: { type: "number" } }, required: ["command"] } } },
  { type: "function", function: { name: "install_package", description: "Install packages via npm/pip/yarn/pnpm.", parameters: { type: "object", properties: { packages: { type: "array", items: { type: "string" } }, manager: { type: "string" } }, required: ["packages"] } } },
  { type: "function", function: { name: "execute_code", description: "Execute code in python/javascript/bash/ruby/go and return real output.", parameters: { type: "object", properties: { code: { type: "string" }, language: { type: "string" }, stdin: { type: "string" } }, required: ["code", "language"] } } },
  { type: "function", function: { name: "read_local_file", description: "Read a file from the runner's local filesystem.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_local_file", description: "Write a file to the runner's local filesystem.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "list_local_dir", description: "List files in the runner's local filesystem.", parameters: { type: "object", properties: { dir: { type: "string" } } } } },
  { type: "function", function: { name: "browser_action", description: "Control a real Chromium browser via Puppeteer. Use for DOM manipulation, JS-rendered scraping, form filling, clicking, running scripts in page context. Actions: launch, navigate, get_text, get_html, click, type, fill, select, scroll, evaluate, screenshot, wait_for, hover, press_key, query_all, get_attribute, get_cookies, set_cookies, current_url, close.", parameters: { type: "object", properties: { action: { type: "string", description: "launch|navigate|get_text|get_html|click|type|fill|select|scroll|evaluate|screenshot|wait_for|hover|press_key|query_all|get_attribute|get_cookies|set_cookies|current_url|close" }, sessionId: { type: "string" }, url: { type: "string" }, selector: { type: "string" }, value: { type: "string" }, script: { type: "string" }, x: { type: "number" }, y: { type: "number" }, waitFor: { type: "string" }, attribute: { type: "string" }, fullPage: { type: "boolean" }, timeout: { type: "number" } }, required: ["action"] } } },
];

async function runGemini(ctrl: ReadableStreamDefaultController, message: string, history: { role: string; content: string }[], system: string, model: string, key: string, mode: string, supabase: ReturnType<typeof createClient>, projectId: number, files: ProjectFile[]) {
  const tools = mode === "agent" ? [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }] : undefined;
  const contents = [
    ...history.slice(-10).map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { contents, systemInstruction: { parts: [{ text: system }] }, generationConfig: buildGenerationConfig() };
    if (tools) body.tools = tools;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { send(ctrl, { type: "error", content: `Gemini API error: ${await res.text()}` }); break; }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const textParts = parts.filter((p: { text?: string }) => p.text);
    const toolCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall);
    if (textParts.length) send(ctrl, { type: "message", content: textParts.map((p: { text: string }) => p.text).join("") });
    if (!toolCalls.length) break;
    const toolResults = [];
    for (const part of toolCalls) {
      const { name, args } = part.functionCall;
      const id = crypto.randomUUID();
      send(ctrl, { type: "tool_call", id, tool: name, args });
      const result = await executeTool(name, args, supabase, projectId, files, ctrl).catch(String);
      send(ctrl, { type: "tool_result", id, tool: name, result });
      toolResults.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: "model", parts });
    contents.push({ role: "user", parts: toolResults });
  }
}

async function runVertex(ctrl: ReadableStreamDefaultController, message: string, history: { role: string; content: string }[], system: string, model: string, key: string, mode: string, supabase: ReturnType<typeof createClient>, projectId: number, files: ProjectFile[]) {
  const tools = mode === "agent" ? [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }] : undefined;
  const contents = [
    ...history.slice(-10).map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { contents, systemInstruction: { parts: [{ text: system }] }, generationConfig: buildGenerationConfig() };
    if (tools) body.tools = tools;
    const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:streamGenerateContent?key=${key}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { send(ctrl, { type: "error", content: `Vertex AI error: ${await res.text()}` }); break; }
    const rawText = await res.text();
    let chunks: unknown[] = [];
    try { const parsed = JSON.parse(rawText); chunks = Array.isArray(parsed) ? parsed : [parsed]; }
    catch { send(ctrl, { type: "error", content: "Vertex AI: failed to parse response" }); break; }
    let allText = "";
    const allToolCalls: { functionCall: { name: string; args: Record<string, unknown> } }[] = [];
    let allParts: unknown[] = [];
    for (const chunk of chunks) {
      const parts = (chunk as { candidates?: { content?: { parts?: unknown[] } }[] }).candidates?.[0]?.content?.parts ?? [];
      allParts = [...allParts, ...parts];
      for (const p of parts as { text?: string; functionCall?: { name: string; args: Record<string, unknown> } }[]) {
        if (p.text) allText += p.text;
        if (p.functionCall) allToolCalls.push({ functionCall: p.functionCall });
      }
    }
    if (allText) send(ctrl, { type: "message", content: allText });
    if (!allToolCalls.length) break;
    const toolResults = [];
    for (const part of allToolCalls) {
      const { name, args } = part.functionCall;
      const id = crypto.randomUUID();
      send(ctrl, { type: "tool_call", id, tool: name, args });
      const result = await executeTool(name, args, supabase, projectId, files, ctrl).catch(String);
      send(ctrl, { type: "tool_result", id, tool: name, result });
      toolResults.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: "model", parts: allParts });
    contents.push({ role: "user", parts: toolResults });
  }
}

async function runAnthropic(ctrl: ReadableStreamDefaultController, message: string, history: { role: string; content: string }[], system: string, model: string, key: string, mode: string, supabase: ReturnType<typeof createClient>, projectId: number, files: ProjectFile[]) {
  const tools = mode === "agent" ? ANTHROPIC_TOOLS : undefined;
  const messages: unknown[] = [...history.slice(-10).map((h) => ({ role: h.role as "user" | "assistant", content: h.content })), { role: "user", content: message }];
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { model, max_tokens: 8192, system, messages };
    if (tools) body.tools = tools;
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    if (!res.ok) { send(ctrl, { type: "error", content: `Anthropic API error: ${await res.text()}` }); break; }
    const data = await res.json();
    const content = data.content ?? [];
    const textBlocks = content.filter((b: { type: string }) => b.type === "text");
    const toolBlocks = content.filter((b: { type: string }) => b.type === "tool_use");
    if (textBlocks.length) send(ctrl, { type: "message", content: textBlocks.map((b: { text: string }) => b.text).join("") });
    if (!toolBlocks.length || data.stop_reason === "end_turn") { if (!toolBlocks.length) break; }
    messages.push({ role: "assistant", content });
    const toolResults = [];
    for (const block of toolBlocks) {
      send(ctrl, { type: "tool_call", id: block.id, tool: block.name, args: block.input });
      const result = await executeTool(block.name, block.input, supabase, projectId, files, ctrl).catch(String);
      send(ctrl, { type: "tool_result", id: block.id, tool: block.name, result });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
    if (data.stop_reason === "end_turn") break;
  }
}

async function runOpenAI(ctrl: ReadableStreamDefaultController, message: string, history: { role: string; content: string }[], system: string, model: string, key: string, mode: string, supabase: ReturnType<typeof createClient>, projectId: number, files: ProjectFile[]) {
  const tools = mode === "agent" ? OPENAI_TOOLS : undefined;
  const messages: unknown[] = [{ role: "system", content: system }, ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })), { role: "user", content: message }];
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { model, messages, max_tokens: 8192 };
    if (tools) { body.tools = tools; body.tool_choice = "auto"; }
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify(body) });
    if (!res.ok) { send(ctrl, { type: "error", content: `OpenAI API error: ${await res.text()}` }); break; }
    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) break;
    const asst = choice.message;
    const toolCalls = asst.tool_calls ?? [];
    if (asst.content) send(ctrl, { type: "message", content: asst.content });
    if (!toolCalls.length || choice.finish_reason === "stop") { if (!toolCalls.length) break; }
    messages.push({ ...asst, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch {}
      send(ctrl, { type: "tool_call", id: tc.id, tool: tc.function.name, args });
      const result = await executeTool(tc.function.name, args, supabase, projectId, files, ctrl).catch(String);
      send(ctrl, { type: "tool_result", id: tc.id, tool: tc.function.name, result });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result, name: tc.function.name });
    }
    if (choice.finish_reason === "stop") break;
  }
}
