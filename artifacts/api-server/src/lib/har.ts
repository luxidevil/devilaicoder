import { promises as fs } from "node:fs";
import * as pathLib from "node:path";

export interface HarHeader { name: string; value: string }
export interface HarRequest {
  method: string;
  url: string;
  httpVersion?: string;
  headers: HarHeader[];
  queryString?: HarHeader[];
  postData?: { mimeType?: string; text?: string; params?: HarHeader[] };
  cookies?: HarHeader[];
  bodySize?: number;
  headersSize?: number;
}
export interface HarResponse {
  status: number;
  statusText?: string;
  httpVersion?: string;
  headers: HarHeader[];
  content?: { size?: number; mimeType?: string; text?: string; encoding?: string };
  redirectURL?: string;
  bodySize?: number;
}
export interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request: HarRequest;
  response: HarResponse;
  _resourceType?: string;
  cache?: any;
  timings?: any;
}
export interface Har { log: { entries: HarEntry[]; pages?: any[]; creator?: any; version?: string } }

const PROJECT_ROOT_GUARD = (projectDir: string, harPath: string): string => {
  const projAbs = pathLib.resolve(projectDir);
  const tmpAbs = pathLib.resolve("/tmp");
  const target = pathLib.resolve(harPath.startsWith("/") ? harPath : pathLib.join(projAbs, harPath));
  if (!target.startsWith(projAbs + pathLib.sep) && target !== projAbs &&
      !target.startsWith(tmpAbs + pathLib.sep) && target !== tmpAbs) {
    throw new Error(`Refusing HAR path outside projectDir or /tmp: ${target}`);
  }
  return target;
};

export async function loadHar(projectDir: string, harPath: string): Promise<Har> {
  const abs = PROJECT_ROOT_GUARD(projectDir, harPath);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error(`Not a file: ${abs}`);
  if (stat.size > 200 * 1024 * 1024) throw new Error(`HAR too large (>200MB): ${stat.size} bytes`);
  const buf = await fs.readFile(abs, "utf8");
  let parsed: any;
  try { parsed = JSON.parse(buf); } catch (e: any) { throw new Error(`Invalid JSON: ${e.message}`); }
  if (!parsed?.log?.entries || !Array.isArray(parsed.log.entries)) {
    throw new Error("Not a valid HAR file (missing log.entries[])");
  }
  return parsed as Har;
}

function findHeader(headers: HarHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) if (h.name.toLowerCase() === lower) return h.value;
  return undefined;
}

function hostOf(url: string): string { try { return new URL(url).host; } catch { return "?"; } }
function pathOf(url: string): string { try { const u = new URL(url); return u.pathname + (u.search || ""); } catch { return url; } }

export interface HarSummary {
  totalEntries: number;
  uniqueHosts: string[];
  statusBreakdown: Record<string, number>;
  methodBreakdown: Record<string, number>;
  resourceTypes: Record<string, number>;
  totalDurationMs: number;
  slowest: Array<{ idx: number; method: string; url: string; status: number; ms: number }>;
  failures: Array<{ idx: number; method: string; url: string; status: number; statusText?: string; preview?: string }>;
  authDetected: { bearerCount: number; basicCount: number; cookieAuthCount: number; csrfHeaderCount: number };
  cookies: string[];
  redirects: Array<{ idx: number; from: string; to: string; status: number }>;
  largestResponses: Array<{ idx: number; url: string; bytes: number; mimeType?: string }>;
}

export function summarizeHar(har: Har, opts: { topN?: number } = {}): HarSummary {
  const topN = opts.topN ?? 8;
  const entries = har.log.entries;
  const hosts = new Set<string>();
  const statuses: Record<string, number> = {};
  const methods: Record<string, number> = {};
  const resTypes: Record<string, number> = {};
  let totalMs = 0;
  const slow: HarSummary["slowest"] = [];
  const fail: HarSummary["failures"] = [];
  const big: HarSummary["largestResponses"] = [];
  const redirects: HarSummary["redirects"] = [];
  const cookieSet = new Set<string>();
  const auth = { bearerCount: 0, basicCount: 0, cookieAuthCount: 0, csrfHeaderCount: 0 };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    hosts.add(hostOf(e.request.url));
    methods[e.request.method] = (methods[e.request.method] || 0) + 1;
    const sc = String(e.response.status || 0);
    statuses[sc] = (statuses[sc] || 0) + 1;
    if (e._resourceType) resTypes[e._resourceType] = (resTypes[e._resourceType] || 0) + 1;
    const ms = Number(e.time || 0);
    totalMs += ms;
    slow.push({ idx: i, method: e.request.method, url: e.request.url, status: e.response.status, ms });
    const auth1 = findHeader(e.request.headers, "authorization");
    if (auth1) {
      if (/^bearer\s+/i.test(auth1)) auth.bearerCount++;
      else if (/^basic\s+/i.test(auth1)) auth.basicCount++;
    }
    if (findHeader(e.request.headers, "cookie")) auth.cookieAuthCount++;
    for (const hn of ["x-csrf-token", "x-xsrf-token", "csrf-token", "x-requested-with"]) {
      if (findHeader(e.request.headers, hn)) { auth.csrfHeaderCount++; break; }
    }
    const ck = findHeader(e.request.headers, "cookie");
    if (ck) for (const part of ck.split(";")) { const k = part.split("=")[0]?.trim(); if (k) cookieSet.add(k); }
    const setCk = e.response.headers?.filter(h => h.name.toLowerCase() === "set-cookie") || [];
    for (const h of setCk) { const k = h.value.split("=")[0]?.trim(); if (k) cookieSet.add(k); }

    if (e.response.status >= 400) {
      const text = e.response.content?.text || "";
      fail.push({ idx: i, method: e.request.method, url: e.request.url, status: e.response.status, statusText: e.response.statusText, preview: text.slice(0, 240) });
    }
    if (e.response.status >= 300 && e.response.status < 400 && e.response.redirectURL) {
      redirects.push({ idx: i, from: e.request.url, to: e.response.redirectURL, status: e.response.status });
    }
    const bodySize = e.response.content?.size || e.response.bodySize || 0;
    if (bodySize > 0) big.push({ idx: i, url: e.request.url, bytes: bodySize, mimeType: e.response.content?.mimeType });
  }

  slow.sort((a, b) => b.ms - a.ms);
  big.sort((a, b) => b.bytes - a.bytes);
  return {
    totalEntries: entries.length,
    uniqueHosts: Array.from(hosts).sort(),
    statusBreakdown: statuses,
    methodBreakdown: methods,
    resourceTypes: resTypes,
    totalDurationMs: Math.round(totalMs),
    slowest: slow.slice(0, topN),
    failures: fail.slice(0, topN),
    authDetected: auth,
    cookies: Array.from(cookieSet).sort(),
    redirects: redirects.slice(0, topN),
    largestResponses: big.slice(0, topN),
  };
}

const FORBIDDEN_REPLAY_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding", "expect",
  "upgrade", "trailer", "te", "keep-alive", "proxy-authorization", "proxy-connection",
  "accept-encoding", // node fetch will handle this
]);

export interface ReplayResult {
  idx: number;
  method: string;
  url: string;
  originalStatus: number;
  replayStatus: number | null;
  match: boolean;
  durationMs: number;
  error?: string;
  bodyDiffPreview?: string;
}

export interface ReplayOptions {
  indices?: number[];
  filter?: "failed" | "all" | "non-2xx";
  maxRequests?: number;
  perRequestTimeoutMs?: number;
  baseUrlOverride?: string;
  extraHeaders?: Record<string, string>;
  diffBody?: boolean;
}

export async function replayHar(har: Har, opts: ReplayOptions = {}): Promise<ReplayResult[]> {
  const { indices, filter = "all", maxRequests = 25, perRequestTimeoutMs = 15_000, baseUrlOverride, extraHeaders, diffBody = true } = opts;
  const out: ReplayResult[] = [];
  let candidates: number[] = [];
  if (indices?.length) candidates = indices.filter(i => i >= 0 && i < har.log.entries.length);
  else {
    for (let i = 0; i < har.log.entries.length; i++) {
      const s = har.log.entries[i].response.status;
      if (filter === "failed" && s < 400) continue;
      if (filter === "non-2xx" && s >= 200 && s < 300) continue;
      candidates.push(i);
    }
  }
  candidates = candidates.slice(0, maxRequests);

  for (const idx of candidates) {
    const e = har.log.entries[idx];
    let target = e.request.url;
    if (baseUrlOverride) {
      try {
        const orig = new URL(e.request.url);
        const ovr = new URL(baseUrlOverride);
        orig.protocol = ovr.protocol; orig.host = ovr.host; orig.port = ovr.port;
        target = orig.toString();
      } catch { /* leave original */ }
    }
    const headers: Record<string, string> = {};
    for (const h of (e.request.headers || [])) {
      const k = h.name.toLowerCase();
      if (k.startsWith(":")) continue; // HTTP/2 pseudo
      if (FORBIDDEN_REPLAY_HEADERS.has(k)) continue;
      headers[h.name] = h.value;
    }
    if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;

    const ac = new AbortController();
    const tHandle = setTimeout(() => ac.abort(), perRequestTimeoutMs);
    const t0 = Date.now();
    try {
      const init: RequestInit = { method: e.request.method, headers, signal: ac.signal };
      if (e.request.postData?.text && !["GET", "HEAD"].includes(e.request.method.toUpperCase())) {
        init.body = e.request.postData.text;
      }
      const resp = await fetch(target, init);
      const text = await resp.text().catch(() => "");
      const dur = Date.now() - t0;
      let bodyDiffPreview: string | undefined;
      if (diffBody) {
        const orig = (e.response.content?.text || "").trim();
        if (orig && text && orig !== text) {
          const a = orig.slice(0, 240).replace(/\n/g, "⏎");
          const b = text.slice(0, 240).replace(/\n/g, "⏎");
          bodyDiffPreview = `orig: ${a}\nrepl: ${b}`;
        }
      }
      out.push({
        idx, method: e.request.method, url: target,
        originalStatus: e.response.status,
        replayStatus: resp.status,
        match: resp.status === e.response.status,
        durationMs: dur,
        bodyDiffPreview,
      });
    } catch (err: any) {
      out.push({
        idx, method: e.request.method, url: target,
        originalStatus: e.response.status,
        replayStatus: null,
        match: false,
        durationMs: Date.now() - t0,
        error: err?.name === "AbortError" ? `timeout after ${perRequestTimeoutMs}ms` : err?.message || String(err),
      });
    } finally {
      clearTimeout(tHandle);
    }
  }
  return out;
}

function jsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export interface HarToPlaywrightOptions {
  includeXhrFetchOnly?: boolean;
  includeNavigation?: boolean;
  maxRequests?: number;
  testTitle?: string;
}

/**
 * Generates a self-contained Playwright spec that mimics the captured flow
 * using the `request` fixture (no real browser needed) for XHR/fetch entries,
 * plus a `page.goto()` for the first navigation document.
 */
export function harToPlaywrightSpec(har: Har, opts: HarToPlaywrightOptions = {}): string {
  const { includeXhrFetchOnly = true, includeNavigation = true, maxRequests = 50, testTitle = "HAR replay" } = opts;
  const entries = har.log.entries;
  const lines: string[] = [];
  lines.push(`import { test, expect } from "@playwright/test";`);
  lines.push("");
  lines.push(`// Auto-generated from HAR by LUXI IDE.`);
  lines.push(`// Captures: ${entries.length} entries (${Array.from(new Set(entries.map(e => hostOf(e.request.url)))).join(", ")})`);
  lines.push("");
  lines.push(`test(${JSON.stringify(testTitle)}, async ({ page, request }) => {`);

  // First nav (text/html document) → goto
  let didNav = false;
  if (includeNavigation) {
    for (const e of entries) {
      const ct = e.response.content?.mimeType || "";
      if (e.request.method === "GET" && (ct.startsWith("text/html") || e._resourceType === "document")) {
        lines.push(`  await page.goto(${JSON.stringify(e.request.url)});`);
        didNav = true;
        break;
      }
    }
  }

  // Build extra-headers map from the most common request headers (auth, csrf, ua)
  const headerCount = new Map<string, Map<string, number>>();
  for (const e of entries) {
    for (const h of (e.request.headers || [])) {
      const k = h.name.toLowerCase();
      if (k.startsWith(":") || FORBIDDEN_REPLAY_HEADERS.has(k)) continue;
      if (!["authorization", "x-csrf-token", "x-xsrf-token", "x-requested-with", "user-agent", "accept-language"].includes(k)) continue;
      if (!headerCount.has(h.name)) headerCount.set(h.name, new Map());
      const inner = headerCount.get(h.name)!;
      inner.set(h.value, (inner.get(h.value) || 0) + 1);
    }
  }
  if (headerCount.size) {
    const dominant: Record<string, string> = {};
    for (const [k, vs] of headerCount.entries()) {
      let best = "", bestN = 0;
      for (const [v, n] of vs.entries()) if (n > bestN) { best = v; bestN = n; }
      if (best) dominant[k] = best;
    }
    lines.push(`  const extraHeaders = ${JSON.stringify(dominant, null, 2).split("\n").join("\n  ")};`);
  } else {
    lines.push(`  const extraHeaders: Record<string, string> = {};`);
  }
  lines.push("");

  let emitted = 0;
  for (let i = 0; i < entries.length && emitted < maxRequests; i++) {
    const e = entries[i];
    const rt = e._resourceType || "";
    if (includeXhrFetchOnly && !["xhr", "fetch"].includes(rt)) continue;
    if (didNav && i === 0) continue;
    const m = e.request.method.toLowerCase();
    const fn = ["get", "post", "put", "patch", "delete", "head"].includes(m) ? m : "fetch";
    const opts: string[] = [`headers: extraHeaders`];
    if (e.request.postData?.text && !["get", "head"].includes(m)) {
      opts.push(`data: \`${jsEscape(e.request.postData.text.slice(0, 4000))}\``);
    }
    const callExpr = fn === "fetch"
      ? `request.fetch(${JSON.stringify(e.request.url)}, { method: ${JSON.stringify(e.request.method)}, ${opts.join(", ")} })`
      : `request.${fn}(${JSON.stringify(e.request.url)}, { ${opts.join(", ")} })`;
    lines.push(`  // [${i}] ${e.request.method} ${pathOf(e.request.url)} → expected ${e.response.status}`);
    lines.push(`  {`);
    lines.push(`    const r = await ${callExpr};`);
    lines.push(`    expect(r.status()).toBe(${e.response.status});`);
    lines.push(`  }`);
    emitted++;
  }
  if (emitted === 0 && !didNav) {
    lines.push(`  // (No XHR/fetch or navigation entries detected in this HAR)`);
    lines.push(`  expect(true).toBe(true);`);
  }
  lines.push(`});`);
  return lines.join("\n") + "\n";
}

export async function writePlaywrightSpec(projectDir: string, contents: string, name?: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = (name || "har-replay").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 60);
  const fileName = `${safe}-${ts}.spec.ts`;
  const targetDir = pathLib.join(pathLib.resolve(projectDir), "tests");
  await fs.mkdir(targetDir, { recursive: true });
  const target = pathLib.join(targetDir, fileName);
  await fs.writeFile(target, contents, "utf8");
  return target;
}
