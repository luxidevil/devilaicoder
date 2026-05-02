# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

This workspace hosts **LUXI IDE** — an AI coding IDE (Cursor / Replit / Bolt class) with multi-provider AI, project checkpoints, per-project secrets, and GitHub integration.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind v4, Monaco editor, xterm.js

## Artifacts

- `artifacts/api-server` — Express API (port 8080, mounted at `/api`)
- `artifacts/luxi-ide` — IDE frontend (port 22320, mounted at `/`)
- `artifacts/mockup-sandbox` — design canvas (separate)

## Features (LUXI IDE)

- **Multi-provider AI** (26 providers, ~89 free model entries):
  - **Premium**: OpenAI, Anthropic, Google Gemini AI Studio, **Google Vertex AI (GCP Express Mode)**, xAI Grok, Mistral, Moonshot Kimi, DeepSeek, Together, Fireworks, Perplexity (online).
  - **Free / generous tier**: Groq, Cerebras, OpenRouter, **GitHub Models**, **Hugging Face**, **Cloudflare Workers AI**, **SambaNova Cloud**, **NVIDIA NIM**, **Hyperbolic**, **Cohere** (compatibility), **Zhipu GLM**, **Qwen DashScope**, **Pollinations** (no key required).
  - **Local**: Ollama. **Custom**: any OpenAI-compatible endpoint.
  - Configured via Admin (`/admin`, basic auth `LUXI:LUXI`). Settings keyed as `ai_provider`, `ai_model`, `{provider}_api_key`, `{provider}_base_url`, `{provider}_model`, `ai_fallback_provider`. Each provider supports an editable base URL where relevant (Vertex region, Cloudflare account ID, DashScope intl/cn).
  - **Vertex AI** uses Express Mode (API key only, no project ID required), routed through the same Gemini API path with `aiplatform.googleapis.com/v1beta1/publishers/google` as the default base URL.
  - Built-in fallback: if the active provider fails (5xx/429/network), the system retries once and then transparently switches to the configured `ai_fallback_provider`.
- **Agent tools (45 total)**: editing/exec (read/write/edit files, run_command, shell, install_package, manage_process), web (browse_website, web_search, parse_file), deploy (deploy_ssh, git_operation), and **debugging / reverse-engineering**: analyze_stacktrace, code_outline, find_references, find_definition, apply_patch, run_tests (vitest/jest/mocha/pytest/go/cargo/npm), run_typecheck (tsc/mypy/pyright/cargo/go), run_linter (eslint/ruff/clippy/golangci-lint), dep_graph, inspect_binary (file/strings/nm/readelf/ldd/od), process_tree, network_status, db_query (read-only enforced via keyword block + `BEGIN READ ONLY ... ROLLBACK` wrapper), http_trace, git_blame/git_log/git_diff, inspect_archive (tar/zip/deb with zip-slip + symlink/hardlink rejection), decode_data.
- **Auth**: every `/api/*` route except `/api/healthz`/`/api/health` requires Basic auth against `ADMIN_CREDS` (dev default `LUXI:LUXI`; in production the server refuses to start without `ADMIN_CREDS` set). Enforced server-side by `middlewares/admin-auth.ts` mounted globally in `app.ts`. The terminal WebSocket (`/api/ws/terminal`, `/ws/terminal`) requires an `Origin` header and the same Basic creds, accepted via either `Authorization` header or `?token=base64(user:pass)` query param. The frontend installs a global `window.fetch` interceptor (`lib/api-fetch.ts`) that injects the header from `localStorage`, prompts on 401, and persists creds; the terminal component reads the same stored creds and appends them as `?token=` when opening the WS.
- **Tool security**: all shell-touching tools use `execFile(bin, [args])` (no shell), with strict input validators (`asInt`, `asStr`, `asGitRef`, `asHttpMethod`); user-controlled strings cannot escape into the shell. Archive extraction sandboxes paths to the project dir, pre-validates entries, rejects symlinks/hardlinks, and writes ZIP entries one-by-one without `extractall`.
- **Per-project secrets** (`project_secrets` table): masked in UI, injected as plain env vars into agent commands and managed processes; values are **redacted** from all tool outputs/errors before reaching the UI or model.
- **Checkpoints / rollback** (`snapshots` table): manual or labeled snapshots of all project files. Restore is **transactional** (auto-snap → wipe → restore in one DB transaction) and falls back gracefully if disk-sync fails (HTTP 207 with `diskOk:false`). Auto-pruned to last 50 per project.
- **GitHub integration** (`GITHUB_PERSONAL_ACCESS_TOKEN` env, with `X-GitHub-Token` header override): list repos, clone, push, create-repo. All git invocations use `execFile` with arg arrays + strict `repoUrl`/`branch`/`name` validation. Tokens are scrubbed from error messages and stripped from `.git/config` after every clone/push (success and failure paths).
- **Process isolation**: managed processes live in `lib/process-manager.ts`, keyed by `${projectId}:${name}` with a 500-line rolling output buffer per process. `list/status/read_logs` are scoped to the calling project so secrets and outputs don't leak across projects. Process names are validated against `^[A-Za-z0-9._-]{1,64}$` at both the agent tool and REST layer. On project deletion, `killProjectProcesses(projectId)` SIGTERMs and reaps all entries to prevent orphaned children.
- **Live preview auto-detect**: when the agent calls `manage_process start`, the module's per-line output hook runs `extractListeningPort` on each stdout/stderr line. The first detected port is stored on the process entry and returned as `previewPort` so the IDE iframe opens automatically. This is a UI hint only — `verifiedListening` (the gate for auto-deploy) is still set exclusively by `check_port`'s real TCP probe.
- **Process REST + Processes panel**: `GET /api/projects/:id/processes` (list with port + uptime + last log line), `GET /api/projects/:id/processes/:name/logs?tail=N` (≤500 lines), `DELETE /api/projects/:id/processes/:name` (SIGTERM + reap). The IDE toolbar has a "Procs" button (Sheet) showing live status dots, port pills (click → open in preview), per-process log expansion, and stop buttons; polls every 2.5s when open / 5s when closed for the count badge.
- **Multiple chats per project**: each project can have many parallel conversations (already DB-backed via `conversations` + `messages` tables). The IDE toolbar has a "Chats" dropdown listing recent conversations with relative timestamps, current-chat checkmark, per-row delete, and a "New chat" button that creates a fresh conversation and clears the chat pane. Conversation message loading is race-protected via an incrementing `chatLoadRequestRef` so fast project/convo switches don't clobber each other.
- **Fix-with-AI on failed commands**: when a `run_command`, `install_package`, `shell`, or `manage_process` tool result starts with `Exit N:`, `Error:`, or `Command timed out` (the literal failure prefixes the agent server emits), the tool card shows a red "Fix with AI" button. Clicking it pre-fills the chat input with a markdown-formatted prompt containing the failed command and stderr (truncated to 1500 chars) so the agent can diagnose without the user retyping context.
- **Findings store** (`findings` table): per-project long-term research notebook (id, title, body up to 64KB, kind ∈ {note,vuln,ioc,credential,endpoint,binary,model,todo}, tags, timestamps; cascade-deletes with project; index on (project_id, updated_at); 1000-row cap per project). REST: `GET/POST /api/projects/:id/findings`, `GET /api/findings/:id`, `PATCH/DELETE /api/findings/:id`, `GET /api/projects/:id/findings/count`. Agent tools: `note_add`, `note_search` (free-text ilike with `%_\` escaped), `note_list`, `note_delete` — all scoped to caller's projectId from the closure (agent can't spoof). UI: `<FindingsPanel>` Sheet in the IDE toolbar with kind-color-coded badges, search, expandable bodies, and a count badge that polls every 8s.
- **`run_sandboxed` tool**: best-effort isolation for hostile binaries / untrusted code. Spawns a fresh tmp dir under `os.tmpdir()`, optionally copies project files in (rejects `..`, absolute paths, **symlinks**, and any path whose realpath escapes the project root), runs the command via `execFile("prlimit", [--as=N, --, "timeout", --signal=KILL, T, "bash", "-c", command], …)` — the argv-array form means `bash` receives the user command as a single `-c` argument with no outer shell layer to re-interpret `$vars` or backticks. Hard memory cap (`prlimit --as`, default 512MB, max 4GB), wall-clock timeout (default 30s, max 180s), and `http_proxy`/`https_proxy` env vars pointing at a dead loopback port to neutralize well-behaved network code. The tool description honestly states this is **not** a kernel-namespace sandbox (the container blocks `unshare`) — defense-in-depth, not a guarantee.
- **Senior-engineer RE playbook in the system prompt**: `RESEARCH MEMORY` section instructs the agent to `note_search` before non-trivial analysis and `note_add` after every reusable discovery. `DEEP REVERSE ENGINEERING` section gives explicit escalation ladders for: binary triage (inspect_binary → readelf/objdump/nm/strings → r2/uncompyle6/wabt), hostile binaries (route through `run_sandboxed`, never `run_command`), network capture (mitmproxy via `manage_process`), and ML model RE (transformers/safetensors via small streaming Python scripts; Jupyter on port 8888 via `manage_process` for interactive exploration).
- **Wave 8 — Knowledge tools (`web_search`, `cve_lookup`, `pcap_summary`) + `wabt` pre-install**:
  - `web_search` — DuckDuckGo HTML scrape (no API key). POST to `html.duckduckgo.com/html/`, parses `result__a` + `result__snippet` blocks, decodes the DDG `uddg=` redirect wrapper, returns top-N (default 8, max 20) `title + url + snippet` lines. Hard 12s timeout. Browser-shaped UA + Accept headers to avoid the bot-block path.
  - `cve_lookup` — NIST NVD v2 API (free, no key). Strict `CVE-YYYY-NNNN` regex on the input, 15s timeout, returns CVSS v3.1/v3.0/v2 (whichever is present) + base score + severity + vector, CWE classification, English description, and the top 8 references with their tags. 404s and missing records return clean error strings.
  - `pcap_summary` — runs pre-installed `tcpdump -nn -r <file> -c <max>` (default 5000, max 50000 packets, 30s timeout, 16MB buffer), parses each line for src/dst IPs+ports, DNS queries, and HTTP-ish lines, then returns top-10 talkers / dst ports / DNS queries plus any HTTP request lines. Path is project-relative or absolute.
  - Pre-installed `wabt` (`wasm2wat`, `wasm-objdump`, `wat2wasm`) so wasm RE no longer needs `npm install -g wabt` round-trip. System prompt updated with all three new tools at the top of the Knowledge / lookup section.
- **Wave 7 — Pre-installed RE toolchain + `http_request` tool + `inspect_binary` upgrade**:
  - Pre-installed via Nix (no more agent-side `install_package` for these): `radare2` / `r2`, `strace`, `ltrace`, `binwalk`, `mitmproxy` / `mitmdump`, `unzip`, `p7zip`, `socat`, `nmap`, `tcpdump`, `jq`. The system prompt now lists these as available-on-PATH and tells the agent to skip the install step.
  - `inspect_binary` now also runs `r2 -q -c iI/iiq/iEq` (info, imports, exports) and `binwalk` signature scan when those tools are present (auto-detected via `which`), so the very first triage call returns disassembly-grade context without follow-up commands.
  - New `http_request` agent tool: raw HTTP/HTTPS via `fetch`, `http://` or `https://` only (rejects `file://`, `gopher://`, etc.), supports method/headers (JSON object)/body, follow-redirects toggle, 1-30s timeout, 32KB response cap with content-type-aware text vs hex-preview rendering. Returns `HTTP <status> <statusText>\\n<headers>\\n\\n<body>` to the agent for direct reasoning over endpoint responses during RE / API discovery.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
