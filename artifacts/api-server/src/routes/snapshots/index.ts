import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, snapshotsTable, filesTable, projectsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import * as fsPromises from "fs/promises";
import * as pathLib from "path";

const router: IRouter = Router();

const PROJECTS_ROOT = pathLib.join(process.env.HOME || "/home/runner", "projects");

function getProjectDir(projectId: number): string {
  return pathLib.join(PROJECTS_ROOT, String(projectId));
}

router.get("/projects/:projectId/snapshots", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }
  const rows = await db
    .select({
      id: snapshotsTable.id,
      label: snapshotsTable.label,
      reason: snapshotsTable.reason,
      fileCount: snapshotsTable.fileCount,
      totalBytes: snapshotsTable.totalBytes,
      createdAt: snapshotsTable.createdAt,
    })
    .from(snapshotsTable)
    .where(eq(snapshotsTable.projectId, projectId))
    .orderBy(desc(snapshotsTable.createdAt))
    .limit(100);
  res.json(rows);
});

router.post("/projects/:projectId/snapshots", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }
  const body = (req.body ?? {}) as { label?: string; reason?: string };
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
  const snapshotFiles = files.map((f) => ({
    path: f.path,
    name: f.name,
    content: f.content,
    language: f.language,
  }));
  const totalBytes = snapshotFiles.reduce((s, f) => s + (f.content?.length ?? 0), 0);

  const [snap] = await db
    .insert(snapshotsTable)
    .values({
      projectId,
      label: body.label?.slice(0, 100) || `Checkpoint ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
      reason: body.reason?.slice(0, 500) ?? null,
      files: snapshotFiles,
      fileCount: snapshotFiles.length,
      totalBytes,
    })
    .returning({
      id: snapshotsTable.id,
      label: snapshotsTable.label,
      reason: snapshotsTable.reason,
      fileCount: snapshotsTable.fileCount,
      totalBytes: snapshotsTable.totalBytes,
      createdAt: snapshotsTable.createdAt,
    });

  // Auto-prune old snapshots — keep last 50
  const allSnaps = await db
    .select({ id: snapshotsTable.id })
    .from(snapshotsTable)
    .where(eq(snapshotsTable.projectId, projectId))
    .orderBy(desc(snapshotsTable.createdAt));
  if (allSnaps.length > 50) {
    const toDelete = allSnaps.slice(50).map((s) => s.id);
    for (const id of toDelete) {
      await db.delete(snapshotsTable).where(eq(snapshotsTable.id, id));
    }
  }

  res.status(201).json(snap);
});

router.post("/projects/:projectId/snapshots/:id/restore", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const id = Number(req.params.id);
  if (!projectId || !id) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  const [snap] = await db
    .select()
    .from(snapshotsTable)
    .where(and(eq(snapshotsTable.id, id), eq(snapshotsTable.projectId, projectId)));
  if (!snap) {
    res.status(404).json({ error: "Snapshot not found" });
    return;
  }

  // Phase 1: DB restore in a single transaction (auto-snap → wipe → restore)
  try {
    await db.transaction(async (tx) => {
      const currentFiles = await tx.select().from(filesTable).where(eq(filesTable.projectId, projectId));
      const cur = currentFiles.map((f) => ({ path: f.path, name: f.name, content: f.content, language: f.language }));
      await tx.insert(snapshotsTable).values({
        projectId,
        label: `Auto-saved before restore #${id}`,
        reason: `Auto-saved before restoring snapshot "${snap.label}"`,
        files: cur,
        fileCount: cur.length,
        totalBytes: cur.reduce((s, f) => s + (f.content?.length ?? 0), 0),
      });

      await tx.delete(filesTable).where(eq(filesTable.projectId, projectId));

      if (snap.files.length > 0) {
        await tx.insert(filesTable).values(
          snap.files.map((f) => ({
            projectId,
            name: f.name,
            path: f.path,
            content: f.content,
            language: f.language,
          }))
        );
      }
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Snapshot restore DB transaction failed");
    res.status(500).json({ error: "Restore failed (database). Your files were not modified." });
    return;
  }

  // Phase 2: Sync DB → disk. If this fails, return partial-success so the UI can warn.
  const projectDir = getProjectDir(projectId);
  let diskOk = true;
  let diskError: string | null = null;
  try {
    const entries = await fsPromises.readdir(projectDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (["node_modules", ".git", "venv", ".venv", "__pycache__", ".next", "dist", "build", ".cache"].includes(entry.name)) continue;
      const p = pathLib.join(projectDir, entry.name);
      await fsPromises.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    await fsPromises.mkdir(projectDir, { recursive: true });
    for (const f of snap.files) {
      const full = pathLib.join(projectDir, f.path);
      await fsPromises.mkdir(pathLib.dirname(full), { recursive: true });
      await fsPromises.writeFile(full, f.content, "utf-8");
    }
  } catch (err: any) {
    diskOk = false;
    diskError = err.message ?? "disk sync failed";
    logger.error({ err: diskError }, "Disk restore failed (DB restored)");
  }

  if (!diskOk) {
    res.status(207).json({
      success: false,
      restored: snap.files.length,
      diskOk: false,
      warning: `Database restored but disk sync failed: ${diskError}. Your file editor will show the restored state, but commands may see stale files until you reload.`,
    });
    return;
  }

  res.json({ success: true, restored: snap.files.length, diskOk: true });
});

router.delete("/projects/:projectId/snapshots/:id", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const id = Number(req.params.id);
  if (!projectId || !id) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }
  await db
    .delete(snapshotsTable)
    .where(and(eq(snapshotsTable.id, id), eq(snapshotsTable.projectId, projectId)));
  res.status(204).end();
});

export default router;
