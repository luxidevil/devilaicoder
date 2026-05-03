import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { promises as fsPromises } from "node:fs";
import * as pathLib from "node:path";
import { createHash } from "node:crypto";
import { getActiveProvider, getProviderSettingsByName } from "./ai-providers";
import { logger } from "./logger";

export const EMBED_DIM = 768;
export const EMBED_MODEL = "text-embedding-004";
const CHUNK_LINES = 200;
const CHUNK_OVERLAP = 30;
const MAX_CHARS_PER_CHUNK = 8000;
const BATCH_SIZE = 32;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".cache",
  ".turbo", ".pnpm-store", "venv", "__pycache__", ".venv", "target",
  "coverage", ".replit-artifact", ".local", ".vite",
]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar", ".bz2", ".xz",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".avi",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".so", ".dylib", ".dll", ".exe", ".o", ".a",
  ".pack", ".idx", ".lock", ".log",
]);
const SKIP_BASENAMES = new Set([
  "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "Cargo.lock",
  "uv.lock", "poetry.lock", "go.sum",
]);
const MAX_FILE_BYTES = 256 * 1024;

let schemaReadyPromise: Promise<void> | null = null;

export async function ensureEmbeddingSchema(): Promise<void> {
  if (schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise = (async () => {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS file_embeddings (
        id serial PRIMARY KEY,
        project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_path text NOT NULL,
        chunk_idx integer NOT NULL DEFAULT 0,
        start_line integer NOT NULL DEFAULT 1,
        end_line integer NOT NULL DEFAULT 1,
        content_sha text NOT NULL,
        content_preview text NOT NULL DEFAULT '',
        embedding vector(${EMBED_DIM}) NOT NULL,
        model text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS file_embeddings_project_path_idx ON file_embeddings (project_id, file_path)`));
    // HNSW for approximate cosine. Falls back gracefully on older pgvector by trying ivfflat.
    try {
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS file_embeddings_vec_idx ON file_embeddings USING hnsw (embedding vector_cosine_ops)`));
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "hnsw index unavailable, trying ivfflat");
      try {
        await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS file_embeddings_vec_idx ON file_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`));
      } catch (e2) {
        logger.warn({ err: (e2 as Error).message }, "no ann index, exact scan only");
      }
    }
  })().catch((err) => {
    schemaReadyPromise = null;
    throw err;
  });
  return schemaReadyPromise;
}

interface EmbedSettings {
  apiKey: string;
  baseURL?: string;
}

async function getEmbedSettings(): Promise<EmbedSettings> {
  const gem = await getProviderSettingsByName("gemini").catch(() => null);
  if (gem?.apiKey) return { apiKey: gem.apiKey, baseURL: gem.baseURL };
  const active = await getActiveProvider();
  if (active && active.provider === "gemini" && active.apiKey) {
    return { apiKey: active.apiKey, baseURL: active.baseURL };
  }
  if (process.env.GEMINI_API_KEY) return { apiKey: process.env.GEMINI_API_KEY };
  throw new Error("No Gemini API key configured for embeddings (settings → providers → gemini).");
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { apiKey, baseURL } = await getEmbedSettings();
  const base = baseURL || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${base}/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const body = {
      requests: slice.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t.slice(0, MAX_CHARS_PER_CHUNK) }] },
      })),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`embedding batch failed: HTTP ${resp.status} ${errText.slice(0, 240)}`);
      }
      const json: any = await resp.json();
      const embeds: any[] = json?.embeddings ?? [];
      if (embeds.length !== slice.length) throw new Error(`expected ${slice.length} embeddings, got ${embeds.length}`);
      for (const e of embeds) out.push(e.values || e.embedding?.values || []);
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

interface FileChunk {
  filePath: string;
  chunkIdx: number;
  startLine: number;
  endLine: number;
  text: string;
  sha: string;
}

async function* walkProjectFiles(rootDir: string): AsyncGenerator<string> {
  const stack: string[] = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try { entries = await fsPromises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== ".env.example" && ent.name !== ".gitignore") continue;
      const full = pathLib.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        if (SKIP_EXT.has(pathLib.extname(ent.name).toLowerCase())) continue;
        if (SKIP_BASENAMES.has(ent.name)) continue;
        yield full;
      }
    }
  }
}

function chunkFileContent(filePath: string, content: string): FileChunk[] {
  const lines = content.split("\n");
  if (lines.length <= CHUNK_LINES) {
    const text = content.slice(0, MAX_CHARS_PER_CHUNK);
    return [{
      filePath,
      chunkIdx: 0,
      startLine: 1,
      endLine: lines.length,
      text,
      sha: createHash("sha256").update(text).digest("hex").slice(0, 16),
    }];
  }
  const chunks: FileChunk[] = [];
  let idx = 0;
  for (let i = 0; i < lines.length; i += CHUNK_LINES - CHUNK_OVERLAP) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    const text = slice.join("\n").slice(0, MAX_CHARS_PER_CHUNK);
    chunks.push({
      filePath,
      chunkIdx: idx++,
      startLine: i + 1,
      endLine: Math.min(i + CHUNK_LINES, lines.length),
      text,
      sha: createHash("sha256").update(text).digest("hex").slice(0, 16),
    });
    if (i + CHUNK_LINES >= lines.length) break;
  }
  return chunks;
}

function isLikelyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(8192, buf.length));
  let nul = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nul++;
  return nul / Math.max(1, sample.length) < 0.005;
}

function vecLiteral(v: number[]): string {
  return "[" + v.map((x) => Number.isFinite(x) ? x.toFixed(6) : "0").join(",") + "]";
}

export interface IndexResult {
  scannedFiles: number;
  indexedChunks: number;
  skippedFiles: number;
  unchanged: number;
  errors: string[];
  durationMs: number;
}

export async function indexProject(
  projectId: number,
  projectDir: string,
  opts: { full?: boolean; pathPrefix?: string } = {}
): Promise<IndexResult> {
  await ensureEmbeddingSchema();
  const t0 = Date.now();
  const result: IndexResult = { scannedFiles: 0, indexedChunks: 0, skippedFiles: 0, unchanged: 0, errors: [], durationMs: 0 };

  const existingRows = await db.execute<{ file_path: string; chunk_idx: number; content_sha: string }>(
    sql.raw(`SELECT file_path, chunk_idx, content_sha FROM file_embeddings WHERE project_id = ${projectId}`)
  );
  const existing = new Map<string, string>();
  for (const r of existingRows.rows as any[]) existing.set(`${r.file_path}::${r.chunk_idx}`, r.content_sha);

  const seenPathChunks = new Set<string>();
  const toEmbed: FileChunk[] = [];

  for await (const fullPath of walkProjectFiles(projectDir)) {
    const rel = pathLib.relative(projectDir, fullPath);
    if (opts.pathPrefix && !rel.startsWith(opts.pathPrefix)) continue;
    result.scannedFiles++;
    try {
      const stat = await fsPromises.stat(fullPath);
      if (stat.size === 0 || stat.size > MAX_FILE_BYTES) { result.skippedFiles++; continue; }
      const buf = await fsPromises.readFile(fullPath);
      if (!isLikelyText(buf)) { result.skippedFiles++; continue; }
      const content = buf.toString("utf8");
      const chunks = chunkFileContent(rel, content);
      for (const c of chunks) {
        const key = `${c.filePath}::${c.chunkIdx}`;
        seenPathChunks.add(key);
        if (!opts.full && existing.get(key) === c.sha) { result.unchanged++; continue; }
        toEmbed.push(c);
      }
    } catch (e: any) {
      result.errors.push(`${rel}: ${e.message}`);
      result.skippedFiles++;
    }
  }

  // Embed in batches and upsert
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    let vecs: number[][];
    try { vecs = await embedTexts(batch.map((b) => b.text)); }
    catch (e: any) { result.errors.push(`embed batch ${i}: ${e.message}`); continue; }
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const v = vecs[j];
      if (!v || v.length !== EMBED_DIM) { result.errors.push(`${c.filePath}#${c.chunkIdx}: bad vec dim ${v?.length}`); continue; }
      const preview = c.text.slice(0, 600).replace(/\u0000/g, "");
      try {
        await db.execute(sql`
          INSERT INTO file_embeddings (project_id, file_path, chunk_idx, start_line, end_line, content_sha, content_preview, embedding, model, updated_at)
          VALUES (${projectId}, ${c.filePath}, ${c.chunkIdx}, ${c.startLine}, ${c.endLine}, ${c.sha}, ${preview}, ${vecLiteral(v)}::vector, ${EMBED_MODEL}, now())
          ON CONFLICT DO NOTHING
        `);
        // Replace any stale row for this (project, file, chunk)
        await db.execute(sql`
          DELETE FROM file_embeddings
          WHERE project_id = ${projectId} AND file_path = ${c.filePath} AND chunk_idx = ${c.chunkIdx}
            AND content_sha <> ${c.sha}
        `);
        result.indexedChunks++;
      } catch (e: any) {
        result.errors.push(`${c.filePath}#${c.chunkIdx} insert: ${e.message}`);
      }
    }
  }

  // Garbage-collect chunks for files that no longer exist (or whose chunk count shrank)
  if (opts.full || !opts.pathPrefix) {
    const allRows = await db.execute<{ file_path: string; chunk_idx: number }>(
      sql.raw(`SELECT file_path, chunk_idx FROM file_embeddings WHERE project_id = ${projectId}`)
    );
    for (const r of allRows.rows as any[]) {
      const key = `${r.file_path}::${r.chunk_idx}`;
      if (!seenPathChunks.has(key)) {
        await db.execute(sql`DELETE FROM file_embeddings WHERE project_id = ${projectId} AND file_path = ${r.file_path} AND chunk_idx = ${r.chunk_idx}`);
      }
    }
  }

  result.durationMs = Date.now() - t0;
  return result;
}

/**
 * Re-index a single file (and prune any stale chunks for it). Used by the
 * post-write debounced reindexer so the index stays warm as the agent edits.
 */
export async function indexProjectFile(
  projectId: number,
  projectDir: string,
  relPath: string
): Promise<{ chunks: number; skipped: boolean; reason?: string }> {
  await ensureEmbeddingSchema();
  const safeRel = relPath.replace(/^\/+/, "");
  if (safeRel.includes("..")) return { chunks: 0, skipped: true, reason: "path escapes project" };
  if (SKIP_BASENAMES.has(pathLib.basename(safeRel))) return { chunks: 0, skipped: true, reason: "skipped basename" };
  if (SKIP_EXT.has(pathLib.extname(safeRel).toLowerCase())) return { chunks: 0, skipped: true, reason: "skipped ext" };
  for (const part of safeRel.split("/")) if (SKIP_DIRS.has(part)) return { chunks: 0, skipped: true, reason: "skipped dir" };

  const fullPath = pathLib.join(projectDir, safeRel);
  let buf: Buffer;
  try {
    const stat = await fsPromises.stat(fullPath);
    if (!stat.isFile()) {
      // File deleted or not regular: drop all its chunks.
      await db.execute(sql`DELETE FROM file_embeddings WHERE project_id = ${projectId} AND file_path = ${safeRel}`);
      return { chunks: 0, skipped: true, reason: "not a regular file" };
    }
    if (stat.size === 0 || stat.size > MAX_FILE_BYTES) {
      await db.execute(sql`DELETE FROM file_embeddings WHERE project_id = ${projectId} AND file_path = ${safeRel}`);
      return { chunks: 0, skipped: true, reason: "empty or too large" };
    }
    buf = await fsPromises.readFile(fullPath);
  } catch {
    // File gone — drop chunks.
    await db.execute(sql`DELETE FROM file_embeddings WHERE project_id = ${projectId} AND file_path = ${safeRel}`);
    return { chunks: 0, skipped: true, reason: "read failed (likely deleted)" };
  }
  if (!isLikelyText(buf)) return { chunks: 0, skipped: true, reason: "binary content" };

  const content = buf.toString("utf8");
  const chunks = chunkFileContent(safeRel, content);
  const existingRows = await db.execute<{ chunk_idx: number; content_sha: string }>(
    sql`SELECT chunk_idx, content_sha FROM file_embeddings WHERE project_id = ${projectId} AND file_path = ${safeRel}`
  );
  const existing = new Map<number, string>();
  for (const r of existingRows.rows as any[]) existing.set(Number(r.chunk_idx), r.content_sha);

  const toEmbed: FileChunk[] = chunks.filter((c) => existing.get(c.chunkIdx) !== c.sha);
  if (toEmbed.length) {
    let vecs: number[][];
    try { vecs = await embedTexts(toEmbed.map((c) => c.text)); }
    catch (e: any) { logger.warn({ err: e.message, file: safeRel }, "single-file embed failed"); return { chunks: 0, skipped: true, reason: e.message }; }
    for (let i = 0; i < toEmbed.length; i++) {
      const c = toEmbed[i];
      const v = vecs[i];
      if (!v || v.length !== EMBED_DIM) continue;
      const preview = c.text.slice(0, 600).replace(/\u0000/g, "");
      await db.execute(sql`
        DELETE FROM file_embeddings
        WHERE project_id = ${projectId} AND file_path = ${safeRel} AND chunk_idx = ${c.chunkIdx}
      `);
      await db.execute(sql`
        INSERT INTO file_embeddings (project_id, file_path, chunk_idx, start_line, end_line, content_sha, content_preview, embedding, model, updated_at)
        VALUES (${projectId}, ${safeRel}, ${c.chunkIdx}, ${c.startLine}, ${c.endLine}, ${c.sha}, ${preview}, ${vecLiteral(v)}::vector, ${EMBED_MODEL}, now())
      `);
    }
  }

  // Drop chunk slots that no longer exist (file shrank).
  const validIdxs = new Set(chunks.map((c) => c.chunkIdx));
  for (const idx of existing.keys()) {
    if (!validIdxs.has(idx)) {
      await db.execute(sql`
        DELETE FROM file_embeddings WHERE project_id = ${projectId} AND file_path = ${safeRel} AND chunk_idx = ${idx}
      `);
    }
  }
  return { chunks: chunks.length, skipped: false };
}

// Per-project debouncer — coalesces post-write reindex bursts.
const reindexQueues = new Map<number, { paths: Set<string>; timer: NodeJS.Timeout; projectDir: string }>();
const REINDEX_DEBOUNCE_MS = 4000;

export function scheduleFileReindex(projectId: number, projectDir: string, relPath: string): void {
  if (!relPath) return;
  let q = reindexQueues.get(projectId);
  if (!q) {
    q = { paths: new Set(), timer: setTimeout(() => {}, 0), projectDir };
    clearTimeout(q.timer);
    reindexQueues.set(projectId, q);
  }
  q.paths.add(relPath.replace(/^\/+/, ""));
  q.projectDir = projectDir;
  clearTimeout(q.timer);
  q.timer = setTimeout(async () => {
    const queued = reindexQueues.get(projectId);
    if (!queued) return;
    const paths = Array.from(queued.paths);
    queued.paths.clear();
    for (const p of paths) {
      try { await indexProjectFile(projectId, queued.projectDir, p); }
      catch (err: any) { logger.warn({ err: err.message, file: p, projectId }, "debounced reindex failed"); }
    }
  }, REINDEX_DEBOUNCE_MS);
  // Don't keep the event loop alive just for this.
  if (typeof q.timer.unref === "function") q.timer.unref();
}

export interface SearchHit {
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
  preview: string;
}

export async function searchProject(projectId: number, query: string, k: number = 10): Promise<SearchHit[]> {
  await ensureEmbeddingSchema();
  const [vec] = await embedTexts([query]);
  if (!vec || vec.length !== EMBED_DIM) throw new Error("query embedding failed");
  const lit = vecLiteral(vec);
  const rows = await db.execute<{ file_path: string; start_line: number; end_line: number; preview: string; sim: number }>(
    sql.raw(`
      SELECT file_path,
             start_line,
             end_line,
             content_preview AS preview,
             1 - (embedding <=> '${lit}'::vector) AS sim
      FROM file_embeddings
      WHERE project_id = ${projectId}
      ORDER BY embedding <=> '${lit}'::vector
      LIMIT ${Math.max(1, Math.min(50, k))}
    `)
  );
  return (rows.rows as any[]).map((r) => ({
    filePath: r.file_path,
    startLine: Number(r.start_line),
    endLine: Number(r.end_line),
    similarity: Number(r.sim),
    preview: String(r.preview || ""),
  }));
}

export async function projectEmbeddingStats(projectId: number): Promise<{ chunks: number; files: number; lastUpdated: string | null }> {
  await ensureEmbeddingSchema();
  const r = await db.execute<{ chunks: number; files: number; last_updated: string | null }>(
    sql.raw(`
      SELECT COUNT(*)::int AS chunks,
             COUNT(DISTINCT file_path)::int AS files,
             MAX(updated_at)::text AS last_updated
      FROM file_embeddings WHERE project_id = ${projectId}
    `)
  );
  const row = (r.rows as any[])[0] || {};
  return { chunks: Number(row.chunks || 0), files: Number(row.files || 0), lastUpdated: row.last_updated };
}
