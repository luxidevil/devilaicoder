import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked" | "cancelled";
export type TaskPriority = "P0" | "P1" | "P2" | "P3";

export interface ProjectTask {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  blockedBy: number[];
  tags: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const VALID_STATUS: TaskStatus[] = ["todo", "in_progress", "done", "blocked", "cancelled"];
const VALID_PRIORITY: TaskPriority[] = ["P0", "P1", "P2", "P3"];

let schemaReady: Promise<void> | null = null;

export function ensureTasksSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS project_tasks (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'P2',
        blocked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        tags TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS project_tasks_proj_status_idx ON project_tasks (project_id, status, updated_at DESC)`));
    logger.info("project_tasks schema ensured");
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

function rowToTask(r: any): ProjectTask {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description ?? "",
    status: r.status as TaskStatus,
    priority: r.priority as TaskPriority,
    blockedBy: Array.isArray(r.blocked_by) ? r.blocked_by : (typeof r.blocked_by === "string" ? JSON.parse(r.blocked_by) : []),
    tags: r.tags ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

export async function createTask(opts: {
  projectId: number; title: string; description?: string;
  status?: TaskStatus; priority?: TaskPriority; blockedBy?: number[]; tags?: string;
}): Promise<ProjectTask> {
  await ensureTasksSchema();
  const status = (opts.status && VALID_STATUS.includes(opts.status)) ? opts.status : "todo";
  const priority = (opts.priority && VALID_PRIORITY.includes(opts.priority)) ? opts.priority : "P2";
  const desc = opts.description ?? "";
  const tags = opts.tags ?? "";
  const blockedJson = JSON.stringify(opts.blockedBy ?? []);
  const r = await db.execute<any>(sql`
    INSERT INTO project_tasks (project_id, title, description, status, priority, blocked_by, tags)
    VALUES (${opts.projectId}, ${opts.title}, ${desc}, ${status}, ${priority}, ${blockedJson}::jsonb, ${tags})
    RETURNING *
  `);
  const rows = (r as any).rows ?? r;
  return rowToTask(rows[0]);
}

export async function listTasks(projectId: number, opts: { status?: TaskStatus; limit?: number } = {}): Promise<ProjectTask[]> {
  await ensureTasksSchema();
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200));
  const r = opts.status
    ? await db.execute<any>(sql`SELECT * FROM project_tasks WHERE project_id = ${projectId} AND status = ${opts.status} ORDER BY priority ASC, updated_at DESC LIMIT ${limit}`)
    : await db.execute<any>(sql`SELECT * FROM project_tasks WHERE project_id = ${projectId} ORDER BY (status = 'done')::int ASC, priority ASC, updated_at DESC LIMIT ${limit}`);
  const rows = (r as any).rows ?? r;
  return rows.map(rowToTask);
}

export async function updateTask(opts: {
  projectId: number; taskId: number;
  title?: string; description?: string; status?: TaskStatus;
  priority?: TaskPriority; blockedBy?: number[]; tags?: string;
}): Promise<ProjectTask | null> {
  await ensureTasksSchema();
  const sets: any[] = [];
  if (opts.title !== undefined) sets.push(sql`title = ${opts.title}`);
  if (opts.description !== undefined) sets.push(sql`description = ${opts.description}`);
  if (opts.status !== undefined && VALID_STATUS.includes(opts.status)) {
    sets.push(sql`status = ${opts.status}`);
    if (opts.status === "done") sets.push(sql`completed_at = NOW()`);
    else sets.push(sql`completed_at = NULL`);
  }
  if (opts.priority !== undefined && VALID_PRIORITY.includes(opts.priority)) sets.push(sql`priority = ${opts.priority}`);
  if (opts.blockedBy !== undefined) sets.push(sql`blocked_by = ${JSON.stringify(opts.blockedBy)}::jsonb`);
  if (opts.tags !== undefined) sets.push(sql`tags = ${opts.tags}`);
  if (sets.length === 0) {
    const r = await db.execute<any>(sql`SELECT * FROM project_tasks WHERE id = ${opts.taskId} AND project_id = ${opts.projectId}`);
    const rows = (r as any).rows ?? r;
    return rows[0] ? rowToTask(rows[0]) : null;
  }
  sets.push(sql`updated_at = NOW()`);
  const setSql = sets.reduce((acc, cur, i) => i === 0 ? cur : sql`${acc}, ${cur}`);
  const r = await db.execute<any>(sql`UPDATE project_tasks SET ${setSql} WHERE id = ${opts.taskId} AND project_id = ${opts.projectId} RETURNING *`);
  const rows = (r as any).rows ?? r;
  return rows[0] ? rowToTask(rows[0]) : null;
}

export async function deleteTask(projectId: number, taskId: number): Promise<boolean> {
  await ensureTasksSchema();
  const r = await db.execute<any>(sql`DELETE FROM project_tasks WHERE id = ${taskId} AND project_id = ${projectId} RETURNING id`);
  const rows = (r as any).rows ?? r;
  return rows.length > 0;
}

export async function taskStats(projectId: number): Promise<Record<TaskStatus, number> & { total: number }> {
  await ensureTasksSchema();
  const r = await db.execute<any>(sql`SELECT status, COUNT(*)::int AS n FROM project_tasks WHERE project_id = ${projectId} GROUP BY status`);
  const rows = (r as any).rows ?? r;
  const out: any = { todo: 0, in_progress: 0, done: 0, blocked: 0, cancelled: 0, total: 0 };
  for (const r of rows) { out[r.status] = r.n; out.total += r.n; }
  return out;
}
