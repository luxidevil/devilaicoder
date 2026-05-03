import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import * as fs from "fs/promises";
import * as pathLib from "path";
import { db, projectsTable, filesTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";
import { getTemplate } from "../../lib/templates";
import { logger } from "../../lib/logger";
import {
  listProcesses,
  tailLogs,
  stopProcess,
  isAlive,
  killProjectProcesses,
  isValidProcessName,
} from "../../lib/process-manager";

const router: IRouter = Router();

const PROJECTS_ROOT = pathLib.join(process.env.HOME || "/home/runner", "projects");

function getLangFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", html: "html", css: "css",
    json: "json", md: "markdown", java: "java", kt: "kotlin", swift: "swift",
    rb: "ruby", php: "php", txt: "text", yml: "yaml", yaml: "yaml",
  };
  return map[ext] ?? "text";
}

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

  const { template: templateId, ...projectData } = parsed.data as any;

  const [project] = await db
    .insert(projectsTable)
    .values(projectData)
    .returning();

  // Scaffold template files if requested
  if (templateId && templateId !== "blank") {
    const tpl = getTemplate(templateId);
    if (tpl && tpl.files.length > 0) {
      const projectDir = pathLib.join(PROJECTS_ROOT, String(project.id));
      try {
        await fs.mkdir(projectDir, { recursive: true });
        for (const f of tpl.files) {
          const safePath = f.path.replace(/^[/\\]+/, "").replace(/\.\.[/\\]/g, "");
          const abs = pathLib.join(projectDir, safePath);
          const resolved = pathLib.resolve(abs);
          if (!resolved.startsWith(pathLib.resolve(projectDir))) continue;
          await fs.mkdir(pathLib.dirname(abs), { recursive: true });
          await fs.writeFile(abs, f.content, "utf-8");
          await db.insert(filesTable).values({
            projectId: project.id,
            name: safePath.split("/").pop() ?? safePath,
            path: safePath,
            content: f.content,
            language: getLangFromPath(safePath),
          });
        }
      } catch (err: any) {
        // Non-fatal: project is created, just no scaffold files
        console.error("Template scaffold failed:", err.message);
      }
    }
  }

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

router.get("/projects/:id/processes", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }
  const procs = listProcesses(id).map(p => ({
    name: p.name,
    pid: p.proc.pid,
    command: p.command,
    alive: isAlive(p),
    exitCode: p.exitCode,
    port: p.port ?? null,
    startedAt: p.startedAt,
    uptimeSec: Math.floor((Date.now() - p.startedAt) / 1000),
    lastLine: p.output.slice(-1)[0] ?? "",
  }));
  res.json(procs);
});

router.get("/projects/:id/processes/:name/logs", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const name = req.params.name;
  const tail = Math.min(Number(req.query.tail) || 200, 500);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }
  if (!isValidProcessName(name)) { res.status(400).json({ error: "Invalid process name" }); return; }
  const lines = tailLogs(id, name, tail);
  if (!lines) { res.status(404).json({ error: "Process not found" }); return; }
  res.json({ name, lines });
});

router.delete("/projects/:id/processes/:name", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const name = req.params.name;
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }
  if (!isValidProcessName(name)) { res.status(400).json({ error: "Invalid process name" }); return; }
  const ok = stopProcess(id, name);
  if (!ok) { res.status(404).json({ error: "Process not found" }); return; }
  res.sendStatus(204);
});

// ─────────────────────────────────────────────────────────────────────
// Wave 10 — Semantic codebase search: index + stats + search endpoints.
// All three resolve the project's on-disk dir from PROJECTS_ROOT.
// ─────────────────────────────────────────────────────────────────────
function projectDirFor(projectId: number): string {
  return pathLib.join(PROJECTS_ROOT, String(projectId));
}

// Background fire-and-forget. Accepts {full?, path_prefix?}, returns 202 immediately
// with the index stats snapshot (so the UI can show "indexing… X chunks so far").
router.post("/projects/:id/index", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const dir = projectDirFor(id);
  try { await fs.access(dir); } catch { res.status(404).json({ error: "Project directory missing" }); return; }
  const { full, path_prefix } = (req.body ?? {}) as { full?: boolean; path_prefix?: string };
  // Run in background so the request doesn't hold open for minutes on first index.
  // Use the global logger (req.log's lifetime is tied to the response object).
  (async () => {
    try {
      const { indexProject } = await import("../../lib/embeddings");
      const r = await indexProject(id, dir, { full: !!full, pathPrefix: path_prefix });
      logger.info({ projectId: id, ...r }, "background index complete");
    } catch (err: any) {
      logger.warn({ projectId: id, err: err.message }, "background index failed");
    }
  })();
  const { projectEmbeddingStats } = await import("../../lib/embeddings");
  let stats = { chunks: 0, files: 0, lastUpdated: null as string | null };
  try { stats = await projectEmbeddingStats(id); } catch { /* schema may not exist yet */ }
  res.status(202).json({ status: "indexing", stats });
});

router.get("/projects/:id/index/stats", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }
  try {
    const { projectEmbeddingStats } = await import("../../lib/embeddings");
    const stats = await projectEmbeddingStats(id);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/projects/:id/search", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }
  const { query, k } = (req.body ?? {}) as { query?: string; k?: number };
  const q = String(query ?? "").trim();
  if (!q) { res.status(400).json({ error: "query is required" }); return; }
  try {
    const { searchProject, projectEmbeddingStats } = await import("../../lib/embeddings");
    const stats = await projectEmbeddingStats(id);
    if (stats.chunks === 0) { res.json({ hits: [], stats, hint: "Index is empty — POST /index first." }); return; }
    const hits = await searchProject(id, q, Math.max(1, Math.min(50, Number(k) || 10)));
    res.json({ hits, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Kill any background processes registered to this project before deleting
  // its DB row so we don't leak orphaned children + zombie map entries.
  killProjectProcesses(params.data.id);

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
