import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  language: text("language").notNull().default("javascript"),
  sshHost: text("ssh_host"),
  sshUser: text("ssh_user"),
  sshPort: integer("ssh_port").default(22),
  sshPassword: text("ssh_password"),
  sshKey: text("ssh_key"),
  sshRemotePath: text("ssh_remote_path").default("/var/www/app"),
  sshDomain: text("ssh_domain"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
