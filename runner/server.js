#!/usr/bin/env node
/**
 * LUXI Runner Server
 *
 * Deploy on your DigitalOcean droplet ($44/mo or any VPS).
 *
 * ─── DIGITALOCEAN SETUP (one-time) ──────────────────────────────────────────
 *
 * 1. SSH into your droplet:
 *      ssh root@YOUR_DROPLET_IP
 *
 * 2. Install Node.js (if not already):
 *      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
 *      apt-get install -y nodejs
 *
 * 3. Install PM2 (process manager — keeps runner alive forever):
 *      npm install -g pm2
 *
 * 4. Copy this file to the droplet (from your local machine):
 *      scp runner/server.js runner/pm2.config.js root@YOUR_DROPLET_IP:/root/
 *
 * 5. Start the runner with PM2:
 *      cd /root
 *      LUXI_RUNNER_SECRET=your-secret-token pm2 start pm2.config.js
 *      pm2 save
 *      pm2 startup   # follow the printed command to auto-start on reboot
 *
 * 6. Open port 3210 in the droplet firewall:
 *      ufw allow 3210
 *      ufw enable
 *
 * 7. In LUXI Admin → Runner, set:
 *      Runner URL:    http://YOUR_DROPLET_IP:3210
 *      Runner Secret: your-secret-token
 *    Then click "Test Connection" to verify.
 *
 * ─── USEFUL PM2 COMMANDS ────────────────────────────────────────────────────
 *   pm2 status               — see if runner is alive
 *   pm2 logs luxi-runner     — tail live logs
 *   pm2 restart luxi-runner  — restart after updating server.js
 *   pm2 stop luxi-runner     — stop the runner
 *
 * ─── ENVIRONMENT VARIABLES ──────────────────────────────────────────────────
 *   LUXI_RUNNER_SECRET  - Shared signing secret (set same value in Admin > Runner Config)
 *   PORT                - Port to listen on (default: 3210)
 *   WORK_DIR            - Base working directory for project sandboxes
 *
 * ─── ENDPOINTS ──────────────────────────────────────────────────────────────
 *   GET  /health   — health check
 *   POST /run      — execute shell command (streaming supported)
 *   POST /write    — write file to project sandbox
 *   POST /read     — read file from project sandbox
 *   POST /install  — install npm / pip / yarn packages
 *   POST /ls       — list directory contents
 *   POST /browser  — Puppeteer browser automation
 */

const http = require('http');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.PORT ?? '3210', 10);
const SECRET = process.env.LUXI_RUNNER_SECRET ?? '';
const WORK_DIR = process.env.WORK_DIR ?? path.join(os.tmpdir(), 'luxi-runner');
const SHELL = [process.env.SHELL, '/bin/bash', '/bin/sh'].find((candidate) => candidate && fs.existsSync(candidate)) ?? '/bin/sh';
const RUNNER_SIGNATURE_HEADER = 'x-luxi-runner-signature';
const RUNNER_TIMESTAMP_HEADER = 'x-luxi-runner-timestamp';
const RUNNER_NONCE_HEADER = 'x-luxi-runner-nonce';
const MAX_AUTH_SKEW_MS = 5 * 60 * 1000;
const AUTH_NONCE_TTL_MS = 10 * 60 * 1000;

if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });

let puppeteer = null;
let puppeteerError = null;
try {
  puppeteer = require('puppeteer');
} catch {
  try {
    puppeteer = require('puppeteer-core');
  } catch (e) {
    puppeteerError = String(e);
  }
}

const browsers = new Map();
const browserSessions = new Map();
const backgroundProcesses = new Map();
const observedPages = new WeakSet();
const authNonces = new Map();
const MAX_BROWSER_LOGS = 80;
const MAX_BACKGROUND_LOG_CHARS = 24000;
const BROWSER_WAIT_UNTIL = new Set(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']);
const MAX_DOM_MUTATIONS = 50;
const CHALLENGE_RULES = [
  {
    id: 'captcha',
    kind: 'human_verification',
    label: 'CAPTCHA challenge',
    requiresHuman: true,
    pattern: /\b(captcha|hcaptcha|recaptcha|turnstile)\b/i,
  },
  {
    id: 'human_verification',
    kind: 'human_verification',
    label: 'Human verification prompt',
    requiresHuman: true,
    pattern: /(verify( that)? you('| a)?re human|are you human|press\s*(and|&)\s*hold|security check|prove you are human)/i,
  },
  {
    id: 'cloudflare_challenge',
    kind: 'human_verification',
    label: 'Cloudflare/browser challenge',
    requiresHuman: true,
    pattern: /(cloudflare|just a moment|checking your browser|cf-chl|attention required)/i,
  },
  {
    id: 'access_blocked',
    kind: 'blocked',
    label: 'Access blocked',
    requiresHuman: false,
    pattern: /(access denied|forbidden|request blocked|you have been blocked|automated queries|bot detected|suspicious activity)/i,
  },
  {
    id: 'rate_limited',
    kind: 'rate_limited',
    label: 'Rate-limited/throttled',
    requiresHuman: false,
    pattern: /(too many requests|rate limit|try again later|temporarily unavailable)/i,
  },
];

function log(msg) {
  process.stdout.write(`[luxi-runner] ${new Date().toISOString()} ${msg}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function collectChallengeSignals(signals, source, sample) {
  const text = String(sample ?? '').slice(0, 10000);
  if (!text) return;
  for (const rule of CHALLENGE_RULES) {
    if (rule.pattern.test(text)) {
      signals.push({
        id: rule.id,
        kind: rule.kind,
        label: rule.label,
        requiresHuman: rule.requiresHuman,
        source,
      });
    }
  }
}

function summarizeChallenge(signals, pageMeta = {}) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return {
      detected: false,
      kind: 'none',
      requiresHuman: false,
      summary: 'No obvious anti-bot or challenge markers detected.',
      signals: [],
      markers: [],
      sources: [],
      hints: [],
      url: pageMeta.url ?? '',
      title: pageMeta.title ?? '',
    };
  }

  const deduped = [];
  const seen = new Set();
  for (const signal of signals) {
    const key = `${signal.id}:${signal.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(signal);
  }

  const hasHumanVerification = deduped.some((signal) => signal.kind === 'human_verification');
  const hasBlocked = deduped.some((signal) => signal.kind === 'blocked');
  const hasRateLimited = deduped.some((signal) => signal.kind === 'rate_limited');
  const kind = hasHumanVerification ? 'human_verification' : hasBlocked ? 'blocked' : hasRateLimited ? 'rate_limited' : 'blocked';
  const requiresHuman = deduped.some((signal) => signal.requiresHuman);
  const markers = unique(deduped.map((signal) => signal.label));
  const sources = unique(deduped.map((signal) => signal.source)).slice(0, 10);

  let summary = 'Automation appears to be blocked by site protection.';
  if (kind === 'human_verification') {
    summary = 'Human verification or CAPTCHA challenge detected on the page.';
  } else if (kind === 'rate_limited') {
    summary = 'The site appears rate-limited or temporarily throttling automation.';
  } else if (kind === 'blocked') {
    summary = 'Access appears blocked by anti-bot or security protection.';
  }

  const hints = [];
  if (requiresHuman) {
    hints.push('Keep the same sessionId and complete the verification manually before resuming automation.');
    hints.push('Do not loop retries while the challenge is still visible.');
  } else if (kind === 'rate_limited') {
    hints.push('Use fewer rapid actions and retry with backoff after waiting.');
  } else {
    hints.push('Inspect page_snapshot, frame_tree, and logs to confirm the exact blocker text.');
  }

  return {
    detected: true,
    kind,
    requiresHuman,
    summary,
    signals: deduped.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      label: signal.label,
      source: signal.source,
    })),
    markers,
    sources,
    hints,
    url: pageMeta.url ?? '',
    title: pageMeta.title ?? '',
  };
}

async function detectChallengeStatus(page, sessionId, options = {}) {
  const includeFrames = options.includeFrames !== false;
  const frameLimit = Math.min(Math.max(Number(options.frameLimit ?? options.limit ?? 6), 1), 10);
  const textLimit = Math.min(Math.max(Number(options.textLimit ?? 4000), 500), 12000);
  const signals = [];

  let title = '';
  let url = '';
  try { title = await page.title(); } catch {}
  try { url = page.url(); } catch {}

  collectChallengeSignals(signals, 'page_meta', `${title}\n${url}`);

  const frameEntries = listFrames(page).slice(0, includeFrames ? frameLimit : 1);
  for (const entry of frameEntries) {
    collectChallengeSignals(signals, `frame_url:${entry.index}`, entry.url ?? '');
    try {
      const frameText = await entry.frame.evaluate((maxChars) => {
        return String(document.body?.innerText ?? '').slice(0, maxChars);
      }, textLimit);
      collectChallengeSignals(signals, `frame_text:${entry.index}`, frameText);
    } catch {}
  }

  const state = getSessionState(sessionId);
  for (const entry of state.console.slice(-10)) {
    collectChallengeSignals(signals, 'console', entry.text);
  }
  for (const entry of state.pageErrors.slice(-10)) {
    collectChallengeSignals(signals, 'page_error', `${entry.message ?? ''}\n${entry.stack ?? ''}`);
  }
  for (const entry of state.requestFailures.slice(-15)) {
    collectChallengeSignals(signals, 'request_failure', `${entry.failure ?? ''}\n${entry.url ?? ''}`);
  }

  return summarizeChallenge(signals, { title, url });
}

function normalizeWaitUntil(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return BROWSER_WAIT_UNTIL.has(normalized) ? normalized : null;
}

function toNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isTimeoutError(error) {
  const message = String(error?.stack ?? error?.message ?? error ?? '');
  return /timeout/i.test(message);
}

function getSessionState(sessionId) {
  if (!browserSessions.has(sessionId)) {
    browserSessions.set(sessionId, {
      console: [],
      pageErrors: [],
      requestFailures: [],
      frameNavigations: [],
      lastUpdated: nowIso(),
    });
  }

  return browserSessions.get(sessionId);
}

function trimEntries(entries, max = MAX_BROWSER_LOGS) {
  if (entries.length > max) entries.splice(0, entries.length - max);
}

function recordSessionEntry(state, key, entry, max = MAX_BROWSER_LOGS) {
  state[key].push({ time: nowIso(), ...entry });
  trimEntries(state[key], max);
  state.lastUpdated = nowIso();
}

function describeFrameEntry(entry) {
  if (!entry) return '';
  if (entry.isMain) return 'main frame';
  if (entry.name) return `frame "${entry.name}"`;
  if (entry.url) return `frame ${entry.url}`;
  return `frame #${entry.index}`;
}

function listFrames(page) {
  const frames = page.frames();
  return frames.map((frame, index) => ({
    frame,
    index,
    name: frame.name() || undefined,
    url: frame.url() || '',
    isMain: frame === page.mainFrame(),
    parentIndex: frame.parentFrame() ? frames.indexOf(frame.parentFrame()) : null,
  }));
}

function getCandidateFrames(page, body = {}) {
  const entries = listFrames(page);
  const frameName = normalizeText(body.frameName);
  const frameUrl = String(body.frameUrl ?? '').trim().toLowerCase();
  const frameIndex = Number.isFinite(Number(body.frameIndex)) ? Number(body.frameIndex) : null;

  const filtered = entries.filter((entry) => {
    if (frameIndex !== null && entry.index !== frameIndex) return false;
    if (frameName && !normalizeText(entry.name).includes(frameName)) return false;
    if (frameUrl && !String(entry.url ?? '').toLowerCase().includes(frameUrl)) return false;
    return true;
  });

  return filtered.length > 0 ? filtered : entries;
}

function ensurePageObservers(page, sessionId) {
  if (observedPages.has(page)) return;
  observedPages.add(page);

  const state = getSessionState(sessionId);

  page.on('console', (msg) => {
    const location = typeof msg.location === 'function' ? msg.location() : null;
    recordSessionEntry(state, 'console', {
      type: msg.type(),
      text: msg.text().slice(0, 2000),
      url: location?.url || undefined,
      lineNumber: location?.lineNumber,
      columnNumber: location?.columnNumber,
    });
  });

  page.on('pageerror', (error) => {
    recordSessionEntry(state, 'pageErrors', {
      message: String(error?.message ?? error).slice(0, 2000),
      stack: String(error?.stack ?? '').slice(0, 4000) || undefined,
    });
  });

  page.on('requestfailed', (request) => {
    recordSessionEntry(state, 'requestFailures', {
      url: request.url().slice(0, 1000),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'Request failed',
    });
  });

  page.on('framenavigated', (frame) => {
    const frames = page.frames();
    const index = frames.indexOf(frame);
    recordSessionEntry(state, 'frameNavigations', {
      index,
      name: frame.name() || undefined,
      url: frame.url().slice(0, 1000),
      isMain: frame === page.mainFrame(),
    }, 120);
  });
}

async function elementHandleFromEvaluate(context, evaluator, arg) {
  const handle = await context.evaluateHandle(evaluator, arg);
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
}

async function pollForElement(getter, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const handle = await getter();
      if (handle) return handle;
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  if (lastError) throw lastError;
  return null;
}

async function findElementBySelector(page, body, timeout) {
  const selector = String(body.selector ?? '').trim();
  if (!selector) return null;

  return pollForElement(async () => {
    for (const entry of getCandidateFrames(page, body)) {
      const handle = await elementHandleFromEvaluate(entry.frame, (needle) => {
        const isVisible = (el) => {
          if (!(el instanceof Element)) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const collect = (root, matches = []) => {
          if (!root?.querySelectorAll) return matches;
          for (const match of root.querySelectorAll(needle)) matches.push(match);
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) collect(el.shadowRoot, matches);
          }
          return matches;
        };
        const matches = collect(document);
        return matches.find((match) => isVisible(match)) ?? matches[0] ?? null;
      }, selector);

      if (handle) {
        return {
          handle,
          locator: `selector "${selector}"`,
          frame: {
            index: entry.index,
            name: entry.name,
            url: entry.url,
            isMain: entry.isMain,
          },
        };
      }
    }

    return null;
  }, timeout);
}

async function findElementByLabel(page, body, timeout) {
  const label = String(body.label ?? '').trim();
  const wanted = normalizeText(label);
  if (!wanted) return null;

  return pollForElement(async () => {
    for (const entry of getCandidateFrames(page, body)) {
      const handle = await elementHandleFromEvaluate(entry.frame, (needle) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        const isVisible = (el) => {
          if (!(el instanceof Element)) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const collect = (root, selector, matches = []) => {
          if (!root?.querySelectorAll) return matches;
          for (const match of root.querySelectorAll(selector)) matches.push(match);
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) collect(el.shadowRoot, selector, matches);
          }
          return matches;
        };
        const score = (value) => {
          const normalized = normalize(value);
          if (!normalized) return -1;
          if (normalized === needle) return 300;
          if (normalized.startsWith(needle)) return 200;
          if (normalized.includes(needle)) return 100;
          return -1;
        };

        const labelCandidates = collect(document, 'label');
        let best = null;
        let bestScore = -1;

        for (const labelEl of labelCandidates) {
          const labelScore = score(labelEl.textContent);
          if (labelScore < 0) continue;

          const control = labelEl.control
            || labelEl.querySelector('input, textarea, select, [contenteditable="true"]');

          if (control && isVisible(control) && labelScore > bestScore) {
            best = control;
            bestScore = labelScore;
          }
        }

        const fieldCandidates = collect(document, 'input, textarea, select, [contenteditable="true"]');
        for (const field of fieldCandidates) {
          if (!isVisible(field)) continue;

          const fieldScore = Math.max(
            score(field.getAttribute('aria-label')),
            score(field.getAttribute('placeholder')),
            score(field.getAttribute('name')),
            score(field.id),
          );

          if (fieldScore > bestScore) {
            best = field;
            bestScore = fieldScore;
          }
        }

        return bestScore >= 0 ? best : null;
      }, wanted);

      if (handle) {
        return {
          handle,
          locator: `label "${label}"`,
          frame: {
            index: entry.index,
            name: entry.name,
            url: entry.url,
            isMain: entry.isMain,
          },
        };
      }
    }

    return null;
  }, timeout);
}

async function findElementByText(page, body, timeout) {
  const text = String(body.text ?? '').trim();
  const wanted = normalizeText(text);
  if (!wanted) return null;

  return pollForElement(async () => {
    for (const entry of getCandidateFrames(page, body)) {
      const handle = await elementHandleFromEvaluate(entry.frame, (needle) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        const isVisible = (el) => {
          if (!(el instanceof Element)) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const collect = (root, selector, matches = []) => {
          if (!root?.querySelectorAll) return matches;
          for (const match of root.querySelectorAll(selector)) matches.push(match);
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) collect(el.shadowRoot, selector, matches);
          }
          return matches;
        };
        const score = (value) => {
          const normalized = normalize(value);
          if (!normalized) return -1;
          if (normalized === needle) return 300;
          if (normalized.startsWith(needle)) return 200;
          if (normalized.includes(needle)) return 100;
          return -1;
        };

        const preferredSelector = [
          'button',
          'a',
          '[role="button"]',
          '[role="link"]',
          'input[type="button"]',
          'input[type="submit"]',
          'summary',
          '[aria-label]',
          '[title]',
          '[data-testid]',
          '[tabindex]',
        ].join(', ');

        const candidates = collect(document, preferredSelector);
        let best = null;
        let bestScore = -1;

        for (const candidate of candidates) {
          if (!isVisible(candidate)) continue;
          const candidateScore = Math.max(
            score(candidate.innerText),
            score(candidate.textContent),
            score(candidate.getAttribute('aria-label')),
            score(candidate.getAttribute('title')),
            score(candidate.getAttribute('value')),
          );

          if (candidateScore > bestScore) {
            best = candidate;
            bestScore = candidateScore;
          }
        }

        return bestScore >= 0 ? best : null;
      }, wanted);

      if (handle) {
        return {
          handle,
          locator: `text "${text}"`,
          frame: {
            index: entry.index,
            name: entry.name,
            url: entry.url,
            isMain: entry.isMain,
          },
        };
      }
    }

    return null;
  }, timeout);
}

async function findElementByMeta(page, body, timeout) {
  const metadata = {
    name: String(body.name ?? '').trim(),
    id: String(body.id ?? '').trim(),
    placeholder: String(body.placeholder ?? '').trim(),
  };

  if (!metadata.name && !metadata.id && !metadata.placeholder) return null;

  return pollForElement(async () => {
    for (const entry of getCandidateFrames(page, body)) {
      const handle = await elementHandleFromEvaluate(entry.frame, (criteria) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        const isVisible = (el) => {
          if (!(el instanceof Element)) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const collect = (root, selector, matches = []) => {
          if (!root?.querySelectorAll) return matches;
          for (const match of root.querySelectorAll(selector)) matches.push(match);
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) collect(el.shadowRoot, selector, matches);
          }
          return matches;
        };
        const scoreMatch = (value, wanted) => {
          if (!wanted) return -1;
          const normalized = normalize(value);
          if (!normalized) return -1;
          if (normalized === wanted) return 300;
          if (normalized.startsWith(wanted)) return 200;
          if (normalized.includes(wanted)) return 100;
          return -1;
        };

        const wantedName = normalize(criteria.name);
        const wantedId = normalize(criteria.id);
        const wantedPlaceholder = normalize(criteria.placeholder);
        const selector = '[id], [name], [placeholder], [aria-label], input, textarea, select, button, a, [role="button"], [role="link"], [contenteditable="true"]';
        const candidates = collect(document, selector);
        let best = null;
        let bestScore = -1;

        for (const candidate of candidates) {
          if (!isVisible(candidate)) continue;

          const candidateScore = Math.max(
            scoreMatch(candidate.getAttribute('name'), wantedName),
            scoreMatch(candidate.id, wantedId),
            scoreMatch(candidate.getAttribute('placeholder'), wantedPlaceholder),
            scoreMatch(candidate.getAttribute('aria-label'), wantedPlaceholder),
            scoreMatch(candidate.getAttribute('data-testid'), wantedId),
          );

          if (candidateScore > bestScore) {
            best = candidate;
            bestScore = candidateScore;
          }
        }

        return bestScore >= 0 ? best : null;
      }, metadata);

      if (handle) {
        const parts = [];
        if (metadata.name) parts.push(`name="${metadata.name}"`);
        if (metadata.id) parts.push(`id="${metadata.id}"`);
        if (metadata.placeholder) parts.push(`placeholder="${metadata.placeholder}"`);
        return {
          handle,
          locator: `field ${parts.join(', ')}`,
          frame: {
            index: entry.index,
            name: entry.name,
            url: entry.url,
            isMain: entry.isMain,
          },
        };
      }
    }

    return null;
  }, timeout);
}

async function resolveElement(page, body, timeout, actionName) {
  const attempts = [];

  if (body.selector) {
    attempts.push({
      lookup: () => findElementBySelector(page, body, timeout),
    });
  }

  if (body.label) {
    attempts.push({
      lookup: () => findElementByLabel(page, body, timeout),
    });
  }

  if (body.text) {
    attempts.push({
      lookup: () => findElementByText(page, body, timeout),
    });
  }

  if (body.name || body.id || body.placeholder) {
    attempts.push({
      lookup: () => findElementByMeta(page, body, timeout),
    });
  }

  if (attempts.length === 0) {
    throw new Error(`${actionName} requires selector, label, text, name, id, or placeholder`);
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const match = await attempt.lookup();
      if (match) {
        const frameSuffix = match.frame && !match.frame.isMain ? ` in ${describeFrameEntry(match.frame)}` : '';
        return { ...match, locator: `${match.locator}${frameSuffix}` };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw new Error(`${actionName} could not find a matching element`);
}

async function fillElement(handle, value) {
  await handle.focus();
  await handle.evaluate((el, nextValue) => {
    const applyValue = (target, val) => {
      if (target instanceof HTMLInputElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(target, val);
        else target.value = val;
        return;
      }

      if (target instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(target, val);
        else target.value = val;
        return;
      }

      if (target instanceof HTMLSelectElement) {
        target.value = val;
        return;
      }

      if ('value' in target) {
        target.value = val;
        return;
      }

      target.textContent = val;
    };

    applyValue(el, nextValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value ?? '');
}

async function typeIntoElement(page, handle, value, { clear = false, delay = 30 } = {}) {
  await handle.focus();
  if (clear) {
    await handle.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.type(value ?? '', { delay });
}

async function clickElementReliably(handle, button = 'left') {
  try {
    await handle.click({ button });
    return 'native';
  } catch {
    await handle.evaluate((el) => {
      if (el instanceof HTMLElement) {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
        return;
      }
      if ('click' in el && typeof el.click === 'function') {
        el.click();
      }
    });
    return 'dom';
  }
}

async function applyDomMutation(handle, operation) {
  return handle.evaluate((el, op) => {
    const action = String(op.action ?? op.op ?? '').trim().toLowerCase();
    const value = op.value ?? '';
    const attr = String(op.attribute ?? '');
    const className = String(op.className ?? op.class ?? '');

    const setElementValue = (target, nextValue) => {
      if (target instanceof HTMLInputElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(target, String(nextValue ?? ''));
        else target.value = String(nextValue ?? '');
      } else if (target instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor?.set) descriptor.set.call(target, String(nextValue ?? ''));
        else target.value = String(nextValue ?? '');
      } else if (target instanceof HTMLSelectElement) {
        target.value = String(nextValue ?? '');
      } else if ('value' in target) {
        target.value = String(nextValue ?? '');
      } else {
        target.textContent = String(nextValue ?? '');
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (!action) {
      throw new Error('dom_mutate operation requires action');
    }

    if (action === 'set_text') {
      el.textContent = String(value ?? '');
      return { action, ok: true };
    }
    if (action === 'set_html') {
      el.innerHTML = String(value ?? '');
      return { action, ok: true };
    }
    if (action === 'set_value') {
      setElementValue(el, value);
      return { action, ok: true };
    }
    if (action === 'set_attribute') {
      if (!attr) throw new Error('set_attribute requires attribute');
      el.setAttribute(attr, String(value ?? ''));
      return { action, ok: true };
    }
    if (action === 'remove_attribute') {
      if (!attr) throw new Error('remove_attribute requires attribute');
      el.removeAttribute(attr);
      return { action, ok: true };
    }
    if (action === 'add_class') {
      if (!className) throw new Error('add_class requires className');
      el.classList.add(...className.split(/\s+/).filter(Boolean));
      return { action, ok: true };
    }
    if (action === 'remove_class') {
      if (!className) throw new Error('remove_class requires className');
      el.classList.remove(...className.split(/\s+/).filter(Boolean));
      return { action, ok: true };
    }
    if (action === 'toggle_class') {
      if (!className) throw new Error('toggle_class requires className');
      const classes = className.split(/\s+/).filter(Boolean);
      let active = false;
      for (const entry of classes) {
        const state = el.classList.toggle(entry);
        active = active || state;
      }
      return { action, ok: true, active };
    }
    if (action === 'append_html') {
      el.insertAdjacentHTML('beforeend', String(value ?? ''));
      return { action, ok: true };
    }
    if (action === 'prepend_html') {
      el.insertAdjacentHTML('afterbegin', String(value ?? ''));
      return { action, ok: true };
    }
    if (action === 'remove') {
      el.remove();
      return { action, ok: true };
    }
    if (action === 'focus') {
      if (el instanceof HTMLElement) el.focus();
      return { action, ok: true };
    }
    if (action === 'click') {
      if (el instanceof HTMLElement) el.click();
      else if ('click' in el && typeof el.click === 'function') el.click();
      return { action, ok: true };
    }

    throw new Error(`Unsupported dom_mutate action: ${action}`);
  }, operation);
}

async function navigateWithFallback(page, targetUrl, timeout, waitUntil) {
  const explicitWaitUntil = normalizeWaitUntil(waitUntil);
  const strategies = explicitWaitUntil
    ? [explicitWaitUntil]
    : ['domcontentloaded', 'load', 'networkidle2'];

  const attempted = [];
  let lastError = null;

  for (const strategy of strategies) {
    try {
      attempted.push(strategy);
      await page.goto(targetUrl, { waitUntil: strategy, timeout });
      return { waitUntil: strategy, attempted };
    } catch (error) {
      lastError = error;
      if (explicitWaitUntil || !isTimeoutError(error)) throw error;
    }
  }

  throw new Error(`Navigation timed out after trying ${attempted.join(', ')}: ${String(lastError)}`);
}

async function collectInteractiveElements(frame, limit = 60) {
  return frame.evaluate((maxItems) => {
    const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const collect = (root, selector, matches = []) => {
      if (!root?.querySelectorAll) return matches;
      for (const match of root.querySelectorAll(selector)) matches.push(match);
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) collect(el.shadowRoot, selector, matches);
      }
      return matches;
    };
    const toSelector = (el) => {
      if (!(el instanceof Element)) return undefined;
      if (el.id) return `#${CSS.escape(el.id)}`;
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
      return undefined;
    };
    const labelFor = (el) => {
      if (!(el instanceof Element)) return '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const labels = el.labels ? Array.from(el.labels) : [];
        return normalize(labels.map((label) => label.textContent).join(' '));
      }
      return '';
    };

    const selector = 'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], summary';
    return collect(document, selector)
      .filter((el) => isVisible(el))
      .slice(0, maxItems)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') ?? undefined,
        text: normalize(el.textContent || el.innerText).slice(0, 200),
        label: labelFor(el) || undefined,
        ariaLabel: normalize(el.getAttribute('aria-label')).slice(0, 200) || undefined,
        placeholder: normalize(el.getAttribute('placeholder')).slice(0, 200) || undefined,
        name: el.getAttribute('name') ?? undefined,
        id: el.id || undefined,
        selector: toSelector(el),
      }));
  }, limit);
}

async function collectFrameSnapshot(frame, entry, limit = 40) {
  const [elements, bodyText] = await Promise.all([
    collectInteractiveElements(frame, limit),
    frame.evaluate(() => (document.body?.innerText ?? '').slice(0, 4000)),
  ]);

  return {
    index: entry.index,
    name: entry.name,
    url: entry.url,
    isMain: entry.isMain,
    parentIndex: entry.parentIndex,
    text: bodyText,
    elements,
  };
}

async function buildPageSnapshot(page, sessionId, body = {}) {
  const limit = Math.min(Math.max(Number(body.limit ?? 40), 1), 200);
  const state = getSessionState(sessionId);
  const frameEntries = getCandidateFrames(page, body);
  const frames = [];

  for (const entry of frameEntries.slice(0, 10)) {
    try {
      frames.push(await collectFrameSnapshot(entry.frame, entry, limit));
    } catch (error) {
      frames.push({
        index: entry.index,
        name: entry.name,
        url: entry.url,
        isMain: entry.isMain,
        parentIndex: entry.parentIndex,
        error: String(error),
      });
    }
  }

  const challenge = await detectChallengeStatus(page, sessionId, {
    includeFrames: body.includeFrames !== false,
    frameLimit: 6,
    textLimit: 3000,
  });

  return {
    url: page.url(),
    title: await page.title(),
    frames,
    challenge,
    logs: {
      console: state.console.slice(-10),
      pageErrors: state.pageErrors.slice(-10),
      requestFailures: state.requestFailures.slice(-10),
      frameNavigations: state.frameNavigations.slice(-10),
      lastUpdated: state.lastUpdated,
    },
  };
}

async function waitForText(page, body, timeout) {
  const text = normalizeText(body.text ?? body.value ?? '');
  if (!text) throw new Error('wait_for_text requires text');

  return pollForElement(async () => {
    for (const entry of getCandidateFrames(page, body)) {
      const found = await entry.frame.evaluate((needle) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        return normalize(document.body?.innerText).includes(needle);
      }, text);

      if (found) {
        return {
          locator: `text "${body.text ?? body.value}"`,
          frame: {
            index: entry.index,
            name: entry.name,
            url: entry.url,
            isMain: entry.isMain,
          },
        };
      }
    }

    return null;
  }, timeout);
}

function spawnShell(command, options = {}) {
  return spawn(SHELL, ['-lc', command], {
    ...options,
    shell: false,
  });
}

function parseDotEnvFile(dotenvPath) {
  const projectEnv = {};
  if (!fs.existsSync(dotenvPath)) return projectEnv;

  try {
    const lines = fs.readFileSync(dotenvPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k) projectEnv[k] = v;
    }
  } catch {}

  return projectEnv;
}

function buildProcessEnv(cwd) {
  return {
    ...process.env,
    ...parseDotEnvFile(path.join(cwd, '.env')),
    HOME: os.homedir(),
  };
}

function normalizeBackgroundSessionId(sessionId, projectId) {
  const raw = String(sessionId ?? '').trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 80);
  if (cleaned.includes(':')) return cleaned;
  if (cleaned) return `${projectId ?? 'default'}:${cleaned}`;
  return `${projectId ?? 'default'}:${crypto.randomUUID()}`;
}

function trimBackgroundLog(text) {
  const value = String(text ?? '');
  return value.length <= MAX_BACKGROUND_LOG_CHARS
    ? value
    : value.slice(value.length - MAX_BACKGROUND_LOG_CHARS);
}

function appendBackgroundLog(session, key, chunk) {
  session[key] = trimBackgroundLog(`${session[key] ?? ''}${String(chunk ?? '')}`);
  session.lastOutputAt = nowIso();
}

function summarizeBackgroundSession(session) {
  return {
    sessionId: session.id,
    projectId: session.projectId,
    command: session.command,
    cwd: session.cwd,
    pid: session.pid,
    status: session.status,
    exitCode: session.exitCode,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
    lastOutputAt: session.lastOutputAt ?? null,
    stdout: trimBackgroundLog(session.stdout),
    stderr: trimBackgroundLog(session.stderr),
  };
}

function getBackgroundCheckUrl(body = {}) {
  const explicitUrl = String(body.url ?? '').trim();
  if (explicitUrl) return explicitUrl;

  const port = Number(body.port);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return '';
  const protocol = String(body.protocol ?? 'http').trim() || 'http';
  const host = String(body.host ?? '127.0.0.1').trim() || '127.0.0.1';
  const pathname = String(body.path ?? '/').trim() || '/';
  const nextPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${protocol}://${host}:${Math.trunc(port)}${nextPath}`;
}

async function probeBackgroundUrl(urlToCheck, timeoutMs = 3000) {
  if (!urlToCheck) return null;

  try {
    const response = await fetch(urlToCheck, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ready: true,
      url: urlToCheck,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ready: false,
      url: urlToCheck,
      error: String(error),
    };
  }
}

function stopBackgroundSession(session, signal = 'SIGTERM') {
  if (!session || session.status !== 'running' || !session.proc) {
    return false;
  }

  try {
    session.proc.kill(signal);
    session.stopSignal = signal;
    session.lastOutputAt = nowIso();
    return true;
  } catch (error) {
    appendBackgroundLog(session, 'stderr', `\n[STOP ERROR] ${String(error)}\n`);
    return false;
  }
}

function getProjectDir(projectId) {
  const dir = path.join(WORK_DIR, `project-${projectId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safePath(base, rel) {
  const normalizedBase = path.resolve(base);
  const resolved = path.resolve(normalizedBase, rel);
  const relative = path.relative(normalizedBase, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path traversal attempt: ${rel}`);
  }
  return resolved;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve({ raw: data, json: JSON.parse(data) }); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${RUNNER_SIGNATURE_HEADER}, ${RUNNER_TIMESTAMP_HEADER}, ${RUNNER_NONCE_HEADER}`,
    'Content-Type': 'application/json',
  };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, corsHeaders());
  res.end(body);
}

function createRunnerSignature(method, pathname, timestamp, nonce, bodyText = '') {
  return crypto.createHmac('sha256', SECRET).update([
    String(method ?? 'POST').toUpperCase(),
    String(pathname ?? ''),
    String(timestamp ?? ''),
    String(nonce ?? ''),
    String(bodyText ?? ''),
  ].join('\n')).digest('hex');
}

function cleanupAuthNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of authNonces.entries()) {
    if (expiresAt <= now) authNonces.delete(nonce);
  }
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function auth(req, pathname, bodyText = '') {
  if (!SECRET) return true;

  cleanupAuthNonces();
  const signature = String(req.headers[RUNNER_SIGNATURE_HEADER] ?? '').trim();
  const timestamp = String(req.headers[RUNNER_TIMESTAMP_HEADER] ?? '').trim();
  const nonce = String(req.headers[RUNNER_NONCE_HEADER] ?? '').trim();
  if (!signature || !timestamp || !nonce) return false;
  if (authNonces.has(nonce)) return false;

  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_AUTH_SKEW_MS) {
    return false;
  }

  const expected = createRunnerSignature(req.method, pathname, timestamp, nonce, bodyText);
  if (!timingSafeEqualHex(signature, expected)) return false;

  authNonces.set(nonce, Date.now() + AUTH_NONCE_TTL_MS);
  return true;
}

function resolveHeadlessMode(value) {
  if (value === false || value === 'false' || value === '0') return false;
  return 'new';
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health' && req.method === 'GET') {
    if (!auth(req, url.pathname)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    json(res, 200, {
      status: 'ok',
      platform: process.platform,
      node: process.version,
      workDir: WORK_DIR,
      puppeteer: puppeteer ? 'available' : `not installed (run: npm install puppeteer) — ${puppeteerError ?? ''}`,
    });
    return;
  }

  if (url.pathname === '/run' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const { command, projectId, cwd: cwdOverride, timeout = 30000, stream = false } = body;
    if (!command) { json(res, 400, { error: 'command is required' }); return; }

    const baseDir = getProjectDir(projectId ?? 'default');
    const cwd = cwdOverride
      ? safePath(baseDir, cwdOverride)
      : baseDir;

    const projectEnv = buildProcessEnv(cwd);

    log(`[run] project=${projectId} cmd=${command.slice(0, 120)}`);

    if (stream) {
      res.writeHead(200, {
        ...corsHeaders(),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const proc = spawnShell(command, {
        cwd,
        env: projectEnv,
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        res.write(`data: ${JSON.stringify({ type: 'stderr', data: '\n[TIMEOUT] Process killed after timeout\n' })}\n\n`);
        res.end();
      }, timeout);

      proc.stdout.on('data', (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'stdout', data: chunk.toString() })}\n\n`);
      });

      proc.stderr.on('data', (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'stderr', data: chunk.toString() })}\n\n`);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        res.write(`data: ${JSON.stringify({ type: 'exit', code })}\n\n`);
        res.end();
      });

      proc.on('error', (error) => {
        clearTimeout(timer);
        res.write(`data: ${JSON.stringify({ type: 'stderr', data: `\n[SPAWN ERROR] ${String(error)}\n` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'exit', code: -1 })}\n\n`);
        res.end();
      });

      req.on('close', () => proc.kill('SIGTERM'));
      return;
    }

    let stdout = '';
    let stderr = '';
    let exitCode = -1;
    const proc = spawnShell(command, {
      cwd,
      env: projectEnv,
    });

    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        stderr += '\n[TIMEOUT] Process killed after timeout';
        exitCode = -1;
        resolve(null);
      }, timeout);
      proc.on('close', (code) => { clearTimeout(timer); exitCode = code ?? 0; resolve(null); });
      proc.on('error', (error) => {
        clearTimeout(timer);
        stderr += `\n[SPAWN ERROR] ${String(error)}`;
        exitCode = -1;
        resolve(null);
      });
    });

    json(res, 200, {
      stdout: stdout.slice(0, 50000),
      stderr: stderr.slice(0, 10000),
      exitCode,
      cwd,
    });
    return;
  }

  if (url.pathname === '/process/start' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const { command, projectId, cwd: cwdOverride, sessionId } = body;
    if (!command) { json(res, 400, { error: 'command is required' }); return; }

    const baseDir = getProjectDir(projectId ?? 'default');
    const cwd = cwdOverride
      ? safePath(baseDir, cwdOverride)
      : baseDir;
    const id = normalizeBackgroundSessionId(sessionId, projectId ?? 'default');
    const existing = backgroundProcesses.get(id);
    if (existing && existing.status === 'running') {
      stopBackgroundSession(existing, 'SIGTERM');
      await sleep(200);
    }

    const proc = spawnShell(command, {
      cwd,
      env: buildProcessEnv(cwd),
      detached: false,
    });

    const session = {
      id,
      projectId: projectId ?? 'default',
      command: String(command),
      cwd,
      pid: proc.pid ?? null,
      status: 'running',
      exitCode: null,
      startedAt: nowIso(),
      endedAt: null,
      lastOutputAt: nowIso(),
      stdout: '',
      stderr: '',
      stopSignal: null,
      proc,
    };

    proc.stdout.on('data', (chunk) => {
      appendBackgroundLog(session, 'stdout', chunk.toString());
    });
    proc.stderr.on('data', (chunk) => {
      appendBackgroundLog(session, 'stderr', chunk.toString());
    });
    proc.on('close', (code) => {
      session.status = 'exited';
      session.exitCode = code ?? 0;
      session.endedAt = nowIso();
      session.lastOutputAt = nowIso();
      session.proc = null;
    });
    proc.on('error', (error) => {
      appendBackgroundLog(session, 'stderr', `\n[SPAWN ERROR] ${String(error)}\n`);
      session.status = 'error';
      session.exitCode = -1;
      session.endedAt = nowIso();
      session.lastOutputAt = nowIso();
      session.proc = null;
    });

    backgroundProcesses.set(id, session);
    log(`[process:start] project=${projectId} session=${id} pid=${session.pid ?? 'unknown'} cmd=${String(command).slice(0, 120)}`);
    json(res, 200, {
      ok: true,
      ...summarizeBackgroundSession(session),
    });
    return;
  }

  if (url.pathname === '/process/status' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const id = normalizeBackgroundSessionId(body.sessionId, body.projectId ?? 'default');
    const session = backgroundProcesses.get(id);
    if (!session) {
      json(res, 404, { error: `Background process not found: ${id}` });
      return;
    }

    const urlToCheck = getBackgroundCheckUrl(body);
    const readiness = urlToCheck ? await probeBackgroundUrl(urlToCheck, toNumber(body.timeout, 3000, 250, 20000)) : null;
    json(res, 200, {
      ok: true,
      ...summarizeBackgroundSession(session),
      readiness,
    });
    return;
  }

  if (url.pathname === '/process/stop' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const id = normalizeBackgroundSessionId(body.sessionId, body.projectId ?? 'default');
    const session = backgroundProcesses.get(id);
    if (!session) {
      json(res, 404, { error: `Background process not found: ${id}` });
      return;
    }

    const signal = String(body.signal ?? 'SIGTERM');
    const stopped = stopBackgroundSession(session, signal);
    if (!stopped && session.status === 'running') {
      json(res, 500, { error: `Could not stop background process ${id}` });
      return;
    }

    await sleep(150);
    json(res, 200, {
      ok: true,
      stopped,
      ...summarizeBackgroundSession(session),
    });
    return;
  }

  if (url.pathname === '/write' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const { projectId, filePath, content } = body;
    if (!filePath || content === undefined) { json(res, 400, { error: 'filePath and content required' }); return; }

    const dir = getProjectDir(projectId ?? 'default');
    const full = safePath(dir, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    json(res, 200, { ok: true, path: full });
    return;
  }

  if (url.pathname === '/read' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const { projectId, filePath } = body;
    const dir = getProjectDir(projectId ?? 'default');
    const full = safePath(dir, filePath);
    if (!fs.existsSync(full)) { json(res, 404, { error: 'File not found' }); return; }
    const content = fs.readFileSync(full, 'utf8');
    json(res, 200, { content: content.slice(0, 100000) });
    return;
  }

  if (url.pathname === '/install' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const { projectId, packages, manager = 'npm', cwd: cwdOverride } = body;
    if (!packages || !packages.length) { json(res, 400, { error: 'packages required' }); return; }

    const baseDir = getProjectDir(projectId ?? 'default');
    const cwd = cwdOverride ? safePath(baseDir, cwdOverride) : baseDir;
    const pkgStr = Array.isArray(packages) ? packages.join(' ') : packages;
    const cmd = manager === 'pip' ? `pip install ${pkgStr}` :
                manager === 'pip3' ? `pip3 install ${pkgStr}` :
                manager === 'yarn' ? `yarn add ${pkgStr}` :
                manager === 'pnpm' ? `pnpm add ${pkgStr}` :
                `npm install ${pkgStr}`;

    log(`[install] project=${projectId} cmd=${cmd}`);

    let stdout = '', stderr = '';
    let exitCode = -1;
    const proc = spawnShell(cmd, { cwd, env: buildProcessEnv(cwd) });
    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        stderr += '\n[TIMEOUT] Process killed after timeout';
        exitCode = -1;
        resolve(null);
      }, 120000);
      proc.on('close', (code) => {
        clearTimeout(timer);
        exitCode = code ?? 0;
        resolve(null);
      });
      proc.on('error', (error) => {
        clearTimeout(timer);
        stderr += `\n[SPAWN ERROR] ${String(error)}`;
        exitCode = -1;
        resolve(null);
      });
    });

    json(res, 200, {
      ok: exitCode === 0,
      stdout: stdout.slice(0, 20000),
      stderr: stderr.slice(0, 5000),
      exitCode,
    });
    return;
  }

  if (url.pathname === '/ls' && req.method === 'POST') {
    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const { projectId, dir: subDir = '.' } = body;
    const base = getProjectDir(projectId ?? 'default');
    const target = safePath(base, subDir);
    if (!fs.existsSync(target)) { json(res, 200, { entries: [] }); return; }
    const entries = fs.readdirSync(target, { withFileTypes: true }).map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: path.join(subDir, e.name),
    }));
    json(res, 200, { entries });
    return;
  }

  if (url.pathname === '/browser' && req.method === 'POST') {
    if (!puppeteer) {
      json(res, 503, { error: `Puppeteer not installed. Run: npm install puppeteer\n${puppeteerError ?? ''}` });
      return;
    }

    let body;
    let parsedBody;
    try { parsedBody = await readBody(req); }
    catch { json(res, 400, { error: 'Invalid request body' }); return; }
    if (!auth(req, url.pathname, parsedBody.raw)) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
    body = parsedBody.json;

    const {
      sessionId,
      action,
      url: targetUrl,
      selector,
      text: targetText,
      label,
      frameName,
      frameUrl,
      frameIndex,
      value,
      script,
      x,
      y,
      button = 'left',
      waitFor,
      waitUntil,
      limit,
      includeFrames,
      timeout = 30000,
      headless,
    } = body;
    const normalizedAction = action === 'goto' ? 'navigate' : action;
    const sid = sessionId ?? 'default';

    log(`[browser] session=${sid} action=${normalizedAction}`);

    let page = null;
    try {
      let browser = browsers.get(sid);

      if (normalizedAction === 'launch' || normalizedAction === 'new') {
        if (browser) { try { await browser.close(); } catch {} }
        browser = await puppeteer.launch({
          headless: resolveHeadlessMode(headless),
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          timeout,
        });
        browsers.set(sid, browser);
        const pages = await browser.pages();
        page = pages[0] ?? await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36');
        getSessionState(sid);
        ensurePageObservers(page, sid);
        json(res, 200, { ok: true, message: 'Browser launched', sessionId: sid });
        return;
      }

      if (normalizedAction === 'close') {
        if (browser) { await browser.close(); browsers.delete(sid); }
        browserSessions.delete(sid);
        json(res, 200, { ok: true, message: 'Browser closed' });
        return;
      }

      if (!browser) {
        browser = await puppeteer.launch({
          headless: resolveHeadlessMode(headless),
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
          timeout,
        });
        browsers.set(sid, browser);
      }

      const pages = await browser.pages();
      page = pages[pages.length - 1] ?? await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36');
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);
      getSessionState(sid);
      ensurePageObservers(page, sid);

      if (normalizedAction === 'navigate') {
        if (!targetUrl) { json(res, 400, { error: 'url required for navigate' }); return; }
        const navigation = await navigateWithFallback(page, targetUrl, timeout, waitUntil);
        const title = await page.title();
        const pageUrl = page.url();
        const challenge = await detectChallengeStatus(page, sid, {
          includeFrames: includeFrames !== false,
          frameLimit: 6,
          textLimit: 3000,
        });
        json(res, 200, { ok: true, title, url: pageUrl, waitUntil: navigation.waitUntil, attemptedWaitUntil: navigation.attempted, challenge, blocker: challenge.detected ? challenge : null });
        return;
      }

      if (normalizedAction === 'challenge_status' || normalizedAction === 'detect_challenge' || normalizedAction === 'blocker_status') {
        const challenge = await detectChallengeStatus(page, sid, {
          includeFrames: includeFrames !== false,
          frameLimit: 8,
          textLimit: 5000,
        });
        json(res, 200, { ok: true, challenge, blocker: challenge.detected ? challenge : null });
        return;
      }

      if (normalizedAction === 'screenshot') {
        const data = await page.screenshot({ encoding: 'base64', type: 'png', fullPage: body.fullPage ?? false });
        json(res, 200, { ok: true, screenshot: data, url: page.url(), title: await page.title() });
        return;
      }

      if (normalizedAction === 'get_text') {
        let text;
        if (selector || label || targetText) {
          const resolved = await resolveElement(page, body, timeout, 'get_text');
          try {
            text = await resolved.handle.evaluate((el) => el.textContent?.trim() ?? '');
          } finally {
            await resolved.handle.dispose();
          }
        } else {
          text = await page.evaluate(() => document.body.innerText);
        }
        json(res, 200, { ok: true, text: text.slice(0, 50000) });
        return;
      }

      if (normalizedAction === 'wait_for_text') {
        const match = await waitForText(page, body, timeout);
        const frameSuffix = match.frame && !match.frame.isMain ? ` in ${describeFrameEntry(match.frame)}` : '';
        json(res, 200, { ok: true, message: `Found ${match.locator}${frameSuffix}` });
        return;
      }

      if (normalizedAction === 'get_html') {
        let html;
        if (selector || label || targetText) {
          const resolved = await resolveElement(page, body, timeout, 'get_html');
          try {
            html = await resolved.handle.evaluate((el) => el.outerHTML);
          } finally {
            await resolved.handle.dispose();
          }
        } else {
          html = await page.content();
        }
        json(res, 200, { ok: true, html: html.slice(0, 100000) });
        return;
      }

      if (normalizedAction === 'click') {
        if (selector || label || targetText || body.name || body.id || body.placeholder) {
          const resolved = await resolveElement(page, body, timeout, 'click');
          try {
            const method = await clickElementReliably(resolved.handle, button);
            json(res, 200, { ok: true, locator: resolved.locator, method, message: `Clicked ${resolved.locator}` });
          } finally {
            await resolved.handle.dispose();
          }
        } else if (x !== undefined && y !== undefined) {
          await page.mouse.click(x, y, { button });
          json(res, 200, { ok: true, message: `Clicked (${x},${y})` });
        } else {
          json(res, 400, { error: 'selector, label, text, or x,y required for click' }); return;
        }
        return;
      }

      if (normalizedAction === 'smart_click') {
        const smartBody = {
          ...body,
          text: body.text ?? body.targetText ?? body.value ?? body.label,
        };
        const resolved = await resolveElement(page, smartBody, timeout, 'smart_click');
        try {
          const method = await clickElementReliably(resolved.handle, button);
          json(res, 200, {
            ok: true,
            locator: resolved.locator,
            frame: resolved.frame,
            method,
            message: `Smart click succeeded on ${resolved.locator}`,
          });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'type') {
        const resolved = await resolveElement(page, body, timeout, 'type');
        try {
          if (body.clear) await fillElement(resolved.handle, '');
          await typeIntoElement(page, resolved.handle, value, { clear: false, delay: body.delay ?? 30 });
          json(res, 200, { ok: true, message: `Typed into ${resolved.locator}` });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'smart_fill_form') {
        const fields = Array.isArray(body.fields) ? body.fields.slice(0, 100) : [];
        if (fields.length === 0) {
          json(res, 400, { error: 'smart_fill_form requires fields[]' });
          return;
        }

        const applied = [];
        for (const field of fields) {
          const fieldBody = {
            ...body,
            ...field,
            text: field?.text ?? field?.label ?? field?.name ?? field?.placeholder ?? undefined,
            value: field?.value ?? '',
          };

          const resolved = await resolveElement(page, fieldBody, timeout, 'smart_fill_form');
          try {
            const fieldMode = String(field?.mode ?? field?.action ?? '').trim().toLowerCase();
            if (fieldMode === 'type') {
              await typeIntoElement(page, resolved.handle, fieldBody.value, {
                clear: field?.clear ?? true,
                delay: toNumber(field?.delay, 25, 0, 300),
              });
            } else if (fieldMode === 'select') {
              await resolved.handle.evaluate((el, nextValue) => {
                if (!(el instanceof HTMLSelectElement)) {
                  throw new Error('Target is not a <select> element');
                }
                el.value = String(nextValue ?? '');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }, fieldBody.value ?? '');
            } else {
              await fillElement(resolved.handle, fieldBody.value ?? '');
            }
            applied.push({
              locator: resolved.locator,
              valueLength: String(fieldBody.value ?? '').length,
              mode: fieldMode || 'fill',
            });
          } finally {
            await resolved.handle.dispose();
          }
        }

        if (body.submit) {
          if (typeof body.submit === 'object') {
            const submitTarget = await resolveElement(page, { ...body, ...body.submit }, timeout, 'smart_fill_form submit');
            try {
              const method = await clickElementReliably(submitTarget.handle, button);
              applied.push({ locator: submitTarget.locator, mode: `submit:${method}`, valueLength: 0 });
            } finally {
              await submitTarget.handle.dispose();
            }
          } else if (typeof body.submit === 'string') {
            const submitTarget = await resolveElement(page, { ...body, text: body.submit }, timeout, 'smart_fill_form submit');
            try {
              const method = await clickElementReliably(submitTarget.handle, button);
              applied.push({ locator: submitTarget.locator, mode: `submit:${method}`, valueLength: 0 });
            } finally {
              await submitTarget.handle.dispose();
            }
          } else {
            await page.keyboard.press('Enter');
            applied.push({ locator: 'keyboard Enter', mode: 'submit:key', valueLength: 0 });
          }
        }

        json(res, 200, {
          ok: true,
          message: `Filled ${applied.length} field${applied.length === 1 ? '' : 's'}`,
          fields: applied,
        });
        return;
      }

      if (normalizedAction === 'dom_mutate') {
        const operations = Array.isArray(body.operations) ? body.operations.slice(0, MAX_DOM_MUTATIONS) : [];
        if (operations.length === 0) {
          json(res, 400, { error: 'dom_mutate requires operations[]' });
          return;
        }

        const updates = [];
        for (const operation of operations) {
          const targetBody = {
            ...body,
            ...operation,
            text: operation?.text ?? operation?.label ?? operation?.name ?? operation?.placeholder ?? body.text,
          };
          const resolved = await resolveElement(page, targetBody, timeout, 'dom_mutate');
          try {
            const result = await applyDomMutation(resolved.handle, operation);
            updates.push({
              locator: resolved.locator,
              frame: resolved.frame,
              action: String(operation?.action ?? operation?.op ?? ''),
              result,
            });
          } finally {
            await resolved.handle.dispose();
          }
        }

        json(res, 200, {
          ok: true,
          message: `Applied ${updates.length} DOM mutation${updates.length === 1 ? '' : 's'}`,
          updates,
        });
        return;
      }

      if (normalizedAction === 'fill') {
        const resolved = await resolveElement(page, body, timeout, 'fill');
        try {
          await fillElement(resolved.handle, value);
          json(res, 200, { ok: true, message: `Filled ${resolved.locator} with value` });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'select') {
        const resolved = await resolveElement(page, body, timeout, 'select');
        try {
          await resolved.handle.evaluate((el, nextValue) => {
            if (!(el instanceof HTMLSelectElement)) {
              throw new Error('Target is not a <select> element');
            }
            el.value = nextValue ?? '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, value ?? '');
          json(res, 200, { ok: true, message: `Selected "${value}" in ${resolved.locator}` });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'wait_for') {
        if (selector || label || targetText) {
          const resolved = await resolveElement(page, body, timeout, 'wait_for');
          try {
            json(res, 200, { ok: true, message: `Element ${resolved.locator} appeared` });
          } finally {
            await resolved.handle.dispose();
          }
        } else if (waitFor === 'navigation') {
          await page.waitForNavigation({ timeout });
          json(res, 200, { ok: true, url: page.url(), title: await page.title() });
        } else if (normalizeWaitUntil(waitFor)) {
          await page.waitForNavigation({ waitUntil: normalizeWaitUntil(waitFor), timeout });
          json(res, 200, { ok: true, url: page.url(), title: await page.title() });
        } else if (typeof waitFor === 'number') {
          await new Promise((r) => setTimeout(r, waitFor));
          json(res, 200, { ok: true, message: `Waited ${waitFor}ms` });
        } else {
          json(res, 400, { error: 'selector, label, text, name, id, placeholder, or waitFor required' });
        }
        return;
      }

      if (normalizedAction === 'scroll') {
        if (selector || label || targetText) {
          const resolved = await resolveElement(page, body, timeout, 'scroll');
          try {
            await resolved.handle.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
            json(res, 200, { ok: true, message: `Scrolled to ${resolved.locator}` });
          } finally {
            await resolved.handle.dispose();
          }
        } else {
          await page.evaluate((px, py) => window.scrollTo(px, py), x ?? 0, y ?? 0);
          json(res, 200, { ok: true });
        }
        return;
      }

      if (normalizedAction === 'evaluate' || normalizedAction === 'js') {
        if (!script) { json(res, 400, { error: 'script required for evaluate' }); return; }
        const result = await page.evaluate(new Function(`return (async () => { ${script} })()`));
        json(res, 200, { ok: true, result: JSON.stringify(result) });
        return;
      }

      if (normalizedAction === 'get_cookies') {
        const cookies = await page.cookies();
        json(res, 200, { ok: true, cookies });
        return;
      }

      if (normalizedAction === 'set_cookies') {
        await page.setCookie(...(body.cookies ?? []));
        json(res, 200, { ok: true });
        return;
      }

      if (normalizedAction === 'hover') {
        const resolved = await resolveElement(page, body, timeout, 'hover');
        try {
          await resolved.handle.hover();
          json(res, 200, { ok: true, message: `Hovered ${resolved.locator}` });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'press_key') {
        await page.keyboard.press(value ?? 'Enter');
        json(res, 200, { ok: true, message: `Pressed ${value ?? 'Enter'}` });
        return;
      }

      if (normalizedAction === 'query_all') {
        if (!selector) { json(res, 400, { error: 'selector required' }); return; }
        const matches = [];
        for (const entry of getCandidateFrames(page, { frameName, frameUrl, frameIndex })) {
          const elements = await entry.frame.evaluate((needle, maxItems) => {
            const collect = (root, selectorValue, results = []) => {
              if (!root?.querySelectorAll) return results;
              for (const match of root.querySelectorAll(selectorValue)) results.push(match);
              for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) collect(el.shadowRoot, selectorValue, results);
              }
              return results;
            };

            return collect(document, needle)
              .slice(0, maxItems)
              .map((el) => ({
                tag: el.tagName.toLowerCase(),
                text: el.textContent?.trim().slice(0, 200) ?? '',
                href: el.getAttribute('href') ?? undefined,
                id: el.id || undefined,
                class: el.className || undefined,
              }));
          }, selector, Math.min(Math.max(Number(limit ?? 100), 1), 200));

          matches.push(...elements.map((item) => ({
            ...item,
            frame: {
              index: entry.index,
              name: entry.name,
              url: entry.url,
              isMain: entry.isMain,
            },
          })));
        }
        json(res, 200, { ok: true, elements: matches.slice(0, 200) });
        return;
      }

      if (normalizedAction === 'dom_map' || normalizedAction === 'interactive_elements') {
        const frames = [];
        const itemLimit = Math.min(Math.max(Number(limit ?? 60), 1), 200);
        for (const entry of getCandidateFrames(page, { frameName, frameUrl, frameIndex })) {
          frames.push({
            index: entry.index,
            name: entry.name,
            url: entry.url,
            isMain: entry.isMain,
            parentIndex: entry.parentIndex,
            elements: await collectInteractiveElements(entry.frame, itemLimit),
          });
        }
        json(res, 200, { ok: true, frames, elements: frames.flatMap((frame) => frame.elements.map((element) => ({ ...element, frame: { index: frame.index, name: frame.name, url: frame.url, isMain: frame.isMain } }))) });
        return;
      }

      if (normalizedAction === 'frame_tree') {
        json(res, 200, { ok: true, frames: listFrames(page).map(({ frame, ...entry }) => entry) });
        return;
      }

      if (normalizedAction === 'page_snapshot' || normalizedAction === 'snapshot' || normalizedAction === 'inspect_page') {
        const snapshot = await buildPageSnapshot(page, sid, { frameName, frameUrl, frameIndex, limit });
        json(res, 200, { ok: true, ...snapshot });
        return;
      }

      if (normalizedAction === 'logs' || normalizedAction === 'debug_log') {
        const state = getSessionState(sid);
        const maxItems = Math.min(Math.max(Number(limit ?? 20), 1), 100);
        json(res, 200, {
          ok: true,
          logs: {
            console: state.console.slice(-maxItems),
            pageErrors: state.pageErrors.slice(-maxItems),
            requestFailures: state.requestFailures.slice(-maxItems),
            frameNavigations: state.frameNavigations.slice(-maxItems),
            lastUpdated: state.lastUpdated,
          },
        });
        return;
      }

      if (normalizedAction === 'element_info') {
        const resolved = await resolveElement(page, body, timeout, 'element_info');
        try {
          const info = await resolved.handle.evaluate((el) => ({
            tag: el.tagName.toLowerCase(),
            text: String(el.textContent ?? '').trim().slice(0, 500),
            value: 'value' in el ? String(el.value ?? '') : undefined,
            html: el.outerHTML.slice(0, 4000),
            attributes: Array.from(el.attributes ?? []).reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {}),
          }));
          json(res, 200, { ok: true, locator: resolved.locator, frame: resolved.frame, info });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'get_attribute') {
        if (!body.attribute) { json(res, 400, { error: 'attribute required' }); return; }
        const resolved = await resolveElement(page, body, timeout, 'get_attribute');
        try {
          const attr = await resolved.handle.evaluate((el, attributeName) => el.getAttribute(attributeName), body.attribute);
          json(res, 200, { ok: true, value: attr });
        } finally {
          await resolved.handle.dispose();
        }
        return;
      }

      if (normalizedAction === 'current_url') {
        json(res, 200, { ok: true, url: page.url(), title: await page.title(), frames: listFrames(page).length });
        return;
      }

      json(res, 400, { error: `Unknown browser action: ${action}` });
    } catch (e) {
      log(`[browser] error: ${String(e)}`);
      const state = getSessionState(sid);
      let blocker = null;
      if (page) {
        try {
          blocker = await detectChallengeStatus(page, sid, {
            includeFrames: true,
            frameLimit: 6,
            textLimit: 3000,
          });
        } catch {}
      }
      const errorText = blocker?.detected
        ? `[BLOCKED:${blocker.kind}] ${String(e)}`
        : String(e);
      json(res, 500, {
        error: errorText,
        url: page ? page.url() : undefined,
        title: page ? await page.title().catch(() => '') : undefined,
        challenge: blocker ?? undefined,
        blocker: blocker?.detected ? blocker : undefined,
        logs: {
          console: state.console.slice(-5),
          pageErrors: state.pageErrors.slice(-5),
          requestFailures: state.requestFailures.slice(-5),
        },
      });
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  log(`LUXI Runner listening on port ${PORT}`);
  log(`Work dir: ${WORK_DIR}`);
  log(SECRET ? `Auth: enabled` : `Auth: DISABLED (set LUXI_RUNNER_SECRET to enable)`);
  log(`Endpoints: /health /run /process/start /process/status /process/stop /write /read /install /ls /browser`);
  log(puppeteer ? `Puppeteer: available (browser automation enabled)` : `Puppeteer: not installed — run: npm install puppeteer`);
});

function shutdownRunner(signal) {
  log(`${signal} received, shutting down`);
  for (const session of backgroundProcesses.values()) {
    stopBackgroundSession(session, 'SIGTERM');
  }
  server.close();
}

process.on('SIGTERM', () => { shutdownRunner('SIGTERM'); });
process.on('SIGINT', () => { shutdownRunner('SIGINT'); });
