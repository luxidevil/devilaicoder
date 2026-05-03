import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  createIntegration, listIntegrations, getIntegrationBySlug,
  deleteIntegration, updateIntegrationCredential, ensureIntegrationsSchema,
  type IntegrationKind,
} from "../../lib/integrations";

const router: IRouter = Router();

async function projectExists(projectId: number): Promise<boolean> {
  const rows = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  return rows.length > 0;
}

async function requireProject(req: any, res: any): Promise<number | null> {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) { res.status(400).json({ error: "invalid projectId" }); return null; }
  if (!(await projectExists(projectId))) { res.status(404).json({ error: "project not found" }); return null; }
  return projectId;
}

function toPublic(i: any) {
  // Strip credential_cipher; surface metadata + slug + kind only.
  return {
    id: i.id, slug: i.slug, name: i.name, kind: i.kind,
    baseUrl: i.baseUrl, authHeader: i.authHeader, authPrefix: i.authPrefix,
    metadata: i.metadata, createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
}

router.get("/projects/:projectId/integrations", async (req, res): Promise<void> => {
  const projectId = await requireProject(req, res);
  if (!projectId) return;
  try {
    await ensureIntegrationsSchema();
    const items = await listIntegrations(projectId);
    res.json({ integrations: items.map(toPublic) });
  } catch (err: any) { logger.error({ err }, "list integrations"); res.status(500).json({ error: err.message }); }
});

router.post("/projects/:projectId/integrations", async (req, res): Promise<void> => {
  const projectId = await requireProject(req, res);
  if (!projectId) return;
  const { slug, name, kind, credential, baseUrl, authHeader, authPrefix, metadata } = req.body ?? {};
  if (!slug || !name || !kind || !credential) {
    res.status(400).json({ error: "slug, name, kind, credential are required" });
    return;
  }
  // SSRF guard: a stored baseUrl is later concatenated by integration_fetch and
  // submitted to assertPublicUrl. We reject obviously-internal URLs at write time
  // too so a confused admin can't smuggle 169.254.169.254 / 127.0.0.1 / ::1 here.
  if (baseUrl) {
    const lower = String(baseUrl).toLowerCase();
    if (!/^https?:\/\//.test(lower)) { res.status(400).json({ error: "baseUrl must start with http(s)://" }); return; }
    if (/(?:^|\/\/)(localhost|127\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fc|\[?fd)/i.test(lower)) {
      res.status(400).json({ error: "baseUrl points to a private/loopback/metadata range — refused" });
      return;
    }
  }
  try {
    const i = await createIntegration({
      projectId, slug, name, kind: kind as IntegrationKind, credential,
      baseUrl, authHeader, authPrefix, metadata,
    });
    res.status(201).json({ integration: toPublic(i) });
  } catch (err: any) {
    if (String(err.message).includes("duplicate")) { res.status(409).json({ error: "slug already exists for this project" }); return; }
    res.status(400).json({ error: err.message });
  }
});

router.patch("/projects/:projectId/integrations/:slug", async (req, res): Promise<void> => {
  const projectId = await requireProject(req, res);
  if (!projectId) return;
  const slug = String(req.params.slug);
  const { credential } = req.body ?? {};
  if (!credential) { res.status(400).json({ error: "credential required (this endpoint rotates the credential only)" }); return; }
  try {
    const ok = await updateIntegrationCredential(projectId, slug, credential);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
    const i = await getIntegrationBySlug(projectId, slug);
    res.json({ integration: i ? toPublic(i) : null });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/projects/:projectId/integrations/:slug", async (req, res): Promise<void> => {
  const projectId = await requireProject(req, res);
  if (!projectId) return;
  const slug = String(req.params.slug);
  try {
    const ok = await deleteIntegration(projectId, slug);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
