import { Router, type IRouter } from "express";
import { logger } from "../../lib/logger";
import { createTask, listTasks, updateTask, deleteTask, taskStats, ensureTasksSchema } from "../../lib/tasks";

const router: IRouter = Router();

function pid(req: any): number | null {
  const id = Number(req.params.projectId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

router.get("/projects/:projectId/tasks", async (req, res): Promise<void> => {
  const projectId = pid(req);
  if (!projectId) { res.status(400).json({ error: "invalid projectId" }); return; }
  try {
    await ensureTasksSchema();
    const status = (req.query.status as string) || undefined;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
    const [tasks, stats] = await Promise.all([listTasks(projectId, { status: status as any, limit }), taskStats(projectId)]);
    res.json({ tasks, stats });
  } catch (err: any) { logger.error({ err }, "list tasks"); res.status(500).json({ error: err.message }); }
});

router.post("/projects/:projectId/tasks", async (req, res): Promise<void> => {
  const projectId = pid(req);
  if (!projectId) { res.status(400).json({ error: "invalid projectId" }); return; }
  const { title, description, status, priority, blockedBy, tags } = req.body ?? {};
  if (!title || typeof title !== "string") { res.status(400).json({ error: "title required" }); return; }
  try {
    const t = await createTask({
      projectId, title, description, status, priority,
      blockedBy: Array.isArray(blockedBy) ? blockedBy.map(Number).filter(Number.isFinite) : [],
      tags,
    });
    res.json({ task: t });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch("/projects/:projectId/tasks/:taskId", async (req, res): Promise<void> => {
  const projectId = pid(req);
  const taskId = Number(req.params.taskId);
  if (!projectId || !Number.isFinite(taskId)) { res.status(400).json({ error: "invalid id" }); return; }
  const { title, description, status, priority, blockedBy, tags } = req.body ?? {};
  try {
    const t = await updateTask({
      projectId, taskId, title, description, status, priority,
      blockedBy: Array.isArray(blockedBy) ? blockedBy.map(Number).filter(Number.isFinite) : undefined,
      tags,
    });
    if (!t) { res.status(404).json({ error: "not found" }); return; }
    res.json({ task: t });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/projects/:projectId/tasks/:taskId", async (req, res): Promise<void> => {
  const projectId = pid(req);
  const taskId = Number(req.params.taskId);
  if (!projectId || !Number.isFinite(taskId)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    const ok = await deleteTask(projectId, taskId);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
