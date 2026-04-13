import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, conversationsTable, messagesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/projects/:projectId/conversations", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.projectId, projectId))
    .orderBy(desc(conversationsTable.updatedAt));
  res.json(conversations);
});

router.post("/projects/:projectId/conversations", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const { title } = req.body as { title?: string };
  const [conversation] = await db
    .insert(conversationsTable)
    .values({ projectId, title: title ?? "New Chat" })
    .returning();
  res.status(201).json(conversation);
});

async function verifyConversation(conversationId: number): Promise<boolean> {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
  return !!conv;
}

router.get("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  if (!(await verifyConversation(conversationId))) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt);
  res.json(msgs);
});

router.post("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  if (!(await verifyConversation(conversationId))) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const { role, content } = req.body as { role: string; content: string };
  if (!role || !content) {
    res.status(400).json({ error: "role and content are required" });
    return;
  }
  const [message] = await db
    .insert(messagesTable)
    .values({ conversationId, role, content })
    .returning();

  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, conversationId));

  res.status(201).json(message);
});

router.patch("/conversations/:conversationId", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  const { title } = req.body as { title?: string };
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const [updated] = await db
    .update(conversationsTable)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversationsTable.id, conversationId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/conversations/:conversationId", async (req, res): Promise<void> => {
  const conversationId = Number(req.params.conversationId);
  await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
  res.status(204).end();
});

export default router;
