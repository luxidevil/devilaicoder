import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, settingsTable, projectsTable, filesTable, aiRequestsTable } from "@workspace/db";
import { invalidateSettingsCache, PROVIDER_MODELS, type ProviderName } from "../../lib/ai-providers";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any): void {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth || !auth.startsWith("Basic ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const b64 = auth.slice("Basic ".length);
  const decoded = Buffer.from(b64, "base64").toString("utf-8");
  if (decoded !== "LUXI:LUXI") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value, updatedAt: new Date() },
    });
}

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const provider = (await getSetting("ai_provider")) ?? "gemini";
  const model = await getSetting("ai_model");
  const geminiKey = await getSetting("gemini_api_key");
  const anthropicKey = await getSetting("anthropic_api_key");
  const openaiKey = await getSetting("openai_api_key");
  const updatedAt = await getSetting("settings_updated_at");

  const defaultModel = PROVIDER_MODELS[provider as ProviderName]?.[0]?.value ?? "gemini-2.0-flash";

  res.json({
    provider,
    model: model ?? defaultModel,
    geminiKeyConfigured: !!(geminiKey || process.env.GOOGLE_API_KEY),
    anthropicKeyConfigured: !!(anthropicKey || process.env.ANTHROPIC_API_KEY),
    openaiKeyConfigured: !!(openaiKey || process.env.OPENAI_API_KEY),
    providerModels: PROVIDER_MODELS,
    updatedAt: updatedAt ?? null,
  });
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const { provider, model, geminiApiKey, anthropicApiKey, openaiApiKey } = req.body as {
    provider?: string;
    model?: string;
    geminiApiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
  };

  const validProviders: ProviderName[] = ["gemini", "anthropic", "openai"];
  if (provider) {
    if (!validProviders.includes(provider as ProviderName)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
      return;
    }
    await setSetting("ai_provider", provider);
  }
  if (model) {
    const targetProvider = (provider ?? (await getSetting("ai_provider")) ?? "gemini") as ProviderName;
    const validModels = PROVIDER_MODELS[targetProvider]?.map((m) => m.value) ?? [];
    if (validModels.length > 0 && !validModels.includes(model)) {
      res.status(400).json({ error: `Invalid model for ${targetProvider}. Must be one of: ${validModels.join(", ")}` });
      return;
    }
    await setSetting("ai_model", model);
  }
  if (geminiApiKey) await setSetting("gemini_api_key", geminiApiKey);
  if (anthropicApiKey) await setSetting("anthropic_api_key", anthropicApiKey);
  if (openaiApiKey) await setSetting("openai_api_key", openaiApiKey);
  await setSetting("settings_updated_at", new Date().toISOString());
  invalidateSettingsCache();

  const currentProvider = (await getSetting("ai_provider")) ?? "gemini";
  const currentModel = await getSetting("ai_model");
  const defaultModel = PROVIDER_MODELS[currentProvider as ProviderName]?.[0]?.value ?? "gemini-2.0-flash";

  res.json({
    provider: currentProvider,
    model: currentModel ?? defaultModel,
    geminiKeyConfigured: !!(await getSetting("gemini_api_key")),
    anthropicKeyConfigured: !!(await getSetting("anthropic_api_key")),
    openaiKeyConfigured: !!(await getSetting("openai_api_key")),
    providerModels: PROVIDER_MODELS,
    updatedAt: new Date().toISOString(),
  });
});

router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [projectCount] = await db.select({ count: count() }).from(projectsTable);
  const [fileCount] = await db.select({ count: count() }).from(filesTable);
  const [requestCount] = await db.select({ count: count() }).from(aiRequestsTable);

  res.json({
    projectCount: Number(projectCount?.count ?? 0),
    fileCount: Number(fileCount?.count ?? 0),
    totalRequests: Number(requestCount?.count ?? 0),
  });
});

export default router;
