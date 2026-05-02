# CODEX.md

This file is the shared memory and handoff document for future Codex sessions working in this repository.

It is based on the current codebase plus the implementation history from this project recovery and upgrade cycle through 2026-04-17.

## Purpose

Use this file to get oriented fast without re-discovering the repo from scratch.

It covers:
- what the product is
- how the code is structured
- what features currently exist
- what major fixes were already made
- what limitations still remain
- what future Codex agents should avoid or preserve

## Product Summary

This repo is a self-hosted AI IDE called `LUXI IDE`.

The product now behaves as a prompt-first, project-based coding workspace:
- the home page can create a fresh project directly from a natural-language prompt
- the IDE opens project files, conversations, docs, secrets, terminal, dev server, and deploy tools
- the agent can edit files, run commands through a runner, browse the web, and drive a real Chromium browser through Puppeteer
- the backend is MongoDB + Express + JWT auth

## Current Stack

- Frontend: React 18 + TypeScript + Vite + TanStack Query + Monaco + Wouter
- Backend API: Express 5 + Mongoose + JWT auth
- Database: MongoDB Atlas
- Runner: standalone Node server with shell execution and Puppeteer browser automation
- AI providers supported in admin/user key flows:
  - Vertex
  - Gemini
  - Anthropic
  - OpenAI

## Repo Map

- `src/App.tsx`
  - app shell and routing
- `src/pages/Home.tsx`
  - prompt-first launcher, project creation, template entry, saved projects
- `src/pages/IDE.tsx`
  - main IDE workspace, tabs, editor, runner panels, preview, agent panel wiring
- `src/pages/Admin.tsx`
  - admin configuration for AI providers, runner, users, credits
- `src/pages/Auth.tsx`
  - sign in / sign up
- `src/components/ide/AgentPanel.tsx`
  - agent chat UI, streaming events, App Testing toggle, Build/Research/Autofix profiles
- `src/components/ide/TerminalPanel.tsx`
  - runner terminal panel
- `src/components/ide/DevServerPanel.tsx`
  - run dev servers on the runner and open preview URLs
- `src/components/ide/SecretsPanel.tsx`
  - project secret storage and sync-to-runner `.env`
- `src/components/ide/DeployPanel.tsx`
  - deploy-oriented runner flows
- `src/components/ide/UserKeysModal.tsx`
  - user-supplied provider keys
- `src/lib/api.ts`
  - frontend API client for auth, projects, files, docs, conversations, runner config, AI streaming
- `src/lib/auth.tsx`
  - auth provider using JWT token storage
- `src/lib/runner.ts`
  - client-side runner helpers and file sync
- `server/index.js`
  - Express server routes
- `server/lib/models.js`
  - Mongoose schemas and serializers
- `server/lib/auth.js`
  - auth middleware and token creation
- `server/lib/db.js`
  - Mongo connection setup
- `server/lib/runner.js`
  - persisted runner config and runner fetch utilities
- `server/lib/ai.js`
  - streaming AI orchestration, provider integration, tool execution, plan/thinking events
- `runner/server.js`
  - shell runner + browser automation server

## Main Data Model

Mongo collections are modeled in `server/lib/models.js`.

Core entities:
- `User`
  - email, password hash, display name, admin flag, subscription tier, credit balance
- `Project`
  - numeric id, owner `user_id`, name, description, language, timestamps
- `ProjectFile`
  - numeric id, `project_id`, path, name, content, language
- `Conversation`
  - numeric id, `project_id`, title
- `Message`
  - numeric id, `conversation_id`, role, content
- `ProjectDoc`
  - numeric id, `project_id`, title, content
- `ProjectSecret`
  - per-project, per-user secret key/value array
- `Setting`
  - system-level config such as provider choice, model, platform keys, runner URL/secret
- `CreditTransaction`
  - admin credit grants and accounting

### Secret Storage Notes

- system settings such as platform provider keys and the runner secret are now encrypted at rest before being saved to Mongo
- per-project secrets are now encrypted at rest before being saved to Mongo
- reads are backward-compatible with older plaintext rows, so legacy values still load
- encryption uses `SECRET_ENCRYPTION_KEY`, or falls back to `JWT_SECRET` if the dedicated key is not set
- current architecture still returns the runner secret to authenticated frontend clients because browser panels talk to the runner directly; this is a known design limitation, not a storage limitation

## Important Product Behavior

### Prompt-First Project Creation

The home page is intentionally prompt-first now.

Expected behavior:
- user enters a prompt on the home page
- app creates a fresh blank project
- project opens in IDE
- the agent auto-starts using the original prompt

This flow uses:
- `src/pages/Home.tsx`
- `src/pages/IDE.tsx`
- `src/components/ide/AgentPanel.tsx`

Boot prompt handoff uses session storage with the `luxi_boot_prompt:` prefix plus a URL prompt fallback.

### Project Isolation

Projects should be isolated per signed-in user.

This is now enforced in the Mongo backend through owner checks on project/file/conversation/doc/secret access. The frontend also resets IDE state when `projectId` changes.

If someone reports "I see another project's files", first inspect:
- route/project ownership in `server/index.js`
- project boot/reset logic in `src/pages/IDE.tsx`
- any stale client-side tab or editor state

### AI Execution Trace

The agent does not expose private chain-of-thought.

Instead it streams useful execution telemetry:
- plan events
- "why" events before actions
- tool call cards
- tool results
- file changed events
- preview URL events

The event model is in `src/types/index.ts`, and the display logic is in `src/components/ide/AgentPanel.tsx`.

### Agent Profiles

The agent supports three profiles:
- `builder`
- `research`
- `autofix`

These are selected in the UI and sent to the backend, where the prompt strategy changes.

### App Testing

The agent supports an App Testing mode.

When enabled and the runner is connected, the backend prompt requires the agent to:
- run the app if needed
- open it in the browser
- verify the flow
- fix failures
- re-test

This is not a stealth or bot-evasion system. It is meant for app validation and legitimate browser automation.

## Browser Automation State

Browser automation lives in `runner/server.js` and is exposed through the `browser_action` tool in `server/lib/ai.js`.

### Current Browser Capabilities

The browser layer now supports:
- safer navigation with `waitUntil`
- automatic fallback away from brittle `networkidle2` navigation
- click/type/fill by:
  - `selector`
  - `label`
  - visible `text`
- `wait_for`
- `wait_for_text`
- `get_text`
- `get_html`
- `current_url`
- `screenshot`
- `evaluate`
- `query_all`
- `dom_map`
- `frame_tree`
- `page_snapshot`
- `logs`
- `challenge_status` / `blocker_status` / `detect_challenge`
- `element_info`
- `get_attribute`
- `hover`
- `press_key`
- `scroll`
- `select`

### Key Browser Improvements Already Added

The browser layer has been upgraded in multiple passes:

1. Navigation reliability
- pages that never become fully idle no longer fail immediately on `networkidle2`
- `navigate` can use `waitUntil`
- navigation falls back to `domcontentloaded` and `load` when appropriate

2. Better targeting
- form inputs can be resolved by label
- buttons and links can be resolved by visible text
- selectors can pierce open shadow DOM

3. Frame awareness
- frame discovery through `frame_tree`
- frame-scoped actions through `frameName`, `frameUrl`, or `frameIndex`
- `dom_map`, `query_all`, `wait_for_text`, `page_snapshot`, and element targeting now work better across frames

4. Debugging signals
- recent console logs
- page errors
- failed network requests
- frame navigation history

5. Rich inspection
- `page_snapshot` returns frame summaries, text, interactive elements, and recent logs
- `element_info` returns tag/text/value/HTML/attributes for a resolved target

6. Blocker detection
- `challenge_status` inspects page/frame text, URLs, and recent browser logs for anti-bot markers
- successful `navigate` responses now include challenge/blocker metadata
- browser failures now return blocker metadata when challenge signals are detected

### Known Browser Limitations

Do not treat these as bugs unless there is evidence otherwise:
- public sites may still trigger CAPTCHA, anti-bot, OTP, or inbox confirmation flows
- headless Chromium on a local or cloud machine can still be identified by third-party sites
- this repo should not implement stealth plugins, CAPTCHA bypasses, or anti-bot evasion
- cross-origin security rules still limit what can be inspected or mutated inside some embedded content

If a public website blocks automation, the correct behavior is:
- inspect page state
- inspect frames
- inspect logs
- report the exact blocker

Do not claim a fake universal limitation like "I cannot use websites" if the runner is available.

## Runner Overview

The runner is a separate Node service.

It provides:
- `/health`
- `/run`
- `/write`
- `/read`
- `/install`
- `/ls`
- `/browser`

Runner behavior:
- creates a sandboxed temp directory per project under a shared work dir
- can execute shell commands in that project sandbox
- can sync files from Mongo-backed project storage into the runner sandbox
- can run npm/pip/yarn/pnpm installs
- can drive Chromium through Puppeteer

Typical local ports used during testing:
- frontend: `3000`
- API: `3001`
- runner: `3212`

## Backend API Overview

Major API routes in `server/index.js`:

Auth:
- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `GET /api/auth/me`

Projects:
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `DELETE /api/projects/:id`

Files:
- `GET /api/projects/:id/files`
- `POST /api/projects/:id/files`
- `PATCH /api/projects/:id/files/:fileId`
- `DELETE /api/projects/:id/files/:fileId`

Conversations and messages:
- `GET /api/projects/:id/conversations`
- `POST /api/projects/:id/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`

Docs:
- `GET /api/projects/:id/docs`
- `POST /api/projects/:id/docs`
- `PATCH /api/docs/:id`
- `DELETE /api/docs/:id`

Secrets:
- `GET /api/projects/:id/secrets`
- `PUT /api/projects/:id/secrets`

Credits and admin:
- `GET /api/me/credits`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`
- `GET /api/admin/stats`
- `GET /api/admin/users`
- `POST /api/admin/users/:id/credits`
- `PATCH /api/admin/users/:id/tier`
- `GET /api/admin/runner`
- `PUT /api/admin/runner`
- `GET /api/admin/runner/test`

AI:
- `POST /api/ai/stream`

## Frontend Feature Inventory

Current user-facing features include:
- sign up / sign in with JWT
- prompt-first project creation
- template-based project creation
- saved projects dashboard
- Monaco editor with tabbed files
- autosave
- file search
- project docs panel with manual docs plus text-file import into AI context
- chat/agent panel
- agent Build/Research/Autofix modes
- App Testing toggle
- project secrets editor with runner sync
- terminal panel
- dev server panel
- deploy panel
- admin settings for provider keys and runner
- admin user and credit management
- ZIP export

## AI Provider Notes

Platform AI configuration is saved in settings, not in source files.

Supported provider settings include:
- `provider`
- `model`
- `gemini_key`
- `anthropic_key`
- `openai_key`
- `vertex_key`

Important notes:
- never commit real keys into this repo
- user keys and platform keys are separate concerns
- Vertex requests in this codebase use an API-key style flow, not a service-account OAuth flow

## Conversation / Work History

This section is the condensed project history from the recovery and upgrade work.

### Phase 1: Recovery and Export

- Recovered the project from incomplete export material.
- Produced a safe ZIP export and a report describing what was missing and what was rebuilt.

### Phase 2: Security and Secret Handling

- User pasted raw provider/database secrets in chat.
- We explicitly avoided writing those raw values into source files or exported docs.
- Future Codex agents should continue that rule.
- Added encryption at rest for admin settings secrets and project secrets using the server-side secret helper.
- Legacy plaintext values remain readable so upgrades do not break existing installs.

### Phase 3: Project Isolation Bug

- User reported that creating a new project could show files from other projects.
- Fixed frontend state reset on project switches.
- Fixed backend project scoping to the signed-in user.
- Added owner-based data scoping to stop cross-project leakage.

### Phase 4: Vertex Token Limits and Provider Behavior

- Fixed a Vertex `maxOutputTokens` bug caused by using `65536`, which is outside the provider's accepted exclusive upper bound.
- Moved the default/fallback model strategy to working model IDs instead of broken defaults.

### Phase 5: Mongo Conversion

- The original app was heavily Supabase-oriented.
- The backend was rewritten around:
  - Express
  - MongoDB
  - JWT auth
  - Mongoose models
- Frontend auth and CRUD calls were repointed to the new backend.

### Phase 6: Runner and Command Execution Fixes

- Fixed runner startup under Node 20/ESM/CommonJS mismatch.
- Fixed project file syncing into the runner sandbox before command execution.
- Fixed dev-server startup failures caused by missing `package.json` in unsynced runner sandboxes.

### Phase 7: App Testing and Browser Enablement

- Added App Testing mode in the UI and backend prompt.
- Installed Puppeteer support for the runner.
- Fixed the model prompt so it stops falsely claiming browser inability when browser automation is available.

### Phase 8: Agent Visibility Improvements

- Added visible plan events.
- Added "why" events before tool use.
- Tightened final response expectations for changed/why/verification.

### Phase 9: Prompt-First Product Flow

- Home screen was changed from a project-first experience to a prompt-first experience.
- Prompt-created projects now auto-start the agent when the IDE opens.
- Fixed a boot-prompt race so the prompt is actually sent instead of just prefilled.

### Phase 10: Browser Capability Upgrade Pass 1

- Added safer navigation defaults and wait strategy fallback.
- Added targeting by label and visible text.
- Added `dom_map`.

### Phase 11: Browser Capability Upgrade Pass 2

- Added frame awareness.
- Added `frame_tree`.
- Added `page_snapshot`.
- Added session-scoped browser logs.
- Added `wait_for_text`.
- Added `element_info`.
- Extended DOM discovery into open shadow roots.

### Phase 12: Browser Blocker/Challenge Awareness

- Added challenge detection heuristics in the runner for CAPTCHA/human-verification/access-block/rate-limit signals.
- Added `challenge_status` (`blocker_status`/`detect_challenge` aliases) in browser actions.
- Added blocker metadata to navigate responses and browser failure payloads.
- Updated AI tool logic to stop useless retries when blocker signals are detected and report a concrete blocker summary.

## Practical Rules For Future Codex Sessions

1. Do not commit or echo raw user secrets.

2. Do not revert user work casually.

3. Preserve prompt-first behavior on the home page.

4. Preserve per-user project isolation.

5. Do not add fake "I cannot use websites" disclaimers when the runner/browser is available.

6. Do not add stealth, CAPTCHA bypass, or anti-bot evasion code.

7. Prefer improving inspection, diagnostics, and legitimate app-testing workflows instead.

8. When browser flows fail, check:
- `page_snapshot`
- `frame_tree`
- `dom_map`
- `logs`
- `element_info`

9. If the runner appears broken, verify:
- admin runner URL/secret
- runner health
- Puppeteer availability
- project file sync to the runner sandbox

10. If the app appears broken but the code is fine, also check Mongo connectivity. Atlas timeouts have occurred during local testing.

## Current Known Risks / Limitations

- MongoDB Atlas connectivity can occasionally time out during local runs.
- Public websites may block automation for reasons outside this app's control.
- Large frontend build chunk warnings still exist.
- The browser tool is much stronger now, but it is still not equal to a full commercial multi-agent cloud platform.

## Recommended Next Upgrades

If development continues, the next high-value upgrades are:
- GitHub import/sync workflows
- parallel sub-agent orchestration
- richer deployment connectors
- better runner session management and browser screenshots surfaced in the UI
- persistent browser session visualization in the IDE

## Final Handoff Note

If you are a future Codex picking up this repo, start with:
- this `CODEX.md`
- `server/lib/ai.js`
- `runner/server.js`
- `src/pages/Home.tsx`
- `src/pages/IDE.tsx`
- `src/components/ide/AgentPanel.tsx`

Those files explain most of the product behavior and most of the recent custom work.
