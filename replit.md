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

### Agent Capabilities (19 tools)
The autonomous agent (`artifacts/api-server/src/routes/ai/agent.ts`) has:
- File operations: list, read, write, create, delete, edit, search, find & replace, parse
- Execution: run_command, install_package (3-min timeout), manage_process, read_logs
- Web: browse_website, web_search, download_file
- Testing: check_port, test_api
- Version control: git_operation

### AI Provider Format Conversions
- Agent internally uses Gemini's content format (role/parts with functionCall/functionResponse)
- For Anthropic/OpenAI: `convertContentsToAnthropic` and `convertContentsToOpenAI` generate unique sequential tool call IDs (`call_0`, `call_1`, ...) and use positional matching between model functionCall parts and user functionResponse parts
- Reasoning models (o3/o4/o1): skip `max_completion_tokens` parameter

### IDE Frontend
- Agent/Chat mode switcher in the right panel
- Editor watches `selectedFile.content` + `updatedAt` with `isUserEditingRef`/`userEditTimeRef` to avoid overwriting user edits during agent writes
- File list polls every 3 seconds for agent-created files
- Agent panel supports file attachment (drag & drop or click) for HAR/JSON/CSV analysis

### Terminal
WebSocket terminal at `/api/ws/terminal` using node-pty for real shell access.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Database Schema

Tables: projects (name, description, createdAt, updatedAt), files (projectId, name, path, content, language), conversations (projectId, title), messages (conversationId, role, content, toolCalls), settings (key, value), ai_requests (projectId, createdAt)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
