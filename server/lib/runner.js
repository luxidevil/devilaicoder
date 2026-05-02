import crypto from 'crypto';

import { Setting } from './models.js';
import { decryptSecret, encryptSecret } from './secrets.js';

const RUNNER_SIGNATURE_HEADER = 'x-luxi-runner-signature';
const RUNNER_TIMESTAMP_HEADER = 'x-luxi-runner-timestamp';
const RUNNER_NONCE_HEADER = 'x-luxi-runner-nonce';

const SENSITIVE_SETTING_KEYS = new Set([
  'anthropic_key',
  'gemini_key',
  'github_token',
  'kimi_key',
  'openai_key',
  'runner_secret',
  'ssh_passphrase',
  'ssh_private_key',
  'vertex_key',
]);

export async function getSettings(keys = []) {
  const query = keys.length > 0 ? { key: { $in: keys } } : {};
  const rows = await Setting.find(query);
  const map = {};
  for (const row of rows) {
    const rawValue = row.value ?? '';
    map[row.key] = SENSITIVE_SETTING_KEYS.has(row.key)
      ? decryptSecret(rawValue)
      : rawValue;
  }
  return map;
}

export async function upsertSettings(values) {
  const entries = Object.entries(values)
    .filter(([, value]) => value !== undefined);
  await Promise.all(entries.map(([key, value]) => Setting.findOneAndUpdate(
    { key },
    {
      key,
      value: SENSITIVE_SETTING_KEYS.has(key)
        ? encryptSecret(value)
        : String(value ?? ''),
      updated_at: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )));
}

export async function getRunnerConfig() {
  const map = await getSettings(['runner_url', 'runner_secret']);
  return {
    runner_url: map.runner_url ?? '',
    runner_secret: map.runner_secret ?? '',
  };
}

export async function getRunnerClientConfig() {
  const { runner_url: runnerUrl } = await getRunnerConfig();
  return {
    runner_url: runnerUrl ?? '',
    configured: !!runnerUrl,
  };
}

export async function saveRunnerConfig(runnerUrl, runnerSecret) {
  await upsertSettings({
    runner_url: runnerUrl ?? '',
    runner_secret: runnerSecret ?? '',
  });
}

function createRunnerSignature(secret, method, endpoint, timestamp, nonce, bodyText = '') {
  return crypto.createHmac('sha256', secret).update([
    String(method ?? 'POST').toUpperCase(),
    String(endpoint ?? ''),
    String(timestamp ?? ''),
    String(nonce ?? ''),
    bodyText,
  ].join('\n')).digest('hex');
}

async function buildRunnerSignedHeaders(secret, method, endpoint, bodyText, headers) {
  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  headers.set(RUNNER_TIMESTAMP_HEADER, timestamp);
  headers.set(RUNNER_NONCE_HEADER, nonce);
  headers.set(RUNNER_SIGNATURE_HEADER, createRunnerSignature(secret, method, endpoint, timestamp, nonce, bodyText));
}

export async function runnerRequest(endpoint, body, timeoutMs = 30000, init = {}, configOverride = null) {
  const config = configOverride ?? await getRunnerConfig();
  const { runner_url: runnerUrl, runner_secret: runnerSecret } = config;
  if (!runnerUrl) {
    throw new Error('Runner is not configured');
  }
  if (!runnerSecret) {
    throw new Error('Runner secret is not configured');
  }

  const headers = new Headers(init.headers);
  const method = String(init.method ?? 'POST').toUpperCase();
  const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
  if (!headers.has('Content-Type') && hasBody) {
    headers.set('Content-Type', 'application/json');
  }
  const bodyText = hasBody ? JSON.stringify(body) : '';
  await buildRunnerSignedHeaders(runnerSecret, method, endpoint, bodyText, headers);

  return fetch(`${runnerUrl.replace(/\/$/, '')}${endpoint}`, {
    method,
    headers,
    body: hasBody ? bodyText : undefined,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

export async function runnerFetch(endpoint, body, timeoutMs = 30000) {
  const response = await runnerRequest(endpoint, body, timeoutMs);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Runner ${endpoint} failed (${response.status})${text ? `: ${text}` : ''}`);
  }

  return response.json();
}

export async function runnerHealthCheck(timeoutMs = 8000, configOverride = null) {
  const config = configOverride ?? await getRunnerConfig();
  const { runner_url: runnerUrl } = config;
  if (!runnerUrl) {
    throw new Error('Runner is not configured');
  }
  const response = await runnerRequest('/health', undefined, timeoutMs, { method: 'GET' }, config);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Runner /health failed (${response.status})${text ? `: ${text}` : ''}`);
  }

  return response.json();
}
