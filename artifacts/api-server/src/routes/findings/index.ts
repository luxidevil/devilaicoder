import { Router, type IRouter } from "express";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { db, findingsTable, projectsTable } from "@workspace/db";

const router: IRouter = Router();

const MAX_TITLE = 200;
const MAX_BODY = 64_000;
const MAX_TAGS = 500;
const ALLOWED_KINDS = new Set(["note", "vuln", "ioc", "credential", "endpoint", "binary", "model", "todo"]);

function clampStr(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeKind(k: unknown): string {
  return typeof k === "string" && ALLOWED_KINDS.has(k) ? k : "note";
}

async function projectExists(projectId: number): Promise<boolean> {
  const [p] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  return !!p;
}

router.get("/projects/:projectId/findings", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) { res.status(400).json({ error: "bad projectId" }); return; }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

  const conds = [eq(findingsTable.projectId, projectId)];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, m => "\\" + m)}%`;
    conds.push(or(ilike(findingsTable.title, like), ilike(findingsTable.body, like), ilike(findingsTable.tags, like))!);
  }
  if (kind && ALLOWED_KINDS.has(kind)) conds.push(eq(findingsTable.kind, kind));

  const rows = await db
    .select()
    .from(findingsTable)
    .where(and(...conds))
    .orderBy(desc(findingsTable.updatedAt))
    .limit(limit);
  res.json(rows);
});

router.get("/findings/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [row] = await db.select().from(findingsTable).where(eq(findingsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

const FINDINGS_PER_PROJECT_CAP = 1000;

router.post("/projects/:projectId/findings", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId) || !(await projectExists(projectId))) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const title = clampStr(req.body?.title, MAX_TITLE).trim();
  const body = clampStr(req.body?.body, MAX_BODY);
  const tags = clampStr(req.body?.tags, MAX_TAGS);
  const kind = normalizeKind(req.body?.kind);
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  if (!body) { res.status(400).json({ error: "body required" }); return; }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(findingsTable).where(eq(findingsTable.projectId, projectId));
  if (n >= FINDINGS_PER_PROJECT_CAP) {
    res.status(409).json({ error: `findings cap reached (${FINDINGS_PER_PROJECT_CAP}); delete or consolidate first` });
    return;
  }

  const [row] = await db.insert(findingsTable).values({ projectId, title, body, kind, tags }).returning();
  res.status(201).json(row);
});

router.patch("/findings/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.title !== undefined) updates.title = clampStr(req.body.title, MAX_TITLE).trim();
  if (req.body?.body !== undefined) updates.body = clampStr(req.body.body, MAX_BODY);
  if (req.body?.tags !== undefined) updates.tags = clampStr(req.body.tags, MAX_TAGS);
  if (req.body?.kind !== undefined) updates.kind = normalizeKind(req.body.kind);
  if (typeof updates.title === "string" && !updates.title) { res.status(400).json({ error: "title cannot be empty" }); return; }

  const [row] = await db.update(findingsTable).set(updates).where(eq(findingsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

router.delete("/findings/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(findingsTable).where(eq(findingsTable.id, id));
  res.status(204).end();
});

// Token-budget-friendly count for the toolbar badge.
router.get("/projects/:projectId/findings/count", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId)) { res.status(400).json({ error: "bad projectId" }); return; }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(findingsTable)
    .where(eq(findingsTable.projectId, projectId));
  res.json({ count: row?.n ?? 0 });
});

export default router;
