import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, projectSecretsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/projects/:projectId/secrets", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }
  const rows = await db
    .select({
      id: projectSecretsTable.id,
      key: projectSecretsTable.key,
      description: projectSecretsTable.description,
      createdAt: projectSecretsTable.createdAt,
      updatedAt: projectSecretsTable.updatedAt,
      preview: projectSecretsTable.value,
    })
    .from(projectSecretsTable)
    .where(eq(projectSecretsTable.projectId, projectId));

  // Mask values
  const masked = rows.map((r) => ({
    ...r,
    preview: r.preview ? `${r.preview.slice(0, 4)}${"•".repeat(Math.min(8, Math.max(0, r.preview.length - 4)))}` : "",
  }));
  res.json(masked);
});

router.put("/projects/:projectId/secrets/:key", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const key = String(req.params.key);
  if (!projectId || !key || !/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    res.status(400).json({ error: "Invalid key. Must match /^[A-Z_][A-Z0-9_]*$/i" });
    return;
  }
  const body = (req.body ?? {}) as { value?: string; description?: string };
  if (typeof body.value !== "string") {
    res.status(400).json({ error: "value is required" });
    return;
  }

  const existing = await db
    .select()
    .from(projectSecretsTable)
    .where(and(eq(projectSecretsTable.projectId, projectId), eq(projectSecretsTable.key, key)));

  if (existing.length > 0) {
    const [updated] = await db
      .update(projectSecretsTable)
      .set({ value: body.value, description: body.description ?? existing[0].description, updatedAt: new Date() })
      .where(eq(projectSecretsTable.id, existing[0].id))
      .returning({
        id: projectSecretsTable.id,
        key: projectSecretsTable.key,
        description: projectSecretsTable.description,
        createdAt: projectSecretsTable.createdAt,
        updatedAt: projectSecretsTable.updatedAt,
      });
    res.json(updated);
  } else {
    const [created] = await db
      .insert(projectSecretsTable)
      .values({ projectId, key, value: body.value, description: body.description ?? null })
      .returning({
        id: projectSecretsTable.id,
        key: projectSecretsTable.key,
        description: projectSecretsTable.description,
        createdAt: projectSecretsTable.createdAt,
        updatedAt: projectSecretsTable.updatedAt,
      });
    res.status(201).json(created);
  }
});

router.delete("/projects/:projectId/secrets/:key", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const key = String(req.params.key);
  if (!projectId || !key) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  await db
    .delete(projectSecretsTable)
    .where(and(eq(projectSecretsTable.projectId, projectId), eq(projectSecretsTable.key, key)));
  res.status(204).end();
});

export async function getProjectSecretsAsEnv(projectId: number): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: projectSecretsTable.key, value: projectSecretsTable.value })
    .from(projectSecretsTable)
    .where(eq(projectSecretsTable.projectId, projectId));
  const env: Record<string, string> = {};
  for (const r of rows) env[r.key] = r.value;
  return env;
}

export default router;
