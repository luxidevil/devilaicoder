import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const snapshotsTable = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Checkpoint"),
  reason: text("reason"),
  files: jsonb("files").notNull().$type<{ path: string; name: string; content: string; language: string | null }[]>(),
  fileCount: integer("file_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Snapshot = typeof snapshotsTable.$inferSelect;
