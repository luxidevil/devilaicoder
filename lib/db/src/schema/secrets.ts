import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectSecretsTable = pgTable(
  "project_secrets",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    projKeyUnique: uniqueIndex("project_secrets_proj_key_uq").on(t.projectId, t.key),
  })
);

export type ProjectSecret = typeof projectSecretsTable.$inferSelect;
