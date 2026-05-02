import { Router, type IRouter } from "express";
import { eq, count, desc, sql, gte } from "drizzle-orm";
import { db, settingsTable, projectsTable, filesTable, aiRequestsTable } from "@workspace/db";
import {
  invalidateSettingsCache,
  PROVIDER_CONFIGS,
  PROVIDER_NAMES,
  type ProviderName,
} from "../../lib/ai-providers";

const router: IRouter = Router();

function requireAdmin(req: any, res: any, next: any): void {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth || !auth.startsWith("Basic ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const b64 = auth.slice("Basic ".length);
  const decoded = Buffer.from(b64, "base64").toString("utf-8");
  const expected = process.env.ADMIN_CREDS || "LUXI:LUXI";
  if (decoded !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
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

async function deleteSetting(key: string): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, key));
}

const ENV_KEY_MAP: Record<ProviderName, string> = {
  gemini: "GOOGLE_API_KEY",
  vertex: "VERTEX_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
  huggingface: "HUGGINGFACE_API_KEY",
  cloudflare: "CLOUDFLARE_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  hyperbolic: "HYPERBOLIC_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  cohere: "COHERE_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  pollinations: "POLLINATIONS_API_KEY",
  ollama: "OLLAMA_API_KEY",
  custom: "CUSTOM_API_KEY",
};

async function buildSettingsPayload() {
  const provider = ((await getSetting("ai_provider")) ?? "gemini") as ProviderName;
  const fallbackProvider = (await getSetting("ai_fallback_provider")) as ProviderName | null;
  const updatedAt = await getSetting("settings_updated_at");

  const providers: Record<string, any> = {};
  for (const p of PROVIDER_NAMES) {
    const cfg = PROVIDER_CONFIGS[p];
    const apiKey = (await getSetting(`${p}_api_key`)) || process.env[ENV_KEY_MAP[p]] || "";
    const model = (await getSetting(`${p}_model`)) || cfg.defaultModel;
    const baseURL = (await getSetting(`${p}_base_url`)) || cfg.defaultBaseURL || "";
    providers[p] = {
      name: p,
      label: cfg.label,
      apiStyle: cfg.apiStyle,
      description: cfg.description,
      freeNote: cfg.freeNote ?? null,
      signupURL: cfg.signupURL,
      needsKey: cfg.needsKey,
      keyConfigured: !!apiKey,
      keyFromEnv: !apiKey ? false : !(await getSetting(`${p}_api_key`)),
      model,
      baseURL,
      defaultBaseURL: cfg.defaultBaseURL ?? null,
      baseURLEditable: !!cfg.baseURLEditable,
      models: cfg.models,
    };
  }

  // Active model for current provider
  const activeModel =
    (await getSetting("ai_model")) ||
    (await getSetting(`${provider}_model`)) ||
    PROVIDER_CONFIGS[provider]?.defaultModel ||
    "";

  return {
    provider,
    model: activeModel,
    fallbackProvider,
    providers,
    updatedAt: updatedAt ?? null,
  };
}

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await buildSettingsPayload());
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    provider?: string;
    model?: string;
    fallbackProvider?: string | null;
    providerConfigs?: Record<string, { apiKey?: string; model?: string; baseURL?: string }>;
  };

  if (body.provider) {
    if (!(body.provider in PROVIDER_CONFIGS)) {
      res.status(400).json({ error: `Invalid provider: ${body.provider}` });
      return;
    }
    await setSetting("ai_provider", body.provider);
  }

  if (body.model !== undefined) {
    await setSetting("ai_model", body.model);
  }

  if (body.fallbackProvider !== undefined) {
    if (body.fallbackProvider === null || body.fallbackProvider === "") {
      await deleteSetting("ai_fallback_provider");
    } else if (body.fallbackProvider in PROVIDER_CONFIGS) {
      await setSetting("ai_fallback_provider", body.fallbackProvider);
    }
  }

  if (body.providerConfigs) {
    for (const [pName, conf] of Object.entries(body.providerConfigs)) {
      if (!(pName in PROVIDER_CONFIGS)) continue;
      if (typeof conf.apiKey === "string" && conf.apiKey.trim()) {
        await setSetting(`${pName}_api_key`, conf.apiKey.trim());
      }
      if (typeof conf.model === "string" && conf.model.trim()) {
        await setSetting(`${pName}_model`, conf.model.trim());
      }
      if (typeof conf.baseURL === "string") {
        let url = conf.baseURL.trim().replace(/\/+$/, "");
        if (url) {
          // Allow http only for localhost / 127.0.0.1; everything else must be https
          const isLocal = /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/.test(url);
          if (!isLocal && !url.startsWith("https://")) {
            res.status(400).json({ error: `${pName}: base URL must start with https:// (http:// only allowed for localhost)` });
            return;
          }
          await setSetting(`${pName}_base_url`, url);
        } else {
          await deleteSetting(`${pName}_base_url`);
        }
      }
    }
  }

  await setSetting("settings_updated_at", new Date().toISOString());
  invalidateSettingsCache();

  res.json(await buildSettingsPayload());
});

router.delete("/admin/settings/:provider/key", requireAdmin, async (req, res): Promise<void> => {
  const provider = req.params.provider as ProviderName;
  if (!(provider in PROVIDER_CONFIGS)) {
    res.status(400).json({ error: "Invalid provider" });
    return;
  }
  await deleteSetting(`${provider}_api_key`);
  invalidateSettingsCache();
  res.json({ success: true });
});

router.post("/admin/test-provider", requireAdmin, async (req, res): Promise<void> => {
  const { provider } = (req.body ?? {}) as { provider?: string };
  if (!provider || !(provider in PROVIDER_CONFIGS)) {
    res.status(400).json({ error: "Invalid provider" });
    return;
  }
  const { getProviderSettingsByName, agentCall } = await import("../../lib/ai-providers");
  const settings = await getProviderSettingsByName(provider as ProviderName);
  if (!settings) {
    res.status(400).json({ error: "Provider not configured (missing API key)" });
    return;
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20_000);
    const result = await agentCall(
      settings,
      "You are a helpful assistant. Respond with exactly: OK",
      [{ role: "user", parts: [{ text: "Say OK" }] }],
      [],
      ctrl.signal
    );
    clearTimeout(timeout);
    const text = result.textParts.join("").trim();
    if (result.finishReason?.startsWith("error:")) {
      res.json({ ok: false, error: result.finishReason, model: settings.model });
      return;
    }
    res.json({ ok: true, response: text.slice(0, 200), model: settings.model });
  } catch (err: any) {
    res.json({ ok: false, error: err.message ?? "Unknown error" });
  }
});

router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [projectCount] = await db.select({ count: count() }).from(projectsTable);
  const [fileCount] = await db.select({ count: count() }).from(filesTable);
  const [requestCount] = await db.select({ count: count() }).from(aiRequestsTable);

  // Recent requests (last 7 days)
  const recent = await db
    .select()
    .from(aiRequestsTable)
    .orderBy(desc(aiRequestsTable.createdAt))
    .limit(100);

  const now = Date.now();
  const dayMs = 86_400_000;
  const buckets = Array.from({ length: 7 }, (_, i) => ({ day: i, count: 0 }));
  for (const r of recent) {
    if (!r.createdAt) continue;
    const ageDays = Math.floor((now - new Date(r.createdAt).getTime()) / dayMs);
    if (ageDays >= 0 && ageDays < 7) buckets[ageDays].count++;
  }

  res.json({
    projectCount: Number(projectCount?.count ?? 0),
    fileCount: Number(fileCount?.count ?? 0),
    totalRequests: Number(requestCount?.count ?? 0),
    last7Days: buckets,
  });
});

// =====================================================================
// /admin/usage — token usage and cost dashboard
// =====================================================================
router.get("/admin/usage", requireAdmin, async (req, res): Promise<void> => {
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86_400_000);

  const recent = await db
    .select()
    .from(aiRequestsTable)
    .where(gte(aiRequestsTable.createdAt, since))
    .orderBy(desc(aiRequestsTable.createdAt));

  // Aggregate totals
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  let totalRequests = recent.length;
  let totalDuration = 0;
  let successCount = 0;

  // Per-day buckets
  const dayMap = new Map<string, { date: string; tokensIn: number; tokensOut: number; costUsd: number; requests: number }>();
  // Per-provider
  const providerMap = new Map<string, { provider: string; tokensIn: number; tokensOut: number; costUsd: number; requests: number }>();
  // Per-model
  const modelMap = new Map<string, { model: string; tokensIn: number; tokensOut: number; costUsd: number; requests: number }>();
  // Per-project
  const projectMap = new Map<number, { projectId: number; tokensIn: number; tokensOut: number; costUsd: number; requests: number }>();

  for (const r of recent) {
    const tIn = r.tokensIn ?? 0;
    const tOut = r.tokensOut ?? 0;
    const cost = parseFloat(r.costUsd ?? "0") || 0;
    totalIn += tIn;
    totalOut += tOut;
    totalCost += cost;
    totalDuration += r.durationMs ?? 0;
    if (r.success) successCount++;

    if (r.createdAt) {
      const d = new Date(r.createdAt).toISOString().slice(0, 10);
      const cur = dayMap.get(d) ?? { date: d, tokensIn: 0, tokensOut: 0, costUsd: 0, requests: 0 };
      cur.tokensIn += tIn; cur.tokensOut += tOut; cur.costUsd += cost; cur.requests += 1;
      dayMap.set(d, cur);
    }
    const prov = r.provider ?? "unknown";
    const cp = providerMap.get(prov) ?? { provider: prov, tokensIn: 0, tokensOut: 0, costUsd: 0, requests: 0 };
    cp.tokensIn += tIn; cp.tokensOut += tOut; cp.costUsd += cost; cp.requests += 1;
    providerMap.set(prov, cp);

    const m = r.model ?? "unknown";
    const cm = modelMap.get(m) ?? { model: m, tokensIn: 0, tokensOut: 0, costUsd: 0, requests: 0 };
    cm.tokensIn += tIn; cm.tokensOut += tOut; cm.costUsd += cost; cm.requests += 1;
    modelMap.set(m, cm);

    if (r.projectId != null) {
      const cprj = projectMap.get(r.projectId) ?? { projectId: r.projectId, tokensIn: 0, tokensOut: 0, costUsd: 0, requests: 0 };
      cprj.tokensIn += tIn; cprj.tokensOut += tOut; cprj.costUsd += cost; cprj.requests += 1;
      projectMap.set(r.projectId, cprj);
    }
  }

  // Fill day gaps
  const byDay: { date: string; tokensIn: number; tokensOut: number; costUsd: number; requests: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    byDay.push(dayMap.get(d) ?? { date: d, tokensIn: 0, tokensOut: 0, costUsd: 0, requests: 0 });
  }

  res.json({
    days,
    totals: {
      requests: totalRequests,
      tokensIn: totalIn,
      tokensOut: totalOut,
      costUsd: Number(totalCost.toFixed(6)),
      avgDurationMs: totalRequests ? Math.round(totalDuration / totalRequests) : 0,
      successRate: totalRequests ? Number((successCount / totalRequests).toFixed(4)) : 1,
    },
    byDay,
    byProvider: Array.from(providerMap.values()).sort((a, b) => b.costUsd - a.costUsd),
    byModel: Array.from(modelMap.values()).sort((a, b) => b.costUsd - a.costUsd),
    byProject: Array.from(projectMap.values()).sort((a, b) => b.costUsd - a.costUsd).slice(0, 20),
    recent: recent.slice(0, 50).map((r) => ({
      id: r.id,
      projectId: r.projectId,
      provider: r.provider,
      model: r.model,
      endpoint: r.endpoint,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      costUsd: parseFloat(r.costUsd ?? "0"),
      durationMs: r.durationMs,
      success: r.success === 1,
      createdAt: r.createdAt,
    })),
  });
});

export default router;
