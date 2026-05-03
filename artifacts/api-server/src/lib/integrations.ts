import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as crypto from "crypto";
import { logger } from "./logger";

// AES-256-GCM at-rest encryption for integration credentials.
// Key is derived from SESSION_SECRET (already in env). Format stored in DB:
//   v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>
// Rotating SESSION_SECRET will invalidate stored creds — that's intentional.

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short (need >= 16 chars) — refusing to encrypt integration credentials");
  }
  // scrypt is deterministic for a given (secret, salt) — salt is fixed because
  // we don't want a per-row salt to wrestle with; the IV provides per-row entropy.
  return crypto.scryptSync(secret, "luxi-integrations-v1", 32);
}

export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptCredential(blob: string): string {
  const [v, ivHex, tagHex, ctHex] = blob.split(":");
  if (v !== "v1") throw new Error("unsupported credential version");
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return pt.toString("utf8");
}

export type IntegrationKind = "api_key" | "bearer_token" | "basic_auth" | "oauth_token" | "json";

export interface Integration {
  id: number;
  projectId: number;
  slug: string;
  name: string;
  kind: IntegrationKind;
  baseUrl: string | null;
  authHeader: string;          // e.g. "Authorization", "X-API-Key"
  authPrefix: string;          // e.g. "Bearer ", "" — prepended to credential value
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

const VALID_KIND: IntegrationKind[] = ["api_key", "bearer_token", "basic_auth", "oauth_token", "json"];
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

let schemaReady: Promise<void> | null = null;
export function ensureIntegrationsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS integrations (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_url TEXT,
        auth_header TEXT NOT NULL DEFAULT 'Authorization',
        auth_prefix TEXT NOT NULL DEFAULT 'Bearer ',
        credential_cipher TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS integrations_proj_slug_idx ON integrations (project_id, slug)`));
    logger.info("integrations schema ensured");
  })().catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

function rowToIntegration(r: any): Integration {
  return {
    id: r.id,
    projectId: r.project_id,
    slug: r.slug,
    name: r.name,
    kind: r.kind as IntegrationKind,
    baseUrl: r.base_url,
    authHeader: r.auth_header,
    authPrefix: r.auth_prefix,
    metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata ?? {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createIntegration(opts: {
  projectId: number; slug: string; name: string; kind: IntegrationKind;
  credential: string; baseUrl?: string; authHeader?: string; authPrefix?: string;
  metadata?: Record<string, any>;
}): Promise<Integration> {
  await ensureIntegrationsSchema();
  if (!SLUG_RE.test(opts.slug)) throw new Error("slug must match /^[a-z0-9][a-z0-9_-]{0,62}$/");
  if (!VALID_KIND.includes(opts.kind)) throw new Error(`kind must be one of: ${VALID_KIND.join(", ")}`);
  if (!opts.credential || opts.credential.length === 0) throw new Error("credential required");
  const cipher = encryptCredential(opts.credential);
  const r = await db.execute<any>(sql`
    INSERT INTO integrations (project_id, slug, name, kind, base_url, auth_header, auth_prefix, credential_cipher, metadata)
    VALUES (${opts.projectId}, ${opts.slug}, ${opts.name}, ${opts.kind},
            ${opts.baseUrl ?? null}, ${opts.authHeader ?? "Authorization"},
            ${opts.authPrefix ?? "Bearer "}, ${cipher},
            ${JSON.stringify(opts.metadata ?? {})}::jsonb)
    RETURNING *
  `);
  const rows = (r as any).rows ?? r;
  return rowToIntegration(rows[0]);
}

export async function listIntegrations(projectId: number): Promise<Integration[]> {
  await ensureIntegrationsSchema();
  const r = await db.execute<any>(sql`SELECT * FROM integrations WHERE project_id = ${projectId} ORDER BY slug ASC`);
  const rows = (r as any).rows ?? r;
  return rows.map(rowToIntegration);
}

export async function getIntegrationBySlug(projectId: number, slug: string): Promise<Integration | null> {
  await ensureIntegrationsSchema();
  const r = await db.execute<any>(sql`SELECT * FROM integrations WHERE project_id = ${projectId} AND slug = ${slug}`);
  const rows = (r as any).rows ?? r;
  return rows[0] ? rowToIntegration(rows[0]) : null;
}

export async function getDecryptedCredential(projectId: number, slug: string): Promise<string | null> {
  await ensureIntegrationsSchema();
  const r = await db.execute<any>(sql`SELECT credential_cipher FROM integrations WHERE project_id = ${projectId} AND slug = ${slug}`);
  const rows = (r as any).rows ?? r;
  if (!rows[0]) return null;
  return decryptCredential(rows[0].credential_cipher);
}

export async function deleteIntegration(projectId: number, slug: string): Promise<boolean> {
  await ensureIntegrationsSchema();
  const r = await db.execute<any>(sql`DELETE FROM integrations WHERE project_id = ${projectId} AND slug = ${slug} RETURNING id`);
  const rows = (r as any).rows ?? r;
  return rows.length > 0;
}

export async function updateIntegrationCredential(projectId: number, slug: string, newCredential: string): Promise<boolean> {
  await ensureIntegrationsSchema();
  if (!newCredential) throw new Error("credential required");
  const cipher = encryptCredential(newCredential);
  const r = await db.execute<any>(sql`UPDATE integrations SET credential_cipher = ${cipher}, updated_at = NOW() WHERE project_id = ${projectId} AND slug = ${slug} RETURNING id`);
  const rows = (r as any).rows ?? r;
  return rows.length > 0;
}

// Build the auth header for an integration without ever returning the raw credential.
// Used by integration_fetch on the server side only.
export function buildAuthHeaders(integration: Integration, credential: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (integration.kind === "basic_auth") {
    headers[integration.authHeader || "Authorization"] = `Basic ${Buffer.from(credential).toString("base64")}`;
  } else if (integration.kind === "json") {
    // metadata.headerTemplate may carry custom logic; default just JSON-stringify into the header
    headers[integration.authHeader || "Authorization"] = `${integration.authPrefix ?? ""}${credential}`;
  } else {
    headers[integration.authHeader || "Authorization"] = `${integration.authPrefix ?? ""}${credential}`;
  }
  return headers;
}
