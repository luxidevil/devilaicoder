# LUXI IDE

## Overview

LUXI is a powerful AI coding IDE that supports multiple AI providers (Gemini, Claude, OpenAI) with an autonomous agent capable of building full projects. Built as a pnpm workspace monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Editor**: Monaco Editor
- **Terminal**: xterm.js + WebSocket
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

### Artifacts
- **api-server** (`artifacts/api-server`): Express API server on port from `PORT` env var. Routes: projects CRUD, files CRUD, AI chat (streaming SSE), AI agent (tool-calling loop), admin settings, terminal WebSocket.
- **luxi-ide** (`artifacts/luxi-ide`): React + Vite frontend at previewPath `/`. Pages: Home (project list), IDE (Monaco editor + file tree + chat + terminal), Admin (multi-provider settings).

### Libraries
- **db** (`lib/db`): Drizzle ORM schema — tables: projects, files, conversations, messages, settings, ai_requests
- **api-spec** (`lib/api-spec`): OpenAPI spec
- **api-client-react** (`lib/api-client-react`): Generated React Query hooks via Orval
- **api-zod** (`lib/api-zod`): Generated Zod schemas

### AI Provider System
Multi-provider abstraction in `artifacts/api-server/src/lib/ai-providers.ts`:
- Supports **Gemini**, **Anthropic Claude**, and **OpenAI**
- Unified interfaces for both streaming chat and agent tool-calling
- Provider selection and API keys stored in `settings` table
- Admin panel at `/admin` (credentials: LUXI/LUXI) for configuring provider, model, and API keys

### Agent Filesystem Architecture (CRITICAL)
Each project has a real filesystem directory at `/home/runner/projects/{projectId}/`.
- All file operations (write_file, create_file, edit_file, delete_file) dual-write to BOTH the database AND the filesystem
- All execution tools (run_command, install_package, manage_process) run commands IN the project directory
- On agent start, all DB files are synced to disk; on agent end, new disk-only files (e.g. package-lock.json) are synced back to DB
- `read_file` can read from DB, project disk, or absolute paths
- `list_files` shows both DB files and disk-only files
- This means the agent can build real apps: write code, install dependencies, start servers, and test them

### Agent Capabilities (26 tools, 200 iterations max)
The autonomous agent (`artifacts/api-server/src/routes/ai/agent.ts`) has:
- Planning: think (structured reasoning), todowrite (task tracking visible to user), project_memory (persistent context across conversations)
- File operations: list, read, write, create, delete, edit, batch_write_files, search, find & replace, parse
- Search: grep (real filesystem grep with regex), search_files (DB search)
- Execution: run_command (2-min timeout), shell (multi-command sequential execution), install_package (3-min timeout), manage_process, read_logs
- Web: browse_website, web_search, download_file
- Testing: check_port (auto-opens live preview on success), test_api
- Deployment: deploy_ssh (deploy to any server via SSH using ssh2 — tar+upload+extract+run setup commands)
- Version control: git_operation

### Agent Performance Optimizations (Claude Code inspired)
- 200 iteration limit (up from 50) — agent never gives up
- Parallel tool execution: read-only tools (think, todowrite, read_file, grep, list_files, project_memory, etc.) run concurrently via Promise.all
- Smart output compaction: large command outputs keep head+tail, file reads truncate with char count
- Context compression: when conversation exceeds 40 turns, older turns are dropped with a compression note
- batch_write_files: write multiple files in a single tool call for faster project scaffolding
- Exponential backoff for rate limits (5s → 10s → 20s → 40s → 60s), up to 5 retries
- Project memory: .luxi/memory.md persists architectural decisions across conversations
- Todo tracking: agent shows its task list to the user, updates as it completes steps
- Shell tool: execute multiple commands in sequence (faster than multiple run_command calls)
- Professional execution engine prompt: agent framed as a compiler/tutor, no refusal language
- SSH auto-deploy: when user configures SSH credentials, agent auto-deploys to their server after every build

### AI Provider Format Conversions
- Agent internally uses Gemini's content format (role/parts with functionCall/functionResponse)
- For Anthropic/OpenAI: `convertContentsToAnthropic` and `convertContentsToOpenAI` generate unique sequential tool call IDs (`call_0`, `call_1`, ...) and use positional matching between model functionCall parts and user functionResponse parts
- Reasoning models (o3/o4/o1): skip `max_completion_tokens` parameter

### IDE Frontend
- Agent/Chat mode switcher in the right panel
- Editor watches `selectedFile.content` + `updatedAt` with `isUserEditingRef`/`userEditTimeRef` to avoid overwriting user edits during agent writes
- File list polls every 3 seconds for agent-created files
- Agent panel supports file attachment (drag & drop or click) for HAR/JSON/CSV analysis
- Live preview pane: auto-opens when agent's check_port succeeds, shows the running app in an iframe
- preview_port event: agent emits this when a port check passes → frontend auto-sets URL and opens preview (local mode)
- preview_url event: agent emits this after SSH auto-deploy → frontend shows the live deployed URL in the preview pane
- Preview has refresh button, URL bar, and close button
- SSH Settings dialog: accessible via Server icon in toolbar. User can configure SSH host, port, username, password/key, remote path, and domain. When configured, all agent builds auto-deploy to the server.

### Terminal
WebSocket terminal at `/api/ws/terminal` using node-pty for real shell access.

## Production Deployment

LUXI IDE is deployed on a DigitalOcean VPS at **143.110.189.154**:
- **Server**: Ubuntu 24.04, 8GB RAM, 154GB disk
- **Stack**: Node.js 20, pnpm, PostgreSQL 16, nginx, PM2
- **App path**: `/opt/luxi-ide/`
- **Database**: `postgres://luxi:***@localhost:5432/luxi_db`
- **PM2 config**: `/opt/luxi-ide/ecosystem.config.cjs`
- **Nginx config**: `/etc/nginx/sites-available/luxi-ide`
- **PM2 auto-starts** on server reboot via `pm2 startup`
- **Frontend**: Built with Vite, served as static files by Express in production mode
- **SPA routing**: Express middleware catches all non-API routes and serves `index.html`
- **WebSocket**: nginx configured with `Upgrade` and `Connection` headers for terminal WS
- **Express v5 note**: Uses `app.use()` middleware for SPA fallback instead of `app.get("*")` (Express v5 path-to-regexp v8 doesn't support bare `*`)

### Deploy Commands
```bash
# SSH into server
ssh root@143.110.189.154
# PM2 commands
pm2 restart luxi-api
pm2 logs luxi-api
pm2 list
# Rebuild on server
cd /opt/luxi-ide && pnpm --filter @workspace/api-server run build
PORT=3000 BASE_PATH="/" pnpm --filter @workspace/luxi-ide run build
pm2 restart luxi-api
```

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Database Schema

Tables: projects (name, description, language, sshHost, sshUser, sshPort, sshPassword, sshKey, sshRemotePath, sshDomain, createdAt, updatedAt), files (projectId, name, path, content, language), conversations (projectId, title), messages (conversationId, role, content, toolCalls), settings (key, value), ai_requests (projectId, createdAt)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
