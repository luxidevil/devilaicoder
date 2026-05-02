import crypto from 'crypto';
import path from 'path';

import {
  ProjectSecurityProfile,
  SecurityCustomCheck,
  SecurityFinding,
  SecurityOastSession,
  SecurityReport,
  TrafficCapture,
  nextSequence,
  serializeProjectSecurityProfile,
  serializeSecurityCustomCheck,
  serializeSecurityFinding,
  serializeSecurityOastSession,
  serializeSecurityReport,
  serializeTrafficCapture,
} from './models.js';

const SECURITY_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const FINDING_STATUSES = ['open', 'triaged', 'in_progress', 'fixed', 'accepted_risk', 'duplicate', 'false_positive'];

function uniqueTrimmedList(values, limit = 50) {
  const items = Array.isArray(values)
    ? values
    : String(values ?? '')
      .split(/\n|,/)
      .map((entry) => entry.trim());
  return Array.from(new Set(items.map((entry) => String(entry).trim()).filter(Boolean))).slice(0, limit);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return null;
  }
}

function safePath(pathValue = '/') {
  const raw = String(pathValue ?? '/').trim() || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function truncateText(value, limit = 4000) {
  return String(value ?? '').slice(0, limit);
}

function normalizeHeaderPairs(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      name: String(entry?.name ?? '').trim(),
      value: String(entry?.value ?? '').trim(),
    }))
    .filter((entry) => entry.name);
}

function normalizeHarBody(postData = {}) {
  const text = typeof postData?.text === 'string' ? postData.text : '';
  const mimeType = String(postData?.mimeType ?? '').trim();
  if (!text) {
    return {
      mimeType,
      text: '',
      base64: '',
    };
  }

  if (String(postData?.encoding ?? '').toLowerCase() === 'base64') {
    return {
      mimeType,
      text: '',
      base64: truncateText(text, 200000),
    };
  }

  return {
    mimeType,
    text: truncateText(text, 200000),
    base64: '',
  };
}

function tryDecodeBase64(value) {
  try {
    return Buffer.from(String(value ?? ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function isLikelyPrintable(value) {
  return /^[\t\n\r\x20-\x7e\u00a0-\u024f]*$/.test(String(value ?? ''));
}

function buildFetchTemplate(entry) {
  const headers = {};
  for (const pair of entry.headers ?? []) {
    if (!pair.name) continue;
    headers[pair.name] = pair.value;
  }
  if ((entry.cookies ?? []).length > 0 && !headers.Cookie) {
    headers.Cookie = entry.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }
  const headerBlock = JSON.stringify(headers, null, 2);
  const bodyLine = ['GET', 'HEAD'].includes(String(entry.method ?? '').toUpperCase())
    ? ''
    : entry.request_body_base64
      ? `,\n  body: Buffer.from(${JSON.stringify(entry.request_body_base64)}, 'base64')`
      : entry.request_body_text
        ? `,\n  body: ${JSON.stringify(entry.request_body_text)}`
        : '';
  return `fetch(${JSON.stringify(entry.url)}, {\n  method: ${JSON.stringify(entry.method)},\n  headers: ${headerBlock}${bodyLine}\n})\n  .then(async (response) => ({ status: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() }))\n  .then(console.log);`;
}

function buildCurlTemplate(entry) {
  const parts = [`curl --request ${shellQuote(entry.method)}`, shellQuote(entry.url)];
  for (const pair of entry.headers ?? []) {
    parts.splice(parts.length - 1, 0, `--header ${shellQuote(`${pair.name}: ${pair.value}`)}`);
  }
  if ((entry.cookies ?? []).length > 0) {
    parts.splice(parts.length - 1, 0, `--header ${shellQuote(`Cookie: ${entry.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')}`)}`);
  }
  if (!['GET', 'HEAD'].includes(String(entry.method ?? '').toUpperCase())) {
    if (entry.request_body_text) {
      parts.splice(parts.length - 1, 0, `--data-raw ${shellQuote(entry.request_body_text)}`);
    } else if (entry.request_body_base64) {
      parts.splice(parts.length - 1, 0, `--data-binary @<(printf %s ${shellQuote(entry.request_body_base64)} | base64 --decode)`);
    }
  }
  return parts.join(' \\\n  ');
}

function deriveHarEntryNotes(entry) {
  const notes = [];
  const lowerPath = String(entry.path ?? '').toLowerCase();
  const lowerBody = String(entry.request_body_text ?? '').toLowerCase();
  const headerNames = new Set((entry.headers ?? []).map((pair) => String(pair.name ?? '').toLowerCase()));
  const cookieNames = new Set((entry.cookies ?? []).map((pair) => String(pair.name ?? '').toLowerCase()));

  if (headerNames.has('authorization')) notes.push('Authorization header present');
  if (cookieNames.size > 0) notes.push('Session cookies captured');
  if (headerNames.has('x-csrf-token') || headerNames.has('x-xsrf-token') || cookieNames.has('csrf')) notes.push('CSRF token indicator present');
  if (/graphql/.test(lowerPath) || /"query"\s*:/.test(lowerBody)) notes.push('Likely GraphQL request');
  if (/(login|signin|session|auth|token|refresh)/.test(lowerPath)) notes.push('Likely authentication flow');
  if ((entry.response_headers ?? []).some((pair) => String(pair.name ?? '').toLowerCase() === 'set-cookie')) notes.push('Response sets cookies');
  if (/application\/json/i.test(String(entry.request_body_mime_type ?? ''))) notes.push('JSON request body');
  if (/multipart\/form-data/i.test(String(entry.request_body_mime_type ?? ''))) notes.push('Multipart form submission');
  return uniqueTrimmedList(notes, 8);
}

function normalizeHarEntry(entry, index) {
  const rawUrl = String(entry?.request?.url ?? '').trim();
  if (!rawUrl) return null;

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  const requestHeaders = normalizeHeaderPairs(entry?.request?.headers);
  const requestCookies = normalizeHeaderPairs(entry?.request?.cookies);
  const responseHeaders = normalizeHeaderPairs(entry?.response?.headers);
  const requestBody = normalizeHarBody(entry?.request?.postData ?? {});
  const responseContentText = typeof entry?.response?.content?.text === 'string'
    ? entry.response.content.text
    : '';
  const responseDecoded = String(entry?.response?.content?.encoding ?? '').toLowerCase() === 'base64'
    ? tryDecodeBase64(responseContentText)
    : responseContentText;
  const responseBodyPreview = truncateText(
    isLikelyPrintable(responseDecoded) ? responseDecoded : responseContentText,
    4000,
  );

  const normalized = {
    id: String(entry?._id ?? `${index + 1}`),
    order: index + 1,
    started_at: entry?.startedDateTime ? new Date(entry.startedDateTime) : null,
    time_ms: normalizeNumber(entry?.time, 0, 0, 600000),
    method: String(entry?.request?.method ?? 'GET').toUpperCase(),
    url: rawUrl,
    host: parsedUrl.host,
    path: safePath(parsedUrl.pathname),
    query: parsedUrl.search ?? '',
    http_version: String(entry?.request?.httpVersion ?? '').trim(),
    headers: requestHeaders,
    cookies: requestCookies,
    request_body_mime_type: requestBody.mimeType,
    request_body_text: requestBody.text,
    request_body_base64: requestBody.base64,
    response_status: normalizeNumber(entry?.response?.status, 0, 0, 999),
    response_status_text: String(entry?.response?.statusText ?? '').trim(),
    response_headers: responseHeaders,
    response_content_type: String(entry?.response?.content?.mimeType ?? '').trim(),
    response_body_preview: responseBodyPreview,
    fetch_template: '',
    curl_template: '',
    notes: [],
  };
  normalized.notes = deriveHarEntryNotes(normalized);
  normalized.fetch_template = buildFetchTemplate(normalized);
  normalized.curl_template = buildCurlTemplate(normalized);
  return normalized;
}

function hostMatchesScopeRule(host, rule) {
  const normalizedHost = String(host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  const normalizedRule = String(rule ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

  if (!normalizedRule) return false;
  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(1);
    return normalizedHost.endsWith(suffix);
  }
  return normalizedHost === normalizedRule || normalizedHost.endsWith(`.${normalizedRule}`);
}

function assertReplayHostAllowed(host, scope = {}, fallbackHosts = []) {
  const normalizedHost = String(host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!normalizedHost) throw new Error('Replay request is missing a target host.');

  const blocked = Array.isArray(scope.blocked_hosts) ? scope.blocked_hosts : [];
  if (blocked.some((rule) => hostMatchesScopeRule(normalizedHost, rule))) {
    throw new Error(`Replay blocked: host ${normalizedHost} is explicitly blocked by project scope.`);
  }

  const allowed = Array.isArray(scope.allowed_hosts) ? scope.allowed_hosts : [];
  if (allowed.length > 0) {
    if (!allowed.some((rule) => hostMatchesScopeRule(normalizedHost, rule))) {
      throw new Error(`Replay blocked: host ${normalizedHost} is not in the allowed scope.`);
    }
    return;
  }

  const importedHosts = Array.isArray(fallbackHosts)
    ? fallbackHosts.map((entry) => String(entry).toLowerCase().replace(/:\d+$/, ''))
    : [];
  if (importedHosts.length > 0 && !importedHosts.includes(normalizedHost)) {
    throw new Error(`Replay blocked: host ${normalizedHost} was not part of the imported capture and no explicit scope allowlist exists.`);
  }
}

function buildReplayHeaders(entry) {
  const headers = new Headers();
  const restricted = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']);
  for (const pair of entry.headers ?? []) {
    const name = String(pair.name ?? '').trim();
    if (!name || restricted.has(name.toLowerCase())) continue;
    headers.set(name, String(pair.value ?? ''));
  }
  if ((entry.cookies ?? []).length > 0 && !headers.has('cookie')) {
    headers.set('cookie', entry.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
  }
  return headers;
}

function getSetCookieValuesFromHeaders(headers) {
  if (typeof headers?.getSetCookie === 'function') {
    return headers.getSetCookie().map((value) => String(value)).filter(Boolean);
  }
  const combined = headers?.get?.('set-cookie');
  if (!combined) return [];
  return String(combined)
    .split(/,(?=[^;,]+=)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function mergeCookiePairs(originalPairs = [], cookieHeader = '') {
  const cookieMap = new Map();
  for (const pair of Array.isArray(originalPairs) ? originalPairs : []) {
    const name = String(pair?.name ?? '').trim();
    if (!name) continue;
    cookieMap.set(name, String(pair?.value ?? ''));
  }
  for (const chunk of String(cookieHeader ?? '').split(';')) {
    const [rawName, ...rawValue] = chunk.split('=');
    const name = String(rawName ?? '').trim();
    if (!name) continue;
    cookieMap.set(name, rawValue.join('=').trim());
  }
  return Array.from(cookieMap.entries()).map(([name, value]) => ({ name, value }));
}

function getCookieJarHeader(cookieJar, host) {
  const normalizedHost = String(host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!normalizedHost) return '';
  const cookieMap = new Map();
  for (const [domain, values] of cookieJar.entries()) {
    if (normalizedHost === domain || normalizedHost.endsWith(`.${domain}`)) {
      for (const [name, value] of values.entries()) {
        cookieMap.set(name, value);
      }
    }
  }
  return Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

function applySetCookiesToJar(cookieJar, setCookieValues = [], targetUrl) {
  const targetHost = String(targetUrl?.hostname ?? '').trim().toLowerCase();
  if (!targetHost) return;
  for (const raw of setCookieValues) {
    const parts = String(raw ?? '').split(';').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const [namePart, ...attributes] = parts;
    const [rawName, ...rawValue] = namePart.split('=');
    const name = String(rawName ?? '').trim();
    if (!name) continue;

    let value = rawValue.join('=').trim();
    let domain = targetHost;
    let remove = !value;

    for (const attribute of attributes) {
      const [rawKey, ...rawAttrValue] = attribute.split('=');
      const key = String(rawKey ?? '').trim().toLowerCase();
      const attrValue = rawAttrValue.join('=').trim();
      if (key === 'domain' && attrValue) {
        domain = attrValue.replace(/^\./, '').toLowerCase();
      }
      if (key === 'max-age' && Number(attrValue) <= 0) {
        remove = true;
      }
      if (key === 'expires') {
        const expiresAt = Date.parse(attrValue);
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) remove = true;
      }
    }

    if (!cookieJar.has(domain)) cookieJar.set(domain, new Map());
    const domainJar = cookieJar.get(domain);
    if (remove) {
      domainJar.delete(name);
      if (domainJar.size === 0) cookieJar.delete(domain);
      continue;
    }
    domainJar.set(name, value);
  }
}

function serializeCookieJar(cookieJar) {
  return Array.from(cookieJar.entries()).map(([domain, values]) => ({
    domain,
    cookies: Array.from(values.entries()).map(([name, value]) => ({ name, value })),
  }));
}

function resolveTrafficEntry(capture, entryRef) {
  const entries = Array.isArray(capture?.entries) ? capture.entries : [];
  if (!entryRef && entries.length > 0) return entries[0];

  const exactId = String(entryRef ?? '').trim();
  const byId = entries.find((entry) => String(entry.id) === exactId);
  if (byId) return byId;

  const numeric = Number(entryRef);
  if (Number.isFinite(numeric)) {
    const byOrder = entries.find((entry) => Number(entry.order) === numeric);
    if (byOrder) return byOrder;
    if (numeric >= 0 && numeric < entries.length) return entries[Math.trunc(numeric)];
  }

  return null;
}

export function reverseEngineerTrafficCapture(capture) {
  const serialized = capture?.created_at
    ? serializeTrafficCapture(capture, { includeEntries: true, entryLimit: 200 })
    : {
      id: capture?.id ?? 0,
      name: capture?.name ?? '',
      request_count: Number(capture?.request_count ?? 0),
      hosts: Array.isArray(capture?.hosts) ? capture.hosts : [],
      endpoints: Array.isArray(capture?.endpoints) ? capture.endpoints : [],
      entries: Array.isArray(capture?.entries) ? capture.entries : [],
    };
  const entries = Array.isArray(serialized.entries) ? serialized.entries : [];
  const methodCounts = {};
  const contentTypes = new Set();
  const authHeaders = new Set();
  const cookieNames = new Set();
  const likelyAuthEntries = [];
  const graphqlEntries = [];
  const jsonApiEntries = [];

  for (const entry of entries) {
    methodCounts[entry.method] = (methodCounts[entry.method] ?? 0) + 1;
    if (entry.request_body_mime_type) contentTypes.add(entry.request_body_mime_type);
    if (entry.response_content_type) contentTypes.add(entry.response_content_type);

    for (const pair of entry.headers ?? []) {
      const lower = String(pair.name ?? '').toLowerCase();
      if (/(authorization|x-api-key|x-csrf-token|x-xsrf-token|cookie)/.test(lower)) {
        authHeaders.add(lower);
      }
    }
    for (const pair of entry.cookies ?? []) {
      cookieNames.add(String(pair.name ?? '').toLowerCase());
    }
    if ((entry.notes ?? []).some((note) => /auth|cookie/i.test(note)) || /(login|signin|session|auth|token|refresh)/i.test(entry.path)) {
      likelyAuthEntries.push({
        id: entry.id,
        order: entry.order,
        method: entry.method,
        path: entry.path,
        status: entry.response_status,
      });
    }
    if ((entry.notes ?? []).some((note) => /graphql/i.test(note))) {
      graphqlEntries.push({
        id: entry.id,
        order: entry.order,
        method: entry.method,
        path: entry.path,
      });
    }
    if (/application\/json/i.test(entry.response_content_type) || /application\/json/i.test(entry.request_body_mime_type)) {
      jsonApiEntries.push({
        id: entry.id,
        order: entry.order,
        method: entry.method,
        path: entry.path,
        status: entry.response_status,
      });
    }
  }

  const notes = [];
  if (likelyAuthEntries.length > 0) notes.push('Authentication/session traffic is present in the capture.');
  if (graphqlEntries.length > 0) notes.push('GraphQL traffic is present in the capture.');
  if (jsonApiEntries.length > 0) notes.push('JSON API traffic is present in the capture.');
  if (authHeaders.size > 0 || cookieNames.size > 0) notes.push('Captured requests include reusable auth indicators for replay.');

  return {
    capture_id: serialized.id,
    name: serialized.name,
    request_count: serialized.request_count,
    hosts: serialized.hosts,
    endpoints: serialized.endpoints,
    method_counts: methodCounts,
    content_types: Array.from(contentTypes).slice(0, 20),
    auth_headers: Array.from(authHeaders).slice(0, 20),
    cookie_names: Array.from(cookieNames).slice(0, 20),
    likely_auth_entries: likelyAuthEntries.slice(0, 20),
    graphql_entries: graphqlEntries.slice(0, 20),
    json_api_entries: jsonApiEntries.slice(0, 20),
    notes,
  };
}

export async function replayTrafficCaptureEntry(capture, entryRef, profile, options = {}) {
  const entry = resolveTrafficEntry(capture, entryRef);
  if (!entry) {
    throw new Error(`Traffic capture entry ${String(entryRef ?? '')} was not found.`);
  }

  const target = new URL(entry.url);
  assertReplayHostAllowed(target.host, profile?.scope ?? {}, capture.hosts ?? []);

  const method = String(entry.method ?? 'GET').toUpperCase();
  const headers = buildReplayHeaders(entry);
  const timeoutMs = normalizeNumber(options.timeoutMs ?? options.timeout, 20000, 1000, 120000);
  const body = ['GET', 'HEAD'].includes(method)
    ? undefined
    : entry.request_body_base64
      ? Buffer.from(entry.request_body_base64, 'base64')
      : entry.request_body_text || undefined;

  const response = await fetch(entry.url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseText = await response.text();
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const replayPreview = truncateText(responseText, 4000);
  const originalPreview = truncateText(entry.response_body_preview ?? '', 4000);

  return {
    entry: {
      id: entry.id,
      order: entry.order,
      method: entry.method,
      url: entry.url,
      path: entry.path,
      host: entry.host,
      notes: entry.notes ?? [],
      fetch_template: entry.fetch_template ?? '',
      curl_template: entry.curl_template ?? '',
    },
    request: {
      method,
      url: entry.url,
      headers: Object.fromEntries(headers.entries()),
      body_preview: entry.request_body_text
        ? truncateText(entry.request_body_text, 2000)
        : entry.request_body_base64
          ? '[binary body preserved as base64]'
          : '',
    },
    response: {
      status: response.status,
      status_text: response.statusText,
      headers: responseHeaders,
      body_preview: replayPreview,
    },
    comparison: {
      original_status: Number(entry.response_status ?? 0),
      replay_status: response.status,
      status_matches: Number(entry.response_status ?? 0) === response.status,
      original_content_type: entry.response_content_type ?? '',
      replay_content_type: String(response.headers.get('content-type') ?? ''),
      content_type_matches: String(entry.response_content_type ?? '').split(';')[0].trim().toLowerCase()
        === String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
      original_body_preview: originalPreview,
      replay_body_preview: replayPreview,
    },
  };
}

function selectTrafficFlowEntries(capture, options = {}) {
  const entries = Array.isArray(capture?.entries) ? capture.entries : [];
  if (entries.length === 0) return { entries: [], selected_by: 'empty' };

  const entryRefs = Array.isArray(options.entry_ids ?? options.entryIds)
    ? options.entry_ids ?? options.entryIds
    : Array.isArray(options.entries)
      ? options.entries
      : [];
  if (entryRefs.length > 0) {
    const selected = entryRefs
      .map((entryRef) => resolveTrafficEntry(capture, entryRef))
      .filter(Boolean)
      .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0));
    return {
      entries: selected,
      selected_by: 'entry_ids',
    };
  }

  const chainIndex = Number(options.chain_index ?? options.chainIndex);
  if (Number.isFinite(chainIndex)) {
    const chains = buildTrafficFlowGraph(capture).chains ?? [];
    const chain = chains[Math.max(0, Math.min(chains.length - 1, Math.trunc(chainIndex)))];
    if (chain) {
      return {
        entries: chain.requests
          .map((request) => resolveTrafficEntry(capture, request.id))
          .filter(Boolean),
        selected_by: `chain_index:${Math.trunc(chainIndex)}`,
      };
    }
  }

  const startOrder = Number(options.start_order ?? options.startOrder ?? options.from_order ?? options.fromOrder);
  const endOrder = Number(options.end_order ?? options.endOrder ?? options.to_order ?? options.toOrder);
  if (Number.isFinite(startOrder) || Number.isFinite(endOrder)) {
    const from = Number.isFinite(startOrder) ? startOrder : 1;
    const to = Number.isFinite(endOrder) ? endOrder : Number.MAX_SAFE_INTEGER;
    return {
      entries: entries.filter((entry) => Number(entry.order ?? 0) >= from && Number(entry.order ?? 0) <= to),
      selected_by: `order_range:${from}-${to === Number.MAX_SAFE_INTEGER ? 'end' : to}`,
    };
  }

  const defaultChain = buildTrafficFlowGraph(capture).chains?.[0];
  if (defaultChain) {
    return {
      entries: defaultChain.requests
        .map((request) => resolveTrafficEntry(capture, request.id))
        .filter(Boolean),
      selected_by: 'default_chain',
    };
  }

  return {
    entries: entries.slice(0, 5),
    selected_by: 'first_entries',
  };
}

function buildFlowReplayScript(entries, options = {}) {
  const carryCookies = options.carryCookies !== false;
  const payload = entries.map((entry) => ({
    id: entry.id,
    order: entry.order,
    method: entry.method,
    url: entry.url,
    headers: entry.headers ?? [],
    cookies: entry.cookies ?? [],
    request_body_text: entry.request_body_text ?? '',
    request_body_base64: entry.request_body_base64 ?? '',
  }));
  return `const entries = ${JSON.stringify(payload, null, 2)};
const carryCookies = ${carryCookies ? 'true' : 'false'};
const cookieJar = new Map();

function mergeCookieHeader(originalPairs = [], headerValue = '') {
  const cookieMap = new Map();
  for (const pair of originalPairs) {
    if (pair?.name) cookieMap.set(String(pair.name), String(pair.value ?? ''));
  }
  for (const chunk of String(headerValue || '').split(';')) {
    const [rawName, ...rawValue] = chunk.split('=');
    const name = String(rawName || '').trim();
    if (!name) continue;
    cookieMap.set(name, rawValue.join('=').trim());
  }
  return Array.from(cookieMap.entries()).map(([name, value]) => \`\${name}=\${value}\`).join('; ');
}

function getCookieHeader(host) {
  const normalizedHost = String(host || '').toLowerCase();
  const cookieMap = new Map();
  for (const [domain, values] of cookieJar.entries()) {
    if (normalizedHost === domain || normalizedHost.endsWith(\`.\${domain}\`)) {
      for (const [name, value] of values.entries()) cookieMap.set(name, value);
    }
  }
  return Array.from(cookieMap.entries()).map(([name, value]) => \`\${name}=\${value}\`).join('; ');
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return String(combined).split(/,(?=[^;,]+=)/).map((value) => value.trim()).filter(Boolean);
}

function applySetCookies(host, values = []) {
  const normalizedHost = String(host || '').toLowerCase();
  for (const raw of values) {
    const parts = String(raw || '').split(';').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const [namePart, ...attributes] = parts;
    const [rawName, ...rawValue] = namePart.split('=');
    const name = String(rawName || '').trim();
    if (!name) continue;
    let domain = normalizedHost;
    let value = rawValue.join('=').trim();
    let remove = !value;
    for (const attribute of attributes) {
      const [rawKey, ...rawAttrValue] = attribute.split('=');
      const key = String(rawKey || '').trim().toLowerCase();
      const attrValue = rawAttrValue.join('=').trim();
      if (key === 'domain' && attrValue) domain = attrValue.replace(/^\\./, '').toLowerCase();
      if (key === 'max-age' && Number(attrValue) <= 0) remove = true;
    }
    if (!cookieJar.has(domain)) cookieJar.set(domain, new Map());
    const domainJar = cookieJar.get(domain);
    if (remove) {
      domainJar.delete(name);
      if (domainJar.size === 0) cookieJar.delete(domain);
    } else {
      domainJar.set(name, value);
    }
  }
}

(async () => {
  for (const entry of entries) {
    const headers = new Headers();
    for (const pair of entry.headers || []) {
      const lower = String(pair.name || '').toLowerCase();
      if (!pair.name || ['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding'].includes(lower)) continue;
      headers.set(pair.name, pair.value ?? '');
    }

    const url = new URL(entry.url);
    const cookieHeader = carryCookies ? mergeCookieHeader(entry.cookies, getCookieHeader(url.hostname)) : mergeCookieHeader(entry.cookies);
    if (cookieHeader) headers.set('cookie', cookieHeader);

    const body = ['GET', 'HEAD'].includes(String(entry.method || 'GET').toUpperCase())
      ? undefined
      : entry.request_body_base64
        ? Buffer.from(entry.request_body_base64, 'base64')
        : entry.request_body_text || undefined;

    const response = await fetch(entry.url, {
      method: entry.method,
      headers,
      body,
      redirect: 'manual',
    });
    const responseText = await response.text();
    if (carryCookies) applySetCookies(url.hostname, getSetCookieValues(response.headers));
    console.log({
      order: entry.order,
      method: entry.method,
      url: entry.url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bodyPreview: responseText.slice(0, 500),
    });
  }
})();`;
}

export async function replayTrafficCaptureFlow(capture, profile, options = {}) {
  const selection = selectTrafficFlowEntries(capture, options);
  const selectedEntries = selection.entries;
  if (selectedEntries.length === 0) {
    throw new Error('No replayable entries were selected for this flow.');
  }

  const timeoutMs = normalizeNumber(options.timeoutMs ?? options.timeout, 20000, 1000, 120000);
  const carryCookies = options.carryCookies !== false;
  const stopOnFailure = options.stopOnFailure === true;
  const cookieJar = new Map();
  const steps = [];
  let matchedStatuses = 0;
  let matchedContentTypes = 0;
  let failures = 0;

  for (const entry of selectedEntries) {
    try {
      const target = new URL(entry.url);
      assertReplayHostAllowed(target.host, profile?.scope ?? {}, capture.hosts ?? []);

      const method = String(entry.method ?? 'GET').toUpperCase();
      const headers = buildReplayHeaders(entry);
      const carriedCookieHeader = carryCookies ? getCookieJarHeader(cookieJar, target.host) : '';
      const mergedCookies = mergeCookiePairs(entry.cookies ?? [], carriedCookieHeader);
      if (mergedCookies.length > 0) {
        headers.set('cookie', mergedCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
      }

      const body = ['GET', 'HEAD'].includes(method)
        ? undefined
        : entry.request_body_base64
          ? Buffer.from(entry.request_body_base64, 'base64')
          : entry.request_body_text || undefined;

      const response = await fetch(entry.url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });

      const responseText = await response.text();
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const setCookieValues = getSetCookieValuesFromHeaders(response.headers);
      if (carryCookies && setCookieValues.length > 0) {
        applySetCookiesToJar(cookieJar, setCookieValues, target);
      }

      const contentTypeMatches = String(entry.response_content_type ?? '').split(';')[0].trim().toLowerCase()
        === String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const statusMatches = Number(entry.response_status ?? 0) === response.status;
      if (statusMatches) matchedStatuses += 1;
      if (contentTypeMatches) matchedContentTypes += 1;

      steps.push({
        entry_id: entry.id,
        order: entry.order,
        method,
        url: entry.url,
        request_headers: Object.fromEntries(headers.entries()),
        request_body_preview: entry.request_body_text
          ? truncateText(entry.request_body_text, 2000)
          : entry.request_body_base64
            ? '[binary body preserved as base64]'
            : '',
        cookies_sent: mergedCookies.map((cookie) => cookie.name),
        response_status: response.status,
        response_status_text: response.statusText,
        response_headers: responseHeaders,
        response_body_preview: truncateText(responseText, 4000),
        status_matches: statusMatches,
        content_type_matches: contentTypeMatches,
        cookies_set: setCookieValues.map((value) => String(value).split('=')[0].trim()).filter(Boolean),
        notes: entry.notes ?? [],
      });
    } catch (error) {
      failures += 1;
      steps.push({
        entry_id: entry.id,
        order: entry.order,
        method: entry.method,
        url: entry.url,
        request_headers: {},
        request_body_preview: entry.request_body_text
          ? truncateText(entry.request_body_text, 2000)
          : entry.request_body_base64
            ? '[binary body preserved as base64]'
            : '',
        cookies_sent: [],
        response_status: 0,
        response_status_text: '',
        response_headers: {},
        response_body_preview: '',
        status_matches: false,
        content_type_matches: false,
        cookies_set: [],
        notes: [...(entry.notes ?? []), `Replay error: ${error instanceof Error ? error.message : String(error)}`],
        error: error instanceof Error ? error.message : String(error),
      });
      if (stopOnFailure) break;
    }
  }

  return {
    chain: {
      capture_id: capture.id,
      capture_name: capture.name ?? '',
      selected_by: selection.selected_by,
      entry_ids: selectedEntries.map((entry) => entry.id),
      start_order: selectedEntries[0]?.order ?? 0,
      end_order: selectedEntries[selectedEntries.length - 1]?.order ?? 0,
      carry_cookies: carryCookies,
    },
    steps,
    summary: {
      total_steps: steps.length,
      matched_statuses: matchedStatuses,
      matched_content_types: matchedContentTypes,
      failures,
      final_cookie_jar: serializeCookieJar(cookieJar),
    },
    node_script: buildFlowReplayScript(selectedEntries, { carryCookies }),
  };
}

function applyTrafficMutations(entry, mutations = {}) {
  const mutated = JSON.parse(JSON.stringify(entry));

  if (mutations.method) {
    mutated.method = String(mutations.method).toUpperCase();
  }

  const url = new URL(String(mutations.url ?? mutated.url));
  if (mutations.path) {
    url.pathname = safePath(mutations.path);
  }

  const queryOverrides = mutations.query_overrides ?? mutations.queryOverrides ?? {};
  if (queryOverrides && typeof queryOverrides === 'object' && !Array.isArray(queryOverrides)) {
    for (const [key, value] of Object.entries(queryOverrides)) {
      if (value === null || value === undefined || value === false) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const queryRemovals = Array.isArray(mutations.remove_query_keys ?? mutations.removeQueryKeys)
    ? mutations.remove_query_keys ?? mutations.removeQueryKeys
    : [];
  for (const key of queryRemovals) {
    url.searchParams.delete(String(key));
  }

  const headerOverrides = mutations.header_overrides ?? mutations.headerOverrides ?? {};
  if (headerOverrides && typeof headerOverrides === 'object' && !Array.isArray(headerOverrides)) {
    const headers = new Map((mutated.headers ?? []).map((pair) => [String(pair.name).toLowerCase(), { name: String(pair.name), value: String(pair.value) }]));
    for (const [key, value] of Object.entries(headerOverrides)) {
      if (value === null || value === undefined || value === false) {
        headers.delete(String(key).toLowerCase());
      } else {
        headers.set(String(key).toLowerCase(), { name: String(key), value: String(value) });
      }
    }
    mutated.headers = Array.from(headers.values());
  }

  const headerRemovals = Array.isArray(mutations.remove_headers ?? mutations.removeHeaders)
    ? mutations.remove_headers ?? mutations.removeHeaders
    : [];
  if (headerRemovals.length > 0) {
    const removeSet = new Set(headerRemovals.map((entry) => String(entry).toLowerCase()));
    mutated.headers = (mutated.headers ?? []).filter((pair) => !removeSet.has(String(pair.name ?? '').toLowerCase()));
  }

  const cookieOverrides = mutations.cookie_overrides ?? mutations.cookieOverrides ?? {};
  if (cookieOverrides && typeof cookieOverrides === 'object' && !Array.isArray(cookieOverrides)) {
    const cookies = new Map((mutated.cookies ?? []).map((pair) => [String(pair.name).toLowerCase(), { name: String(pair.name), value: String(pair.value) }]));
    for (const [key, value] of Object.entries(cookieOverrides)) {
      if (value === null || value === undefined || value === false) {
        cookies.delete(String(key).toLowerCase());
      } else {
        cookies.set(String(key).toLowerCase(), { name: String(key), value: String(value) });
      }
    }
    mutated.cookies = Array.from(cookies.values());
  }

  const cookieRemovals = Array.isArray(mutations.remove_cookies ?? mutations.removeCookies)
    ? mutations.remove_cookies ?? mutations.removeCookies
    : [];
  if (cookieRemovals.length > 0) {
    const removeSet = new Set(cookieRemovals.map((entry) => String(entry).toLowerCase()));
    mutated.cookies = (mutated.cookies ?? []).filter((pair) => !removeSet.has(String(pair.name ?? '').toLowerCase()));
  }

  if (mutations.body_text !== undefined || mutations.bodyText !== undefined) {
    mutated.request_body_text = String(mutations.body_text ?? mutations.bodyText ?? '');
    mutated.request_body_base64 = '';
    if (mutations.body_mime_type || mutations.bodyMimeType) {
      mutated.request_body_mime_type = String(mutations.body_mime_type ?? mutations.bodyMimeType);
    }
  } else if (mutations.body_json_merge || mutations.bodyJsonMerge) {
    const mergeObject = mutations.body_json_merge ?? mutations.bodyJsonMerge;
    const parsedBody = safeJsonParse(mutated.request_body_text ?? '');
    if (parsedBody && typeof parsedBody === 'object' && mergeObject && typeof mergeObject === 'object' && !Array.isArray(mergeObject)) {
      mutated.request_body_text = JSON.stringify({ ...parsedBody, ...mergeObject });
      mutated.request_body_base64 = '';
      if (!mutated.request_body_mime_type) mutated.request_body_mime_type = 'application/json';
    }
  }

  mutated.url = url.toString();
  mutated.host = url.host;
  mutated.path = safePath(url.pathname);
  mutated.query = url.search ?? '';
  mutated.notes = deriveHarEntryNotes(mutated);
  mutated.fetch_template = buildFetchTemplate(mutated);
  mutated.curl_template = buildCurlTemplate(mutated);
  return mutated;
}

export async function mutateTrafficCaptureEntry(capture, entryRef, profile, mutations = {}, options = {}) {
  const original = resolveTrafficEntry(capture, entryRef);
  if (!original) {
    throw new Error(`Traffic capture entry ${String(entryRef ?? '')} was not found.`);
  }
  const mutated = applyTrafficMutations(original, mutations);
  const captureValue = typeof capture?.toObject === 'function' ? capture.toObject() : capture;
  const replay = await replayTrafficCaptureEntry(
    { ...captureValue, entries: [mutated], hosts: captureValue?.hosts ?? [] },
    mutated.id,
    profile,
    options,
  );
  return {
    mutations,
    original: {
      id: original.id,
      order: original.order,
      method: original.method,
      url: original.url,
      headers: original.headers ?? [],
      cookies: original.cookies ?? [],
      body_preview: original.request_body_text
        ? truncateText(original.request_body_text, 2000)
        : original.request_body_base64
          ? '[binary body preserved as base64]'
          : '',
    },
    mutated: {
      id: mutated.id,
      order: mutated.order,
      method: mutated.method,
      url: mutated.url,
      headers: mutated.headers ?? [],
      cookies: mutated.cookies ?? [],
      body_preview: mutated.request_body_text
        ? truncateText(mutated.request_body_text, 2000)
        : mutated.request_body_base64
          ? '[binary body preserved as base64]'
          : '',
      fetch_template: mutated.fetch_template,
      curl_template: mutated.curl_template,
    },
    replay,
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeSecuritySeverity(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return SECURITY_SEVERITIES.includes(normalized) ? normalized : 'medium';
}

export function normalizeFindingStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return FINDING_STATUSES.includes(normalized) ? normalized : 'open';
}

export function normalizeSecurityScope(value = {}) {
  return {
    allowed_hosts: uniqueTrimmedList(value.allowed_hosts ?? value.allowedHosts, 30),
    start_urls: uniqueTrimmedList(value.start_urls ?? value.startUrls, 30),
    blocked_hosts: uniqueTrimmedList(value.blocked_hosts ?? value.blockedHosts, 30),
    allow_production: normalizeBoolean(value.allow_production ?? value.allowProduction, false),
    max_depth: normalizeNumber(value.max_depth ?? value.maxDepth, 4, 1, 12),
    notes: String(value.notes ?? '').trim(),
  };
}

export function normalizeAuthProfiles(value) {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry, index) => ({
      id: String(entry?.id ?? `auth-${index + 1}`).trim() || `auth-${index + 1}`,
      name: String(entry?.name ?? '').trim(),
      kind: String(entry?.kind ?? 'session').trim() || 'session',
      start_url: String(entry?.start_url ?? entry?.startUrl ?? '').trim(),
      login_path: String(entry?.login_path ?? entry?.loginPath ?? '').trim(),
      username_secret_key: String(entry?.username_secret_key ?? entry?.usernameSecretKey ?? '').trim(),
      password_secret_key: String(entry?.password_secret_key ?? entry?.passwordSecretKey ?? '').trim(),
      otp_notes: String(entry?.otp_notes ?? entry?.otpNotes ?? '').trim(),
      role: String(entry?.role ?? '').trim(),
      notes: String(entry?.notes ?? '').trim(),
      enabled: normalizeBoolean(entry?.enabled, true),
    }))
    .filter((entry) => entry.name)
    .slice(0, 20);
}

export function normalizeContinuousScans(value) {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry, index) => ({
      id: String(entry?.id ?? `scan-${index + 1}`).trim() || `scan-${index + 1}`,
      name: String(entry?.name ?? '').trim(),
      cadence: String(entry?.cadence ?? 'manual').trim() || 'manual',
      target: String(entry?.target ?? '').trim(),
      workflow: String(entry?.workflow ?? '').trim(),
      enabled: normalizeBoolean(entry?.enabled, true),
      last_run_at: entry?.last_run_at ? new Date(entry.last_run_at) : entry?.lastRunAt ? new Date(entry.lastRunAt) : null,
    }))
    .filter((entry) => entry.name)
    .slice(0, 20);
}

export function normalizeCustomCheckPayload(value = {}) {
  return {
    name: String(value.name ?? '').trim(),
    description: String(value.description ?? '').trim(),
    kind: String(value.kind ?? 'regex').trim().toLowerCase() || 'regex',
    severity: normalizeSecuritySeverity(value.severity),
    pattern: String(value.pattern ?? '').trim(),
    file_glob: String(value.file_glob ?? value.fileGlob ?? '').trim(),
    dependency_name: String(value.dependency_name ?? value.dependencyName ?? '').trim(),
    remediation: String(value.remediation ?? '').trim(),
    standards: uniqueTrimmedList(value.standards, 10),
    tags: uniqueTrimmedList(value.tags, 12),
    enabled: normalizeBoolean(value.enabled, true),
  };
}

function globToRegex(glob) {
  const escaped = String(glob ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function fileMatchesCheck(filePath, fileGlob) {
  if (!fileGlob) return true;
  try {
    return globToRegex(fileGlob).test(filePath);
  } catch {
    return filePath.toLowerCase().includes(String(fileGlob).toLowerCase());
  }
}

function buildDedupeKey(parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('::')).digest('hex');
}

function summarizeEvidenceLines(content, pattern, maxLines = 4) {
  const lines = String(content ?? '').split('\n');
  const results = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      results.push(`L${index + 1}: ${lines[index].trim()}`);
      if (results.length >= maxLines) break;
    }
  }
  return results.join('\n');
}

function parsePackageJson(files) {
  const packageFile = files.find((file) => file.path === 'package.json');
  const packageJson = safeJsonParse(packageFile?.content ?? '');
  return packageJson && typeof packageJson === 'object' ? packageJson : {};
}

function detectProjectStack(files) {
  const packageJson = parsePackageJson(files);
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  const depNames = new Set(Object.keys(dependencies).map((name) => name.toLowerCase()));
  const filePaths = new Set(files.map((file) => file.path.toLowerCase()));
  const stack = [];
  if (depNames.has('next')) stack.push('Next.js');
  if (depNames.has('react')) stack.push('React');
  if (depNames.has('express')) stack.push('Express');
  if (depNames.has('mongoose')) stack.push('MongoDB');
  if (depNames.has('puppeteer') || depNames.has('puppeteer-core')) stack.push('Puppeteer');
  if (depNames.has('fastify')) stack.push('Fastify');
  if (depNames.has('hono')) stack.push('Hono');
  if (depNames.has('koa')) stack.push('Koa');
  if (depNames.has('helmet')) stack.push('Helmet');
  if (filePaths.has('runner/server.js')) stack.push('Remote runner');
  return Array.from(new Set(stack));
}

function extractRouteLiterals(content) {
  const routes = new Set();
  const routePatterns = [
    /\b(?:app|router)\.(?:get|post|put|patch|delete|options|head|use)\(\s*['"`]([^'"`]+)['"`]/g,
    /\bfetch\(\s*['"`]([^'"`]+)['"`]/g,
    /\baxios\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g,
    /\b(?:href|to|action)=["']([^"']+)["']/g,
  ];

  for (const pattern of routePatterns) {
    for (const match of content.matchAll(pattern)) {
      const route = String(match[1] ?? '').trim();
      if (route.startsWith('/')) routes.add(route);
    }
  }
  return Array.from(routes);
}

function extractExternalHosts(content) {
  const hosts = new Set();
  for (const match of String(content ?? '').matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#]|$)/gi)) {
    hosts.add(String(match[1]).toLowerCase());
  }
  return Array.from(hosts);
}

function detectApiSpec(file) {
  const lowerPath = String(file.path ?? '').toLowerCase();
  const content = String(file.content ?? '');
  if (!/(openapi|swagger)/i.test(lowerPath) && !/(^|\n)\s*openapi\s*:|["']openapi["']\s*:/i.test(content)) {
    return null;
  }

  const titleMatch = content.match(/title["']?\s*:\s*["']?([^\n"']+)/i);
  const versionMatch = content.match(/version["']?\s*:\s*["']?([^\n"']+)/i);
  const pathMatches = [...content.matchAll(/^\s{0,4}\/[A-Za-z0-9_./:{}-]+\s*:/gm)].map((match) => match[0].replace(/:\s*$/, '').trim());
  return {
    path: file.path,
    title: titleMatch?.[1]?.trim() ?? path.basename(file.path),
    version: versionMatch?.[1]?.trim() ?? '',
    endpoints: Array.from(new Set(pathMatches)).slice(0, 50),
  };
}

export function summarizeApiSpecs(files, docs = []) {
  const fileSpecs = files.map((file) => detectApiSpec(file)).filter(Boolean);
  const docSpecs = (docs ?? [])
    .map((doc) => detectApiSpec({ path: doc.title, content: doc.content }))
    .filter(Boolean);
  return [...fileSpecs, ...docSpecs];
}

function looksLikeMinified(content) {
  const lines = String(content ?? '').split('\n');
  if (lines.length <= 2) return String(content ?? '').length > 800;
  const averageLineLength = lines.reduce((sum, line) => sum + line.length, 0) / Math.max(lines.length, 1);
  return averageLineLength > 220 || lines.some((line) => line.length > 900);
}

function extractGraphQLOperations(content) {
  const operations = new Set();
  for (const match of String(content ?? '').matchAll(/\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    operations.add(String(match[1]));
  }
  for (const match of String(content ?? '').matchAll(/operationName["']?\s*[:=]\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) {
    operations.add(String(match[1]));
  }
  return Array.from(operations);
}

function extractSourceMapRefs(content) {
  const refs = [];
  for (const match of String(content ?? '').matchAll(/[#@]\s*sourceMappingURL=([^\s]+)/g)) {
    refs.push(String(match[1]).trim());
  }
  return Array.from(new Set(refs));
}

function extractStorageKeys(content, storageName) {
  const keys = new Set();
  const pattern = new RegExp(`${storageName}\\.(?:getItem|setItem|removeItem)\\(\\s*['"\\x60]([^'"\\x60]+)['"\\x60]`, 'g');
  for (const match of String(content ?? '').matchAll(pattern)) {
    keys.add(String(match[1]));
  }
  return Array.from(keys);
}

function extractCookieWrites(content) {
  const cookies = new Set();
  for (const match of String(content ?? '').matchAll(/document\.cookie\s*=\s*['"`]([^='"`;]+)=/g)) {
    cookies.add(String(match[1]));
  }
  for (const match of String(content ?? '').matchAll(/Cookies\.(?:set|get)\(\s*['"`]([^'"`]+)['"`]/g)) {
    cookies.add(String(match[1]));
  }
  return Array.from(cookies);
}

function extractHeaderHints(content) {
  const headers = new Set();
  for (const match of String(content ?? '').matchAll(/['"`](Authorization|X-API-Key|X-CSRF-Token|X-XSRF-Token|X-Requested-With|Cookie|Set-Cookie)['"`]/g)) {
    headers.add(String(match[1]));
  }
  return Array.from(headers);
}

function extractDynamicImports(content) {
  const imports = new Set();
  for (const match of String(content ?? '').matchAll(/import\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
    imports.add(String(match[1]));
  }
  return Array.from(imports);
}

function extractWebSocketTargets(content) {
  const targets = new Set();
  for (const match of String(content ?? '').matchAll(/wss?:\/\/[^\s'"`]+/g)) {
    targets.add(String(match[0]));
  }
  for (const match of String(content ?? '').matchAll(/new\s+WebSocket\(\s*['"`]([^'"`]+)['"`]/g)) {
    targets.add(String(match[1]));
  }
  return Array.from(targets);
}

function summarizeBundleCandidate(file, content) {
  const endpointCandidates = extractRouteLiterals(content);
  const graphQl = extractGraphQLOperations(content);
  const websockets = extractWebSocketTargets(content);
  const sourceMaps = extractSourceMapRefs(content);
  const authHeaders = extractHeaderHints(content);
  const storageKeys = [
    ...extractStorageKeys(content, 'localStorage'),
    ...extractStorageKeys(content, 'sessionStorage'),
  ];
  const cookieWrites = extractCookieWrites(content);
  const dynamicImports = extractDynamicImports(content);
  const signals = [];

  if (looksLikeMinified(content)) signals.push('minified');
  if (endpointCandidates.length > 0) signals.push('api-endpoints');
  if (graphQl.length > 0) signals.push('graphql');
  if (websockets.length > 0) signals.push('websocket');
  if (authHeaders.length > 0) signals.push('auth-headers');
  if (storageKeys.length > 0 || cookieWrites.length > 0) signals.push('session-storage');
  if (sourceMaps.length > 0) signals.push('source-map');

  return {
    path: file.path,
    language: file.language ?? '',
    size: String(content ?? '').length,
    minified: looksLikeMinified(content),
    signals,
    endpoint_candidates: endpointCandidates.slice(0, 20),
    graphql_operations: graphQl.slice(0, 20),
    websocket_targets: websockets.slice(0, 10),
    source_maps: sourceMaps.slice(0, 10),
    auth_headers: authHeaders.slice(0, 20),
    storage_keys: storageKeys.slice(0, 20),
    cookie_writes: cookieWrites.slice(0, 20),
    dynamic_imports: dynamicImports.slice(0, 20),
  };
}

export function analyzeProjectReverseEngineering(project, files, docs = [], trafficCaptures = []) {
  const fileCandidates = [];
  const endpointCandidates = new Set();
  const graphQlOps = new Set();
  const websocketTargets = new Set();
  const sourceMapRefs = new Set();
  const authHeaders = new Set();
  const localStorageKeys = new Set();
  const sessionStorageKeys = new Set();
  const cookieWrites = new Set();
  const dynamicImports = new Set();
  const absoluteHosts = new Set();

  for (const file of files) {
    const lowerPath = String(file.path ?? '').toLowerCase();
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|html|vue|svelte)$/.test(lowerPath) && !/dist\/assets|bundle|chunk|min\.js/.test(lowerPath)) {
      continue;
    }
    const content = String(file.content ?? '');
    const candidate = summarizeBundleCandidate(file, content);
    if (candidate.signals.length === 0) continue;
    fileCandidates.push(candidate);

    for (const value of candidate.endpoint_candidates) endpointCandidates.add(value);
    for (const value of candidate.graphql_operations) graphQlOps.add(value);
    for (const value of candidate.websocket_targets) websocketTargets.add(value);
    for (const value of candidate.source_maps) sourceMapRefs.add(value);
    for (const value of candidate.auth_headers) authHeaders.add(value);
    for (const value of candidate.dynamic_imports) dynamicImports.add(value);
    for (const value of candidate.cookie_writes) cookieWrites.add(value);

    for (const value of extractStorageKeys(content, 'localStorage')) localStorageKeys.add(value);
    for (const value of extractStorageKeys(content, 'sessionStorage')) sessionStorageKeys.add(value);
    for (const host of extractExternalHosts(content)) absoluteHosts.add(host);
  }

  const apiSpecs = summarizeApiSpecs(files, docs);
  const trafficSummaries = Array.isArray(trafficCaptures)
    ? trafficCaptures.slice(0, 10).map((capture) => reverseEngineerTrafficCapture(capture))
    : [];

  const notes = [];
  if (fileCandidates.some((candidate) => candidate.minified)) notes.push('Minified or bundled frontend assets were detected and analyzed.');
  if (sourceMapRefs.size > 0) notes.push('Source map references were found; they can help recover original symbol names and source layout.');
  if (graphQlOps.size > 0) notes.push('GraphQL operations were extracted from source or bundle content.');
  if (websocketTargets.size > 0) notes.push('WebSocket targets were found in the client-side code.');
  if (trafficSummaries.some((summary) => (summary.likely_auth_entries ?? []).length > 0)) notes.push('Imported traffic contains auth/session flows that can anchor reverse engineering.');

  return {
    project: project.name,
    stack: detectProjectStack(files),
    api_specs: apiSpecs,
    endpoint_candidates: Array.from(endpointCandidates).slice(0, 100),
    absolute_hosts: Array.from(absoluteHosts).slice(0, 50),
    graphql_operations: Array.from(graphQlOps).slice(0, 50),
    websocket_targets: Array.from(websocketTargets).slice(0, 30),
    source_map_refs: Array.from(sourceMapRefs).slice(0, 30),
    auth_headers: Array.from(authHeaders).slice(0, 30),
    local_storage_keys: Array.from(localStorageKeys).slice(0, 30),
    session_storage_keys: Array.from(sessionStorageKeys).slice(0, 30),
    cookie_writes: Array.from(cookieWrites).slice(0, 30),
    dynamic_imports: Array.from(dynamicImports).slice(0, 30),
    bundle_candidates: fileCandidates
      .sort((left, right) => right.signals.length - left.signals.length || right.size - left.size)
      .slice(0, 25),
    traffic_summaries: trafficSummaries,
    notes,
  };
}

function extractSetCookieNames(headers) {
  const cookieNames = new Set();
  for (const pair of headers ?? []) {
    if (String(pair.name ?? '').toLowerCase() !== 'set-cookie') continue;
    const name = String(pair.value ?? '').split('=')[0].trim();
    if (name) cookieNames.add(name);
  }
  return Array.from(cookieNames);
}

export function buildTrafficFlowGraph(capture) {
  const serialized = capture?.created_at
    ? serializeTrafficCapture(capture, { includeEntries: true, entryLimit: 200 })
    : {
      id: capture?.id ?? 0,
      name: capture?.name ?? '',
      entries: Array.isArray(capture?.entries) ? capture.entries : [],
    };
  const entries = Array.isArray(serialized.entries) ? serialized.entries : [];
  const nodes = entries.map((entry) => ({
    id: entry.id,
    order: entry.order,
    label: `${entry.method} ${entry.path}`,
    status: entry.response_status,
    host: entry.host,
    notes: entry.notes ?? [],
  }));
  const edges = [];
  const chains = [];

  let currentChain = [];
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    currentChain.push({
      id: current.id,
      order: current.order,
      method: current.method,
      path: current.path,
      status: current.response_status,
    });

    const next = entries[index + 1];
    if (next) {
      if (current.host === next.host) {
        edges.push({ from: current.id, to: next.id, type: 'sequence', reason: 'Same-host sequential request' });
      }

      const nextReferer = (next.headers ?? []).find((pair) => String(pair.name ?? '').toLowerCase() === 'referer')?.value ?? '';
      if (nextReferer && nextReferer === current.url) {
        edges.push({ from: current.id, to: next.id, type: 'referer', reason: 'Next request referer points to current URL' });
      }

      const setCookieNames = extractSetCookieNames(current.response_headers);
      if (setCookieNames.length > 0) {
        const nextCookieNames = new Set((next.cookies ?? []).map((pair) => String(pair.name ?? '').toLowerCase()));
        const overlap = setCookieNames.filter((name) => nextCookieNames.has(name.toLowerCase()));
        if (overlap.length > 0) {
          edges.push({ from: current.id, to: next.id, type: 'cookie', reason: `Cookies reused: ${overlap.join(', ')}` });
        }
      }
    }

    const chainBreak = !next || current.host !== next.host;
    if (chainBreak) {
      chains.push({
        host: current.host,
        start_order: currentChain[0]?.order ?? current.order,
        end_order: currentChain[currentChain.length - 1]?.order ?? current.order,
        length: currentChain.length,
        requests: currentChain,
      });
      currentChain = [];
    }
  }

  return {
    capture_id: serialized.id,
    name: serialized.name,
    node_count: nodes.length,
    edge_count: edges.length,
    nodes: nodes.slice(0, 200),
    edges: edges.slice(0, 300),
    chains: chains.slice(0, 40),
  };
}

function standardHintsFor(category, title, details = '') {
  const text = `${category} ${title} ${details}`.toLowerCase();
  const standards = new Set();

  if (/xss|html injection|innerhtml|dangerouslysetinnerhtml|v-html|svelte:html/.test(text)) {
    standards.add('OWASP ASVS 5.3');
    standards.add('OWASP WSTG-INPV-01');
  }
  if (/secret|token|password|apikey|api key|credential/.test(text)) {
    standards.add('OWASP ASVS 8.3');
    standards.add('OWASP WSTG-CONF-05');
  }
  if (/command injection|exec|spawn/.test(text)) {
    standards.add('OWASP ASVS 5.4');
    standards.add('OWASP WSTG-INPV-12');
  }
  if (/path traversal|directory traversal/.test(text)) {
    standards.add('OWASP ASVS 16.2');
    standards.add('OWASP WSTG-ATHZ-01');
  }
  if (/cors|origin/.test(text)) {
    standards.add('OWASP ASVS 14.4');
    standards.add('OWASP WSTG-CONF-06');
  }
  if (/auth|session|login|jwt/.test(text)) {
    standards.add('OWASP ASVS 2.1');
    standards.add('OWASP WSTG-ATHN-01');
  }
  if (/docker|iac|terraform|github actions|workflow|yaml/.test(text)) {
    standards.add('OWASP ASVS 1.14');
    standards.add('OWASP WSTG-CONF-04');
  }

  return Array.from(standards);
}

export async function ensureProjectSecurityProfile(projectId, userId) {
  let profile = await ProjectSecurityProfile.findOne({ project_id: projectId, user_id: userId });
  if (profile) return profile;

  profile = await ProjectSecurityProfile.create({
    project_id: projectId,
    user_id: userId,
    scope: normalizeSecurityScope({}),
    auth_profiles: [],
    continuous_scans: [],
    updated_at: new Date(),
  });
  return profile;
}

export function buildAttackSurfaceSummary(project, files, docs = [], trafficCaptures = []) {
  const allContents = files.map((file) => String(file.content ?? ''));
  const routes = new Set();
  const authFiles = [];
  const formFiles = [];
  const envFiles = [];
  const ciFiles = [];
  const infraFiles = [];
  const externalHosts = new Set();
  const apiSpecs = summarizeApiSpecs(files, docs);

  for (const file of files) {
    const lowerPath = file.path.toLowerCase();
    const content = String(file.content ?? '');

    for (const route of extractRouteLiterals(content)) routes.add(route);
    for (const host of extractExternalHosts(content)) externalHosts.add(host);

    if (/(auth|login|session|token|jwt|oauth)/i.test(lowerPath)) authFiles.push(file.path);
    if (/<form\b|type=["']password["']|smart_fill_form|login/i.test(content)) formFiles.push(file.path);
    if (/^\.env(\.|$)|secrets?/.test(path.basename(lowerPath))) envFiles.push(file.path);
    if (/^\.github\/workflows\/.+\.ya?ml$/.test(lowerPath) || /gitlab-ci|bitbucket-pipelines/i.test(lowerPath)) ciFiles.push(file.path);
    if (/dockerfile|docker-compose|terraform|\.tf$|k8s|helm|compose\.ya?ml|vercel\.json|netlify\.toml/i.test(lowerPath)) infraFiles.push(file.path);
  }

  for (const capture of trafficCaptures) {
    for (const host of capture.hosts ?? []) externalHosts.add(host);
    for (const endpoint of capture.endpoints ?? []) routes.add(endpoint);
  }

  const packageJson = parsePackageJson(files);
  const scripts = Object.entries(packageJson.scripts ?? {}).slice(0, 8).map(([key, value]) => `${key}=${String(value)}`);
  const stack = detectProjectStack(files);

  return {
    project: project.name,
    stack,
    scripts,
    routes: Array.from(routes).slice(0, 100),
    auth_files: authFiles.slice(0, 20),
    form_files: formFiles.slice(0, 20),
    env_files: envFiles.slice(0, 20),
    ci_files: ciFiles.slice(0, 20),
    infra_files: infraFiles.slice(0, 20),
    api_specs: apiSpecs,
    external_hosts: Array.from(externalHosts).slice(0, 50),
    traffic_captures: Array.isArray(trafficCaptures)
      ? trafficCaptures.map((capture) => ({
        id: capture.id,
        name: capture.name,
        request_count: capture.request_count,
      }))
      : [],
    summary: [
      `${stack.length > 0 ? stack.join(', ') : 'Unknown stack'}.`,
      `${routes.size} route${routes.size === 1 ? '' : 's'} discovered.`,
      `${apiSpecs.length} API spec${apiSpecs.length === 1 ? '' : 's'} found.`,
      `${authFiles.length} auth-related file${authFiles.length === 1 ? '' : 's'}.`,
      `${formFiles.length} form-related file${formFiles.length === 1 ? '' : 's'}.`,
    ].join(' '),
    notes: allContents.some((content) => /helmet/i.test(content))
      ? 'Helmet-related protection detected in codebase.'
      : 'No obvious Helmet usage detected in the scanned source.',
  };
}

function pushFinding(findings, finding) {
  const normalized = {
    ...finding,
    severity: normalizeSecuritySeverity(finding.severity),
    status: normalizeFindingStatus(finding.status),
    affected_paths: uniqueTrimmedList(finding.affected_paths, 20),
    affected_urls: uniqueTrimmedList(finding.affected_urls, 20),
    standards: uniqueTrimmedList([
      ...(finding.standards ?? []),
      ...standardHintsFor(finding.category, finding.title, `${finding.summary ?? ''}\n${finding.impact ?? ''}`),
    ], 10),
    tags: uniqueTrimmedList(finding.tags, 12),
    evidence: Array.isArray(finding.evidence)
      ? finding.evidence.map((entry) => ({
        label: String(entry.label ?? '').trim(),
        details: String(entry.details ?? '').trim(),
        source: String(entry.source ?? '').trim(),
      })).filter((entry) => entry.label || entry.details)
      : [],
    reproduction_steps: uniqueTrimmedList(finding.reproduction_steps, 12),
    source: String(finding.source ?? 'scanner').trim() || 'scanner',
  };

  normalized.dedupe_key = normalized.dedupe_key || buildDedupeKey([
    normalized.category,
    normalized.title,
    normalized.affected_paths.join(','),
    normalized.affected_urls.join(','),
  ]);

  const existing = findings.find((entry) => entry.dedupe_key === normalized.dedupe_key);
  if (!existing) {
    findings.push(normalized);
    return;
  }

  existing.evidence = uniqueTrimmedList([
    ...existing.evidence.map((entry) => `${entry.label} ${entry.details}`),
    ...normalized.evidence.map((entry) => `${entry.label} ${entry.details}`),
  ], 6).map((entry) => ({ label: 'Evidence', details: entry, source: normalized.source }));
  existing.affected_paths = uniqueTrimmedList([...existing.affected_paths, ...normalized.affected_paths], 20);
  existing.affected_urls = uniqueTrimmedList([...existing.affected_urls, ...normalized.affected_urls], 20);
  existing.standards = uniqueTrimmedList([...existing.standards, ...normalized.standards], 10);
  existing.tags = uniqueTrimmedList([...existing.tags, ...normalized.tags], 12);
}

function runBuiltInChecks(project, files, docs = []) {
  const findings = [];
  const packageJson = parsePackageJson(files);
  const allFilePaths = new Set(files.map((file) => file.path.toLowerCase()));

  for (const file of files) {
    const content = String(file.content ?? '');
    const lowerPath = file.path.toLowerCase();

    const secretPattern = /\b(?:api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*['"`]([^'"`\n]{8,})['"`]/gi;
    if (secretPattern.test(content) && !/example|sample|placeholder|changeme|process\.env|import\.meta\.env/i.test(content)) {
      pushFinding(findings, {
        title: 'Potential hardcoded secret in source',
        category: 'secret exposure',
        severity: lowerPath.startsWith('.env') ? 'high' : 'medium',
        summary: 'Source code appears to contain a hardcoded secret-like value instead of a runtime secret reference.',
        impact: 'Committed secrets can be leaked through source access, logs, previews, or client bundles.',
        recommendation: 'Move the value into a scoped secret store or environment variable and rotate it if it was ever committed.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Match',
          details: summarizeEvidenceLines(content, /\b(?:api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*['"`]([^'"`\n]{8,})['"`]/i),
          source: file.path,
        }],
        tags: ['secrets', 'sast'],
      });
    }

    if (/\beval\s*\(|new Function\s*\(/.test(content)) {
      pushFinding(findings, {
        title: 'Dynamic code execution primitive present',
        category: 'code injection',
        severity: 'high',
        summary: 'The codebase uses eval or Function constructor style execution.',
        impact: 'Dynamic execution widens injection risk and makes untrusted-input handling much harder to reason about.',
        recommendation: 'Replace dynamic execution with explicit dispatch or vetted parsing logic.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Code',
          details: summarizeEvidenceLines(content, /\beval\s*\(|new Function\s*\(/),
          source: file.path,
        }],
        tags: ['sast'],
      });
    }

    if (/dangerouslySetInnerHTML|innerHTML\s*=|v-html|svelte:html/.test(content)) {
      pushFinding(findings, {
        title: 'Raw HTML rendering surface detected',
        category: 'xss',
        severity: 'medium',
        summary: 'The frontend renders raw HTML directly.',
        impact: 'Unsanitized HTML sinks can turn stored or reflected content into script execution.',
        recommendation: 'Use a sanitizer or a safer rendering approach before writing to raw HTML sinks.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Sink',
          details: summarizeEvidenceLines(content, /dangerouslySetInnerHTML|innerHTML\s*=|v-html|svelte:html/),
          source: file.path,
        }],
        tags: ['frontend', 'sast'],
      });
    }

    if (/\b(?:exec|execSync|spawn|spawnSync)\s*\(/.test(content) && /\breq\.(?:body|query|params)|ctx\.request|request\./.test(content)) {
      pushFinding(findings, {
        title: 'Command execution path appears to touch request data',
        category: 'command injection',
        severity: 'high',
        summary: 'Shell execution helpers appear near request-controlled values.',
        impact: 'Unsafe interpolation into process execution can become remote command execution.',
        recommendation: 'Avoid shell execution for request input or strictly validate and pass arguments as an array.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Command flow',
          details: summarizeEvidenceLines(content, /\b(?:exec|execSync|spawn|spawnSync)\s*\(|\breq\.(?:body|query|params)|ctx\.request|request\./),
          source: file.path,
        }],
        tags: ['backend', 'sast'],
      });
    }

    if (/\bpath\.(?:join|resolve)\s*\([^\n]+req\.(?:body|query|params)/.test(content) || /\bfs\.(?:readFile|writeFile|createReadStream|createWriteStream)\s*\([^\n]+req\.(?:body|query|params)/.test(content)) {
      pushFinding(findings, {
        title: 'Potential path traversal input flow',
        category: 'path traversal',
        severity: 'high',
        summary: 'Filesystem path construction appears to include request data directly.',
        impact: 'Request-controlled paths can escape intended directories and expose sensitive files.',
        recommendation: 'Normalize, validate, and boundary-check request-derived paths before filesystem access.',
        affected_paths: [file.path],
        evidence: [{
          label: 'File access',
          details: summarizeEvidenceLines(content, /\bpath\.(?:join|resolve)\s*\([^\n]+req\.(?:body|query|params)|\bfs\.(?:readFile|writeFile|createReadStream|createWriteStream)\s*\([^\n]+req\.(?:body|query|params)/),
          source: file.path,
        }],
        tags: ['backend', 'sast'],
      });
    }

    if (/\b(?:md5|sha1)\b/i.test(content)) {
      pushFinding(findings, {
        title: 'Weak hash primitive referenced in code',
        category: 'crypto weakness',
        severity: 'medium',
        summary: 'The code references MD5 or SHA1 hashing.',
        impact: 'Weak hashes are inappropriate for passwords, integrity decisions, or sensitive token derivation.',
        recommendation: 'Use modern password hashing or stronger hashing primitives appropriate to the use case.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Weak hash',
          details: summarizeEvidenceLines(content, /\b(?:md5|sha1)\b/i),
          source: file.path,
        }],
        tags: ['sast', 'crypto'],
      });
    }

    if (/localStorage\.(?:setItem|getItem)\([^\n]{0,80}(token|jwt|session|auth)/i.test(content)) {
      pushFinding(findings, {
        title: 'Sensitive auth material appears to use localStorage',
        category: 'session handling',
        severity: 'medium',
        summary: 'Frontend code stores session-like data in localStorage.',
        impact: 'Stored auth material is easier to steal through XSS or browser extension compromise.',
        recommendation: 'Prefer httpOnly cookies or shorter-lived scoped browser storage where possible.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Storage use',
          details: summarizeEvidenceLines(content, /localStorage\.(?:setItem|getItem)\([^\n]{0,80}(token|jwt|session|auth)/i),
          source: file.path,
        }],
        tags: ['frontend', 'session'],
      });
    }

    if (path.basename(lowerPath) === 'dockerfile' && !/^\s*user\s+/im.test(content)) {
      pushFinding(findings, {
        title: 'Dockerfile does not switch away from root',
        category: 'iac',
        severity: 'medium',
        summary: 'The container image appears to run as the default root user.',
        impact: 'A runtime compromise gets stronger privileges inside the container by default.',
        recommendation: 'Add a non-root USER for the runtime stage and scope filesystem permissions accordingly.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Dockerfile',
          details: 'No USER directive detected in Dockerfile.',
          source: file.path,
        }],
        tags: ['iac'],
      });
    }

    if (/^\.github\/workflows\/.+\.ya?ml$/i.test(lowerPath) && /(echo\s+.*secrets?\.|::add-mask::)/i.test(content)) {
      pushFinding(findings, {
        title: 'CI workflow may expose sensitive values in logs',
        category: 'ci security',
        severity: 'medium',
        summary: 'Workflow steps appear to echo secret-adjacent values.',
        impact: 'Build logs can accidentally leak credentials or tokens to anyone with workflow visibility.',
        recommendation: 'Avoid printing secret values and prefer masked environment references.',
        affected_paths: [file.path],
        evidence: [{
          label: 'Workflow',
          details: summarizeEvidenceLines(content, /(echo\s+.*secrets?\.|::add-mask::)/i),
          source: file.path,
        }],
        tags: ['ci', 'iac'],
      });
    }
  }

  const serverIndex = files.find((file) => file.path === 'server/index.js');
  if (serverIndex && /cors\s*\(\s*\{[\s\S]*origin\s*:\s*(?:true|['"`]\*['"`])[\s\S]*credentials\s*:\s*true[\s\S]*\}\s*\)/i.test(serverIndex.content ?? '')) {
    pushFinding(findings, {
      title: 'CORS configuration allows broad origins with credentials',
      category: 'cors',
      severity: 'high',
      summary: 'The backend appears to accept broad origins while also enabling credentials.',
      impact: 'Credentialed cross-origin access can expose authenticated APIs to untrusted origins.',
      recommendation: 'Restrict credentialed CORS to a small allowlist of trusted origins.',
      affected_paths: [serverIndex.path],
      evidence: [{
        label: 'Config',
        details: summarizeEvidenceLines(serverIndex.content ?? '', /cors\s*\(\s*\{[\s\S]*origin\s*:\s*(?:true|['"`]\*['"`])[\s\S]*credentials\s*:\s*true[\s\S]*\}\s*\)/i),
        source: serverIndex.path,
      }],
      tags: ['backend', 'headers'],
    });
  }

  if (serverIndex && !/helmet\s*\(/i.test(serverIndex.content ?? '') && detectProjectStack(files).includes('Express')) {
    pushFinding(findings, {
      title: 'No obvious Helmet middleware detected',
      category: 'hardening',
      severity: 'info',
      summary: 'The Express server does not appear to use Helmet-style default security headers.',
      impact: 'Missing baseline headers can weaken clickjacking, MIME sniffing, and browser-side protections.',
      recommendation: 'Consider adding Helmet or an equivalent baseline security-header policy.',
      affected_paths: [serverIndex.path],
      evidence: [{
        label: 'Server setup',
        details: 'Express server detected without an obvious helmet() call.',
        source: serverIndex.path,
      }],
      tags: ['headers', 'hardening'],
    });
  }

  const hasLockfile = allFilePaths.has('package-lock.json') || allFilePaths.has('pnpm-lock.yaml') || allFilePaths.has('yarn.lock');
  if (packageJson.name && !hasLockfile) {
    pushFinding(findings, {
      title: 'JavaScript project lacks a package-manager lockfile',
      category: 'supply chain',
      severity: 'low',
      summary: 'The project includes package.json without a corresponding lockfile.',
      impact: 'Dependency resolution can drift across environments and weaken reproducibility for review or incident response.',
      recommendation: 'Commit a package lockfile so builds and audits run against deterministic dependency versions.',
      affected_paths: ['package.json'],
      evidence: [{
        label: 'Dependencies',
        details: 'package.json exists but no package-lock.json, pnpm-lock.yaml, or yarn.lock was detected.',
        source: 'package.json',
      }],
      tags: ['sca'],
    });
  }

  if (docs.some((doc) => /openapi|swagger/i.test(doc.title) || /(^|\n)\s*openapi\s*:/i.test(doc.content ?? ''))) {
    pushFinding(findings, {
      title: 'API specification detected and ready for deeper contract testing',
      category: 'api security',
      severity: 'info',
      summary: 'An API spec exists in project docs or files, which is a strong foundation for authenticated API testing.',
      impact: 'This is not a vulnerability by itself, but it highlights a surface the agent can now exercise more systematically.',
      recommendation: 'Use the API spec with the security workflow to generate auth, fuzzing, and negative-path checks.',
      affected_paths: summarizeApiSpecs(files, docs).map((entry) => entry.path),
      evidence: [{
        label: 'Spec',
        details: summarizeApiSpecs(files, docs).map((entry) => `${entry.path}${entry.version ? ` (${entry.version})` : ''}`).join('\n'),
        source: 'api-spec',
      }],
      tags: ['api'],
      source: 'surface-map',
    });
  }

  return findings;
}

function runCustomChecks(files, checks = []) {
  const findings = [];
  const packageJson = parsePackageJson(files);
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  for (const check of checks) {
    if (!check.enabled) continue;
    const normalized = normalizeCustomCheckPayload(check);
    if (!normalized.name) continue;

    if (normalized.kind === 'dependency') {
      if (normalized.dependency_name && dependencies[normalized.dependency_name]) {
        pushFinding(findings, {
          title: normalized.name,
          category: 'custom dependency check',
          severity: normalized.severity,
          summary: normalized.description || `Dependency ${normalized.dependency_name} matched a custom security rule.`,
          recommendation: normalized.remediation,
          affected_paths: ['package.json'],
          standards: normalized.standards,
          tags: normalized.tags,
          source: 'custom-check',
          dedupe_key: buildDedupeKey(['custom-dependency', normalized.name, normalized.dependency_name]),
          evidence: [{
            label: 'Dependency',
            details: `${normalized.dependency_name}@${dependencies[normalized.dependency_name]}`,
            source: 'package.json',
          }],
        });
      }
      continue;
    }

    for (const file of files) {
      if (!fileMatchesCheck(file.path, normalized.file_glob)) continue;
      const content = String(file.content ?? '');

      if (normalized.kind === 'path' && file.path.toLowerCase().includes(normalized.pattern.toLowerCase())) {
        pushFinding(findings, {
          title: normalized.name,
          category: 'custom path check',
          severity: normalized.severity,
          summary: normalized.description || 'A custom path rule matched this file.',
          recommendation: normalized.remediation,
          affected_paths: [file.path],
          standards: normalized.standards,
          tags: normalized.tags,
          source: 'custom-check',
          dedupe_key: buildDedupeKey(['custom-path', normalized.name, file.path]),
          evidence: [{
            label: 'Path match',
            details: file.path,
            source: file.path,
          }],
        });
        continue;
      }

      if (normalized.kind === 'regex' || normalized.kind === 'text') {
        const pattern = normalized.kind === 'text'
          ? new RegExp(normalized.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
          : new RegExp(normalized.pattern, 'i');
        if (pattern.test(content)) {
          pushFinding(findings, {
            title: normalized.name,
            category: 'custom content check',
            severity: normalized.severity,
            summary: normalized.description || 'A custom content rule matched this file.',
            recommendation: normalized.remediation,
            affected_paths: [file.path],
            standards: normalized.standards,
            tags: normalized.tags,
            source: 'custom-check',
            dedupe_key: buildDedupeKey(['custom-content', normalized.name, file.path]),
            evidence: [{
              label: 'Rule match',
              details: summarizeEvidenceLines(content, pattern),
              source: file.path,
            }],
          });
        }
      }
    }
  }

  return findings;
}

export async function runSecurityScan(project, files, docs = [], options = {}) {
  const trafficCaptures = Array.isArray(options.trafficCaptures) ? options.trafficCaptures : [];
  const customChecks = Array.isArray(options.customChecks) ? options.customChecks : [];
  const attackSurface = buildAttackSurfaceSummary(project, files, docs, trafficCaptures);
  const builtInFindings = runBuiltInChecks(project, files, docs);
  const customFindings = runCustomChecks(files, customChecks);
  const findings = [];

  for (const finding of [...builtInFindings, ...customFindings]) {
    pushFinding(findings, finding);
  }

  return {
    attack_surface: attackSurface,
    api_specs: summarizeApiSpecs(files, docs),
    findings,
  };
}

export async function persistSecurityFindings(projectId, userId, rawFindings, options = {}) {
  const persisted = [];
  for (const rawFinding of rawFindings) {
    const finding = {
      ...rawFinding,
      severity: normalizeSecuritySeverity(rawFinding.severity),
      status: normalizeFindingStatus(rawFinding.status),
      affected_paths: uniqueTrimmedList(rawFinding.affected_paths, 20),
      affected_urls: uniqueTrimmedList(rawFinding.affected_urls, 20),
      standards: uniqueTrimmedList(rawFinding.standards, 10),
      tags: uniqueTrimmedList(rawFinding.tags, 12),
      reproduction_steps: uniqueTrimmedList(rawFinding.reproduction_steps, 12),
      evidence: Array.isArray(rawFinding.evidence) ? rawFinding.evidence : [],
      source: String(rawFinding.source ?? options.source ?? 'scanner').trim() || 'scanner',
      dedupe_key: String(rawFinding.dedupe_key ?? '').trim() || buildDedupeKey([
        rawFinding.category,
        rawFinding.title,
        ...(rawFinding.affected_paths ?? []),
        ...(rawFinding.affected_urls ?? []),
      ]),
      task_id: Number.isFinite(Number(options.taskId ?? rawFinding.task_id)) ? Number(options.taskId ?? rawFinding.task_id) : null,
    };

    let doc = finding.dedupe_key
      ? await SecurityFinding.findOne({ project_id: projectId, dedupe_key: finding.dedupe_key })
      : null;

    if (!doc) {
      doc = await SecurityFinding.create({
        id: await nextSequence('security_findings'),
        project_id: projectId,
        user_id: userId,
        ...finding,
        created_at: new Date(),
        updated_at: new Date(),
      });
    } else {
      Object.assign(doc, finding, { updated_at: new Date() });
      if (finding.status === 'fixed' && !doc.fixed_at) {
        doc.fixed_at = new Date();
      }
      await doc.save();
    }

    persisted.push(doc);
  }
  return persisted.map(serializeSecurityFinding);
}

export function buildSecurityReportMarkdown(project, findings, profile = null, extras = {}) {
  const openFindings = findings.filter((finding) => finding.status !== 'fixed');
  const bySeverity = SECURITY_SEVERITIES.reduce((acc, severity) => {
    acc[severity] = findings.filter((finding) => finding.severity === severity).length;
    return acc;
  }, {});

  const attackSurface = extras.attack_surface ?? null;
  const apiSpecs = Array.isArray(extras.api_specs) ? extras.api_specs : [];
  const trafficCaptures = Array.isArray(extras.traffic_captures) ? extras.traffic_captures : [];

  return [
    `# Security Evidence Pack: ${project.name}`,
    '',
    '## Executive Summary',
    `- Total findings: ${findings.length}`,
    `- Open findings: ${openFindings.length}`,
    `- Critical: ${bySeverity.critical}`,
    `- High: ${bySeverity.high}`,
    `- Medium: ${bySeverity.medium}`,
    `- Low: ${bySeverity.low}`,
    `- Info: ${bySeverity.info}`,
    '',
    '## Scope',
    profile
      ? `- Allowed hosts: ${(profile.scope?.allowed_hosts ?? []).join(', ') || 'Not set'}`
      : '- Allowed hosts: Not set',
    profile
      ? `- Start URLs: ${(profile.scope?.start_urls ?? []).join(', ') || 'Not set'}`
      : '- Start URLs: Not set',
    profile
      ? `- Blocked hosts: ${(profile.scope?.blocked_hosts ?? []).join(', ') || 'Not set'}`
      : '- Blocked hosts: Not set',
    profile
      ? `- Production testing allowed: ${profile.scope?.allow_production ? 'Yes' : 'No'}`
      : '- Production testing allowed: No',
    '',
    attackSurface ? '## Attack Surface' : null,
    attackSurface ? `- Stack: ${(attackSurface.stack ?? []).join(', ') || 'Unknown'}` : null,
    attackSurface ? `- Routes discovered: ${(attackSurface.routes ?? []).length}` : null,
    attackSurface ? `- Auth-related files: ${(attackSurface.auth_files ?? []).join(', ') || 'None detected'}` : null,
    attackSurface ? `- External hosts: ${(attackSurface.external_hosts ?? []).join(', ') || 'None detected'}` : null,
    '',
    apiSpecs.length > 0 ? '## API Specs' : null,
    ...apiSpecs.flatMap((spec) => [
      `- ${spec.title}${spec.version ? ` (${spec.version})` : ''}: ${spec.path}`,
      ...(spec.endpoints ?? []).slice(0, 10).map((endpoint) => `  ${endpoint}`),
    ]),
    '',
    trafficCaptures.length > 0 ? '## Traffic Captures' : null,
    ...trafficCaptures.map((capture) => `- ${capture.name}: ${capture.request_count} requests across ${(capture.hosts ?? []).length} host(s)`),
    '',
    '## Findings',
    ...findings.flatMap((finding, index) => [
      `### ${index + 1}. [${String(finding.severity ?? 'medium').toUpperCase()}] ${finding.title}`,
      `- Status: ${finding.status ?? 'open'}`,
      finding.category ? `- Category: ${finding.category}` : null,
      finding.summary ? `- Summary: ${finding.summary}` : null,
      finding.impact ? `- Impact: ${finding.impact}` : null,
      finding.recommendation ? `- Recommendation: ${finding.recommendation}` : null,
      Array.isArray(finding.affected_paths) && finding.affected_paths.length > 0 ? `- Affected paths: ${finding.affected_paths.join(', ')}` : null,
      Array.isArray(finding.affected_urls) && finding.affected_urls.length > 0 ? `- Affected URLs: ${finding.affected_urls.join(', ')}` : null,
      Array.isArray(finding.standards) && finding.standards.length > 0 ? `- Standards: ${finding.standards.join(', ')}` : null,
      Array.isArray(finding.reproduction_steps) && finding.reproduction_steps.length > 0 ? `- Reproduction: ${finding.reproduction_steps.join(' | ')}` : null,
      finding.regression_check ? `- Regression check: ${finding.regression_check}` : null,
      finding.fix_validation ? `- Fix validation: ${finding.fix_validation}` : null,
      Array.isArray(finding.evidence) && finding.evidence.length > 0 ? '- Evidence:' : null,
      ...(Array.isArray(finding.evidence) ? finding.evidence.map((entry) => `  - ${entry.label || 'Evidence'}: ${entry.details}`) : []),
      '',
    ]),
  ].filter(Boolean).join('\n');
}

export async function createSecurityReport(project, userId, params = {}) {
  const findingIds = Array.isArray(params.finding_ids ?? params.findingIds)
    ? (params.finding_ids ?? params.findingIds).map((entry) => Number(entry)).filter(Number.isFinite)
    : [];
  const findings = findingIds.length > 0
    ? await SecurityFinding.find({ project_id: project.id, user_id: userId, id: { $in: findingIds } }).sort({ severity: 1, updated_at: -1 })
    : await SecurityFinding.find({ project_id: project.id, user_id: userId }).sort({ severity: 1, updated_at: -1 });
  const profile = await ensureProjectSecurityProfile(project.id, userId);
  const markdown = buildSecurityReportMarkdown(project, findings.map(serializeSecurityFinding), serializeProjectSecurityProfile(profile), {
    attack_surface: params.attack_surface,
    api_specs: params.api_specs,
    traffic_captures: params.traffic_captures,
  });
  const report = await SecurityReport.create({
    id: await nextSequence('security_reports'),
    project_id: project.id,
    user_id: userId,
    title: String(params.title ?? `Security report ${new Date().toISOString().slice(0, 10)}`).trim(),
    summary: String(params.summary ?? `Generated from ${findings.length} finding${findings.length === 1 ? '' : 's'}.`).trim(),
    status: String(params.status ?? 'draft').trim() || 'draft',
    finding_ids: findings.map((finding) => finding.id),
    scope_snapshot: JSON.stringify(serializeProjectSecurityProfile(profile).scope, null, 2),
    generated_markdown: markdown,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return serializeSecurityReport(report);
}

export async function createSecurityOastSession(projectId, userId, label, baseUrl) {
  const token = crypto.randomBytes(18).toString('hex');
  const callbackUrl = `${String(baseUrl ?? '').replace(/\/$/, '')}/api/oast/${token}`;
  const session = await SecurityOastSession.create({
    id: await nextSequence('security_oast_sessions'),
    project_id: projectId,
    user_id: userId,
    label: String(label ?? '').trim(),
    token,
    callback_url: callbackUrl,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return serializeSecurityOastSession(session);
}

export async function recordOastHit(token, requestInfo = {}) {
  const session = await SecurityOastSession.findOne({ token: String(token ?? '').trim() });
  if (!session) return null;

  const hit = {
    method: String(requestInfo.method ?? 'GET').trim() || 'GET',
    path: safePath(requestInfo.path ?? '/'),
    query: String(requestInfo.query ?? '').slice(0, 2000),
    headers: requestInfo.headers ?? {},
    body_preview: String(requestInfo.body_preview ?? requestInfo.bodyPreview ?? '').slice(0, 4000),
    ip: String(requestInfo.ip ?? '').trim(),
    created_at: new Date(),
  };

  session.hit_count = Number(session.hit_count ?? 0) + 1;
  session.last_hit_at = new Date();
  session.updated_at = new Date();
  session.hits = [...(session.hits ?? []), hit].slice(-25);
  await session.save();
  return serializeSecurityOastSession(session);
}

export async function importTrafficCapture(projectId, userId, payload = {}) {
  const raw = payload.har ?? payload.capture ?? payload.raw ?? payload;
  const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  const entries = Array.isArray(parsed?.log?.entries) ? parsed.log.entries : Array.isArray(parsed?.entries) ? parsed.entries : [];

  const hosts = new Set();
  const endpoints = new Set();
  const requestLines = [];
  const normalizedEntries = [];

  for (const entry of entries.slice(0, 500)) {
    const method = String(entry?.request?.method ?? 'GET').toUpperCase();
    const rawUrl = String(entry?.request?.url ?? '').trim();
    if (!rawUrl) continue;
    try {
      const url = new URL(rawUrl);
      hosts.add(url.host);
      endpoints.add(`${method} ${safePath(url.pathname)}`);
      requestLines.push(`${method} ${url.origin}${safePath(url.pathname)}`);
    } catch {}
  }

  for (const [index, entry] of entries.slice(0, 150).entries()) {
    const normalizedEntry = normalizeHarEntry(entry, index);
    if (normalizedEntry) normalizedEntries.push(normalizedEntry);
  }

  const reverseEngineering = normalizedEntries.length > 0
    ? reverseEngineerTrafficCapture({ id: 0, name: payload.name ?? '', request_count: entries.length, hosts: Array.from(hosts), endpoints: Array.from(endpoints), entries: normalizedEntries })
    : null;

  const capture = await TrafficCapture.create({
    id: await nextSequence('traffic_captures'),
    project_id: projectId,
    user_id: userId,
    name: String(payload.name ?? `Traffic import ${new Date().toISOString().slice(0, 10)}`).trim(),
    source: String(payload.source ?? 'har').trim() || 'har',
    request_count: entries.length,
    hosts: Array.from(hosts).slice(0, 50),
    endpoints: Array.from(endpoints).slice(0, 100),
    summary: reverseEngineering
      ? `${entries.length} requests across ${hosts.size} host${hosts.size === 1 ? '' : 's'}. ${reverseEngineering.notes.join(' ')}`.trim()
      : `${entries.length} requests across ${hosts.size} host${hosts.size === 1 ? '' : 's'}.`,
    raw_excerpt: requestLines.slice(0, 120).join('\n'),
    entries: normalizedEntries,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return serializeTrafficCapture(capture);
}

export function buildTrafficCaptureDetail(capture) {
  return {
    capture: serializeTrafficCapture(capture, { includeEntries: true, entryLimit: 200 }),
    reverse_engineering: reverseEngineerTrafficCapture(capture),
  };
}

export async function loadProjectSecurityContext(projectId, userId) {
  const [profile, checks, findings, reports, oastSessions, trafficCaptures] = await Promise.all([
    ensureProjectSecurityProfile(projectId, userId),
    SecurityCustomCheck.find({ project_id: projectId, user_id: userId }).sort({ updated_at: -1 }),
    SecurityFinding.find({ project_id: projectId, user_id: userId }).sort({ updated_at: -1 }).limit(100),
    SecurityReport.find({ project_id: projectId, user_id: userId }).sort({ updated_at: -1 }).limit(20),
    SecurityOastSession.find({ project_id: projectId, user_id: userId }).sort({ updated_at: -1 }).limit(20),
    TrafficCapture.find({ project_id: projectId, user_id: userId }).sort({ updated_at: -1 }).limit(20),
  ]);

  return {
    profile: serializeProjectSecurityProfile(profile),
    checks: checks.map(serializeSecurityCustomCheck),
    findings: findings.map(serializeSecurityFinding),
    reports: reports.map(serializeSecurityReport),
    oast_sessions: oastSessions.map(serializeSecurityOastSession),
    traffic_captures: trafficCaptures.map(serializeTrafficCapture),
  };
}
