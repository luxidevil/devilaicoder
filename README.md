# LUXI IDE

LUXI IDE is a Mongo-backed AI coding workspace with:

- a React + Vite frontend
- an Express API for auth, projects, docs, secrets, credits, and AI orchestration
- a separate Node runner for shell execution, package installs, dev servers, and browser automation

The product is prompt-first: a user can start from a plain-English prompt, land in a fresh project, and let the agent build, edit, run, and test code inside the workspace.

## What It Does

- Email/password auth with JWT sessions
- Project dashboard with prompt-first project creation
- Monaco editor with autosave, tabs, and file search
- AI chat panel with `Build`, `Research`, and `Autofix` modes
- Project docs panel with manual notes plus text-file import into AI context
- Project secrets storage
- Admin pages for AI provider settings, runner settings, users, and credits
- Runner-backed terminal, dev server, deploy, and browser automation tools
- ZIP export

## Stack

### Frontend

- React 18
- Vite
- TanStack Query
- Wouter
- Monaco editor
- Framer Motion
- Tailwind-style utility classes

### Backend

- Node.js
- Express 5
- MongoDB + Mongoose
- JWT auth
- SSE streaming for agent output

### Runner

- Node.js HTTP server
- Shell execution for project sandboxes
- Puppeteer-backed browser automation

## Repository Layout

```text
src/                Frontend app
server/             Express API and Mongo models
runner/             Shell + browser automation service
supabase/           Legacy Supabase artifacts kept from earlier versions
CODEX.md            Project handoff / architecture memory for future Codex runs
```

Key entrypoints:

- `src/App.tsx`
- `src/pages/Home.tsx`
- `src/pages/IDE.tsx`
- `server/index.js`
- `server/lib/ai.js`
- `runner/server.js`

## How The App Works

### Frontend flow

1. Users sign in through the React app.
2. The home screen can create a blank project, a template project, or a prompt-driven project.
3. The IDE loads project files, docs, runner config, and agent context.
4. The agent streams tool events and messages back over `/api/ai/stream`.

### Backend flow

- Auth is handled with JWT bearer tokens.
- Projects, files, conversations, docs, settings, secrets, and credits are stored in Mongo.
- Admin-configured provider keys are stored in the `Setting` collection.
- Project secrets are stored per project in `ProjectSecret`.
- Secret values are encrypted at rest before being saved to Mongo.

### Runner flow

- The runner creates a temp sandbox per project under a shared work directory.
- Files are synced from Mongo-backed project storage into that sandbox.
- The runner can:
  - execute shell commands
  - install packages
  - read and write sandbox files
  - drive a real Chromium browser through Puppeteer

## Supported AI Providers

The backend currently supports:

- Gemini
- Anthropic
- OpenAI
- Vertex

Platform keys are configured from the Admin panel. Users can also supply their own supported keys through the UI.

## Local Development

### Prerequisites

- Node.js 20+
- npm
- MongoDB connection string

### 1. Install dependencies

```bash
npm install
cd runner && npm install
```

### 2. Configure environment variables

Create a local `.env` in the project root using `.env.example`:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database-name
JWT_SECRET=replace-with-a-long-random-string
SECRET_ENCRYPTION_KEY=replace-with-another-long-random-string
PORT=3001
VITE_API_BASE_URL=http://localhost:3001/api
```

Notes:

- `SECRET_ENCRYPTION_KEY` is used for encrypted secret storage.
- If `SECRET_ENCRYPTION_KEY` is omitted, the app falls back to `JWT_SECRET`.

### 3. Start the API

```bash
npm run dev:server
```

Default API URL:

- `http://localhost:3001`

### 4. Start the frontend

```bash
npm run dev
```

Default frontend URL:

- `http://localhost:3000`

The Vite dev server proxies `/api` to `http://localhost:3001`.

### 5. Start the runner

Recommended local command:

```bash
PORT=3212 node runner/server.js
```

Useful runner environment variables:

```bash
PORT=3212
LUXI_RUNNER_SECRET=your-runner-secret
WORK_DIR=/tmp/luxi-runner
```

Default runner health endpoint:

- `http://127.0.0.1:3212/health`

### 6. Configure the runner in Admin

In the Admin panel, set:

- Runner URL: `http://127.0.0.1:3212`
- Runner Secret: your `LUXI_RUNNER_SECRET` value, if you enabled one

### 7. Configure an AI provider

In Admin -> AI Settings, set at least one provider key and model before using the platform agent.

## Common Scripts

```bash
npm run dev          # frontend dev server
npm run dev:server   # backend dev server
npm run dev:full     # frontend + backend together
npm run build        # production build
npm run preview      # preview built frontend
```

## Browser Automation Notes

Browser automation is handled by the runner, not by the frontend or API directly.

The browser tool can:

- navigate
- click / smart_click / type / fill / smart_fill_form
- apply high-level DOM mutations with `dom_mutate`
- inspect HTML and text
- run page JS with `evaluate`
- inspect frames and logs
- detect blockers with `challenge_status` (CAPTCHA/human verification/access blocks/rate limits)
- take screenshots
- auto-retry flaky actions with `retries` and `retryDelayMs`

If a browser action fails, check:

1. the runner is running
2. the runner URL is configured correctly
3. the target app is actually listening on the requested port
4. `challenge_status` is not reporting anti-bot or verification blockers

Example:

- if the agent opens `http://localhost:8000` and nothing is listening there, the real browser error will be `ERR_CONNECTION_REFUSED`

## Docs And Imported Text Files

The `Docs` tab lets users:

- create manual project docs
- edit and delete docs
- import text files such as `.txt`, `.md`, `.json`, `.csv`, `.log`, `.xml`, and source files

Imported docs are included in agent context automatically.

## Auth And Roles

- The first created user becomes admin.
- The first created user also gets the `unlimited` tier by default.
- Other users default to the `free` tier with starter credits.

## Known Limitations

- The runner must be running for terminal, dev server, deploy, and browser actions to work.
- Browser automation cannot solve OTP, inbox verification, or CAPTCHA flows on its own.
- Some third-party websites may detect or block automated browsers; when this happens, use `challenge_status` + `logs` and keep the same session for any manual verification handoff.
- The repo still contains a `supabase/` directory and `@supabase/supabase-js` dependency from earlier versions, even though the active app is Mongo-backed.

## Security Notes

- Platform keys and project secrets are encrypted at rest in Mongo.
- Do not commit real secrets into the repo.
- Do not paste production secrets into chat logs.

One important current caveat:

- the runner configuration, including `runner_secret`, is still exposed to authenticated frontend clients so browser panels can talk to the runner directly

That design should be tightened before treating this as a hardened multi-tenant production system.

## Build Status

The current codebase builds successfully with:

```bash
npm run build
```

## Suggested Next Improvements

- move runner access fully behind the backend instead of exposing `runner_secret` to clients
- add preflight checks before browser automation starts
- add a proper GitHub integration
- add a `.gitignore` before the first public push
- add automated tests around auth, runner integration, and agent flows
