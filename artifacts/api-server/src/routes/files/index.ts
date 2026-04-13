import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, filesTable } from "@workspace/db";
import {
  CreateFileBody,
  UpdateFileBody,
  ListFilesParams,
  CreateFileParams,
  GetFileParams,
  UpdateFileParams,
  DeleteFileParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects/:projectId/files", async (req, res): Promise<void> => {
  const params = ListFilesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const files = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.projectId, params.data.projectId))
    .orderBy(desc(filesTable.createdAt));

  res.json(files);
});

router.post("/projects/:projectId/files", async (req, res): Promise<void> => {
  const params = CreateFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [file] = await db
    .insert(filesTable)
    .values({ ...parsed.data, projectId: params.data.projectId })
    .returning();

  res.status(201).json(file);
});

router.get("/projects/:projectId/files/:fileId", async (req, res): Promise<void> => {
  const params = GetFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [file] = await db
    .select()
    .from(filesTable)
    .where(
      and(
        eq(filesTable.id, params.data.fileId),
        eq(filesTable.projectId, params.data.projectId)
      )
    );

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.json(file);
});

router.put("/projects/:projectId/files/:fileId", async (req, res): Promise<void> => {
  const params = UpdateFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [file] = await db
    .update(filesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(filesTable.id, params.data.fileId),
        eq(filesTable.projectId, params.data.projectId)
      )
    )
    .returning();

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.json(file);
});

router.delete("/projects/:projectId/files/:fileId", async (req, res): Promise<void> => {
  const params = DeleteFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [file] = await db
    .delete(filesTable)
    .where(
      and(
        eq(filesTable.id, params.data.fileId),
        eq(filesTable.projectId, params.data.projectId)
      )
    )
    .returning();

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
