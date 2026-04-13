import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(desc(projectsTable.updatedAt));
  res.json(projects);
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(project);
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(project);
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .update(projectsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(project);
});

router.get("/projects/:id/ssh", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  res.json({
    sshHost: project.sshHost || "",
    sshUser: project.sshUser || "root",
    sshPort: project.sshPort || 22,
    sshPassword: project.sshPassword ? "••••••••" : "",
    sshKey: project.sshKey ? "••••••••" : "",
    sshRemotePath: project.sshRemotePath || "/var/www/app",
    sshDomain: project.sshDomain || "",
    configured: !!(project.sshHost && (project.sshPassword || project.sshKey)),
  });
});

router.put("/projects/:id/ssh", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const { sshHost, sshUser, sshPort, sshPassword, sshKey, sshRemotePath, sshDomain } = req.body;

  const updateData: any = { updatedAt: new Date() };
  if (sshHost !== undefined) updateData.sshHost = sshHost || null;
  if (sshUser !== undefined) updateData.sshUser = sshUser || "root";
  if (sshPort !== undefined) updateData.sshPort = Number(sshPort) || 22;
  if (sshPassword !== undefined && sshPassword !== "••••••••") updateData.sshPassword = sshPassword || null;
  if (sshKey !== undefined && sshKey !== "••••••••") updateData.sshKey = sshKey || null;
  if (sshRemotePath !== undefined) updateData.sshRemotePath = sshRemotePath || "/var/www/app";
  if (sshDomain !== undefined) updateData.sshDomain = sshDomain || null;

  const [project] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  res.json({
    sshHost: project.sshHost || "",
    sshUser: project.sshUser || "root",
    sshPort: project.sshPort || 22,
    sshPassword: project.sshPassword ? "••••••••" : "",
    sshKey: project.sshKey ? "••••••••" : "",
    sshRemotePath: project.sshRemotePath || "/var/www/app",
    sshDomain: project.sshDomain || "",
    configured: !!(project.sshHost && (project.sshPassword || project.sshKey)),
  });
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
