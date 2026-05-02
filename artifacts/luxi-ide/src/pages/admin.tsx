import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Shield,
  Key,
  BarChart3,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Home,
  Sparkles,
  Cpu,
  Zap,
  Bot,
  Cloud,
  Rocket,
  Server,
  Globe,
  Wrench,
  Flame,
  Wand2,
  Brain,
  DollarSign,
  Activity,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const AUTH_KEY = "luxi_admin_authed";
const AUTH_HEADER_KEY = "luxi_admin_auth_header";

function getAuthHeader(): string {
  return localStorage.getItem(AUTH_HEADER_KEY) || `Basic ${btoa("LUXI:LUXI")}`;
}

interface ModelMeta {
  value: string;
  label: string;
  free?: boolean;
  vision?: boolean;
  recommended?: boolean;
}

interface ProviderInfo {
  name: string;
  label: string;
  apiStyle: string;
  description: string;
  freeNote: string | null;
  signupURL: string;
  needsKey: boolean;
  keyConfigured: boolean;
  keyFromEnv: boolean;
  model: string;
  baseURL: string;
  defaultBaseURL: string | null;
  baseURLEditable: boolean;
  models: ModelMeta[];
}

interface AdminSettings {
  provider: string;
  model: string;
  fallbackProvider: string | null;
  providers: Record<string, ProviderInfo>;
  updatedAt: string | null;
}

interface AdminStats {
  projectCount: number;
  fileCount: number;
  totalRequests: number;
  last7Days?: { day: number; count: number }[];
}

interface UsageRow {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  requests: number;
}

interface UsageData {
  days: number;
  totals: UsageRow & { avgDurationMs: number; successRate: number };
  byDay: (UsageRow & { date: string })[];
  byProvider: (UsageRow & { provider: string })[];
  byModel: (UsageRow & { model: string })[];
  byProject: (UsageRow & { projectId: number })[];
  recent: {
    id: number;
    projectId: number | null;
    provider: string | null;
    model: string | null;
    endpoint: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    costUsd: number;
    durationMs: number | null;
    success: boolean;
    createdAt: string | null;
  }[];
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(5);
  if (n < 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}

const PROVIDER_ICONS: Record<string, { icon: any; color: string }> = {
  gemini:     { icon: Sparkles, color: "text-blue-400" },
  anthropic:  { icon: Cpu,      color: "text-orange-400" },
  openai:     { icon: Zap,      color: "text-green-400" },
  openrouter: { icon: Globe,    color: "text-purple-400" },
  groq:       { icon: Flame,    color: "text-red-400" },
  moonshot:   { icon: Wand2,    color: "text-cyan-400" },
  deepseek:   { icon: Brain,    color: "text-pink-400" },
  together:   { icon: Cloud,    color: "text-indigo-400" },
  mistral:    { icon: Rocket,   color: "text-amber-400" },
  xai:        { icon: Bot,      color: "text-zinc-300" },
  cerebras:   { icon: Sparkles, color: "text-emerald-400" },
  ollama:     { icon: Server,   color: "text-slate-300" },
  custom:     { icon: Wrench,   color: "text-fuchsia-400" },
};

function StatCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground font-mono">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageDays, setUsageDays] = useState(30);
  const [activeProvider, setActiveProvider] = useState<string>("gemini");
  const [activeModel, setActiveModel] = useState<string>("");
  const [fallbackProvider, setFallbackProvider] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; model: string; baseURL: string }>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [editingProvider, setEditingProvider] = useState<string>("gemini");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  useEffect(() => {
    if (localStorage.getItem(AUTH_KEY) === "true") setIsAuthed(true);
  }, []);

  useEffect(() => {
    if (isAuthed) loadData();
  }, [isAuthed]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      const auth = getAuthHeader();
      const [sRes, stRes] = await Promise.all([
        fetch("/api/admin/settings", { headers: { Authorization: auth } }),
        fetch("/api/admin/stats", { headers: { Authorization: auth } }),
      ]);
      if (sRes.ok) {
        const s = (await sRes.json()) as AdminSettings;
        setSettings(s);
        setActiveProvider(s.provider);
        setActiveModel(s.model);
        setFallbackProvider(s.fallbackProvider ?? "");
        setEditingProvider(s.provider);
      }
      if (stRes.ok) setStats((await stRes.json()) as AdminStats);
    } finally {
      setLoadingData(false);
    }
  };

  const loadUsage = async (days: number) => {
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/admin/usage?days=${days}`, { headers: { Authorization: getAuthHeader() } });
      if (res.ok) setUsage((await res.json()) as UsageData);
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthed) loadUsage(usageDays);
  }, [isAuthed, usageDays]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    const b64 = btoa(`${loginUser}:${loginPass}`);
    const header = `Basic ${b64}`;
    const res = await fetch("/api/admin/settings", { headers: { Authorization: header } });
    setLoginLoading(false);
    if (res.ok) {
      localStorage.setItem(AUTH_KEY, "true");
      localStorage.setItem(AUTH_HEADER_KEY, header);
      setIsAuthed(true);
    } else {
      setLoginError("Invalid credentials. Try LUXI / LUXI.");
    }
  };

  const updateDraft = (p: string, field: "apiKey" | "model" | "baseURL", value: string) => {
    setDrafts((d) => {
      const existing = d[p] ?? { apiKey: "", model: "", baseURL: "" };
      return { ...d, [p]: { ...existing, [field]: value } };
    });
  };

  const handleSaveActive = async () => {
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const providerConfigs: Record<string, { apiKey?: string; model?: string; baseURL?: string }> = {};
    for (const [p, draft] of Object.entries(drafts)) {
      const conf: { apiKey?: string; model?: string; baseURL?: string } = {};
      if (draft.apiKey?.trim()) conf.apiKey = draft.apiKey.trim();
      if (draft.model?.trim()) conf.model = draft.model.trim();
      if (draft.baseURL !== undefined && draft.baseURL !== (settings?.providers[p]?.baseURL ?? "")) {
        conf.baseURL = draft.baseURL;
      }
      if (Object.keys(conf).length) providerConfigs[p] = conf;
    }

    const body = {
      provider: activeProvider,
      model: activeModel,
      fallbackProvider: fallbackProvider || null,
      providerConfigs,
    };

    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: getAuthHeader() },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      const updated = (await res.json()) as AdminSettings;
      setSettings(updated);
      setActiveProvider(updated.provider);
      setActiveModel(updated.model);
      setFallbackProvider(updated.fallbackProvider ?? "");
      setDrafts({});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } else {
      const err = await res.text();
      setSaveError(`Failed: ${err.slice(0, 200)}`);
    }
  };

  const handleTest = async (p: string) => {
    setTesting(p);
    setTestResult((r) => ({ ...r, [p]: { ok: false, msg: "Testing..." } }));
    try {
      const res = await fetch("/api/admin/test-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: getAuthHeader() },
        body: JSON.stringify({ provider: p }),
      });
      const data = (await res.json()) as { ok: boolean; response?: string; error?: string; model?: string };
      setTestResult((r) => ({
        ...r,
        [p]: data.ok
          ? { ok: true, msg: `OK · ${data.model} · "${data.response?.slice(0, 60)}"` }
          : { ok: false, msg: data.error?.slice(0, 200) ?? "Unknown error" },
      }));
    } catch (err: any) {
      setTestResult((r) => ({ ...r, [p]: { ok: false, msg: err.message ?? "Network error" } }));
    } finally {
      setTesting(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthed(false);
  };

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to configure Luxi IDE</p>
          </div>
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-sm">Username</Label>
                  <Input id="username" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} placeholder="LUXI" autoFocus data-testid="input-admin-username" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm">Password</Label>
                  <div className="relative">
                    <Input id="password" type={showPass ? "text" : "password"} value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="LUXI" data-testid="input-admin-password" />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {loginError && (
                  <div className="flex items-center gap-2 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{loginError}</span>
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={loginLoading} data-testid="button-admin-login">
                  {loginLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...</> : "Sign In"}
                </Button>
              </form>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground mt-4">Default credentials: LUXI / LUXI</p>
        </motion.div>
      </div>
    );
  }

  const providers = settings?.providers ?? {};
  const providerNames = Object.keys(providers);
  const editing = providers[editingProvider];
  const editIcon = PROVIDER_ICONS[editingProvider] ?? PROVIDER_ICONS.custom;
  const EditIcon = editIcon.icon;

  const draft = drafts[editingProvider] || { apiKey: "", model: "", baseURL: "" };
  const currentModel = draft.model || editing?.model || "";
  const currentBaseURL = draft.baseURL || editing?.baseURL || "";

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 flex items-center px-6 border-b border-border bg-card">
        <Link href="/">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground" data-testid="button-back-home">
            <Home className="w-4 h-4" />
            <span className="text-sm">Home</span>
          </button>
        </Link>
        <div className="w-px h-4 bg-border mx-4" />
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Admin Panel</span>
        </div>
        <button onClick={handleLogout} className="ml-auto text-xs text-muted-foreground hover:text-foreground" data-testid="button-logout">
          Sign out
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Platform Stats</h2>
          {loadingData ? (
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-card border border-border rounded-lg animate-pulse" />)}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Projects" value={stats.projectCount} icon={BarChart3} />
              <StatCard label="Files" value={stats.fileCount} icon={BarChart3} />
              <StatCard label="AI Requests" value={stats.totalRequests} icon={BarChart3} />
            </div>
          ) : null}
        </div>

        <Separator className="border-border" />

        {/* === Token usage & cost dashboard === */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Token Usage & Cost
            </h2>
            <div className="flex items-center gap-1 bg-card border border-border rounded-md p-0.5">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setUsageDays(d)}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded transition-colors",
                    usageDays === d
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`usage-range-${d}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {usageLoading && !usage ? (
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 bg-card border border-border rounded-lg animate-pulse" />
              ))}
            </div>
          ) : usage ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Total Cost" value={formatCost(usage.totals.costUsd) as any} icon={DollarSign} />
                <StatCard label="Requests" value={formatNum(usage.totals.requests) as any} icon={Activity} />
                <StatCard label="Tokens In" value={formatNum(usage.totals.tokensIn) as any} icon={TrendingUp} />
                <StatCard label="Tokens Out" value={formatNum(usage.totals.tokensOut) as any} icon={TrendingUp} />
              </div>

              <Card className="bg-card border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Daily cost (USD)</div>
                      <div className="text-xs text-muted-foreground/60 mt-0.5">
                        avg latency {usage.totals.avgDurationMs}ms · success {(usage.totals.successRate * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={usage.byDay} margin={{ top: 5, right: 8, bottom: 0, left: -16 }}>
                        <defs>
                          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(d) => d.slice(5)}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(v) => "$" + v.toFixed(2)}
                          width={50}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 6,
                            fontSize: 12,
                          }}
                          formatter={(v: any, name: string) => {
                            if (name === "costUsd") return [formatCost(v as number), "Cost"];
                            return [v, name];
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="costUsd"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          fill="url(#costGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-card border-border">
                  <CardContent className="p-5">
                    <div className="text-xs text-muted-foreground mb-2">By provider</div>
                    {usage.byProvider.length === 0 ? (
                      <div className="text-xs text-muted-foreground/60 py-4 text-center">No data</div>
                    ) : (
                      <div className="space-y-1.5">
                        {usage.byProvider.map((p) => (
                          <div key={p.provider} className="flex items-center justify-between text-xs py-1">
                            <span className="font-medium capitalize">{p.provider}</span>
                            <div className="flex items-center gap-3 font-mono text-muted-foreground">
                              <span>{formatNum(p.requests)} req</span>
                              <span className="text-foreground">{formatCost(p.costUsd)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardContent className="p-5">
                    <div className="text-xs text-muted-foreground mb-2">By model</div>
                    {usage.byModel.length === 0 ? (
                      <div className="text-xs text-muted-foreground/60 py-4 text-center">No data</div>
                    ) : (
                      <div className="space-y-1.5">
                        {usage.byModel.slice(0, 8).map((m) => (
                          <div key={m.model} className="flex items-center justify-between text-xs py-1">
                            <span className="font-mono truncate max-w-[60%]">{m.model}</span>
                            <div className="flex items-center gap-3 font-mono text-muted-foreground">
                              <span>{formatNum(m.tokensIn + m.tokensOut)} tok</span>
                              <span className="text-foreground">{formatCost(m.costUsd)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {usage.byProject.length > 0 && (
                <Card className="bg-card border-border">
                  <CardContent className="p-5">
                    <div className="text-xs text-muted-foreground mb-2">Top projects</div>
                    <div className="space-y-1.5">
                      {usage.byProject.slice(0, 10).map((p) => (
                        <div key={p.projectId} className="flex items-center justify-between text-xs py-1">
                          <span className="font-mono">Project #{p.projectId}</span>
                          <div className="flex items-center gap-3 font-mono text-muted-foreground">
                            <span>{formatNum(p.requests)} req</span>
                            <span>{formatNum(p.tokensIn + p.tokensOut)} tok</span>
                            <span className="text-foreground">{formatCost(p.costUsd)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-4">No usage data yet.</div>
          )}
        </div>

        <Separator className="border-border" />

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Active Provider</h2>
          <Card className="bg-card border-border">
            <CardContent className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Primary Provider</Label>
                  <Select value={activeProvider} onValueChange={(v) => { setActiveProvider(v); setEditingProvider(v); const m = providers[v]?.model; if (m) setActiveModel(m); }}>
                    <SelectTrigger data-testid="select-active-provider"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {providerNames.map((p) => (
                        <SelectItem key={p} value={p}>
                          {providers[p].label} {providers[p].keyConfigured ? "✓" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Active Model</Label>
                  <Input
                    value={activeModel}
                    onChange={(e) => setActiveModel(e.target.value)}
                    list={`models-${activeProvider}`}
                    className="font-mono text-xs"
                    data-testid="input-active-model"
                  />
                  <datalist id={`models-${activeProvider}`}>
                    {providers[activeProvider]?.models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fallback Provider (auto-failover)</Label>
                  <Select value={fallbackProvider || "__none__"} onValueChange={(v) => setFallbackProvider(v === "__none__" ? "" : v)}>
                    <SelectTrigger data-testid="select-fallback-provider"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="__none__">None</SelectItem>
                      {providerNames.filter((p) => p !== activeProvider && providers[p].keyConfigured).map((p) => (
                        <SelectItem key={p} value={p}>{providers[p].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button onClick={handleSaveActive} disabled={saving} data-testid="button-save-settings">
                  {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Settings"}
                </Button>
                {saveSuccess && (
                  <span className="flex items-center gap-1.5 text-sm text-green-400">
                    <CheckCircle className="w-4 h-4" /> Saved
                  </span>
                )}
                {saveError && (
                  <span className="flex items-center gap-1.5 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" /> {saveError}
                  </span>
                )}
                {settings?.updatedAt && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Last updated {new Date(settings.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator className="border-border" />

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Provider Configuration</h2>
            <p className="text-xs text-muted-foreground">{providerNames.length} providers · click to configure</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-5">
            {providerNames.map((p) => {
              const info = providers[p];
              const ic = PROVIDER_ICONS[p] ?? PROVIDER_ICONS.custom;
              const PIcon = ic.icon;
              const hasFreeModel = info.models.some((m) => m.free);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setEditingProvider(p)}
                  data-testid={`button-edit-provider-${p}`}
                  className={cn(
                    "relative flex flex-col items-start gap-1 p-3 rounded-lg border transition-all text-left text-xs",
                    editingProvider === p
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-muted-foreground/40"
                  )}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <PIcon className={cn("w-4 h-4", ic.color)} />
                    <span className="font-semibold text-foreground truncate flex-1">{info.label}</span>
                    {info.keyConfigured && <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" />}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {hasFreeModel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">FREE</span>
                    )}
                    {activeProvider === p && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">ACTIVE</span>
                    )}
                    {fallbackProvider === p && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">FALLBACK</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {editing && (
            <Card className="bg-card border-border">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className={cn("w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center", editIcon.color)}>
                    <EditIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-foreground">{editing.label}</h3>
                    <p className="text-xs text-muted-foreground">{editing.description}</p>
                    {editing.freeNote && (
                      <p className="text-xs text-emerald-400 mt-1">{editing.freeNote}</p>
                    )}
                  </div>
                  {editing.signupURL && (
                    <a href={editing.signupURL} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      Get API key →
                    </a>
                  )}
                </div>

                {editing.needsKey && (
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Key className="w-3 h-3" />
                      API Key
                      {editing.keyConfigured && (
                        <span className="text-[10px] text-muted-foreground font-normal">
                          ({editing.keyFromEnv ? "from env" : "configured"} — leave blank to keep current)
                        </span>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        type={showKeys[editingProvider] ? "text" : "password"}
                        value={draft.apiKey}
                        onChange={(e) => updateDraft(editingProvider, "apiKey", e.target.value)}
                        placeholder={editing.keyConfigured ? "••••••••••••••••" : "Enter API key"}
                        className="font-mono text-xs pr-10"
                        data-testid={`input-key-${editingProvider}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeys((k) => ({ ...k, [editingProvider]: !k[editingProvider] }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKeys[editingProvider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Default Model</Label>
                  <Input
                    value={currentModel}
                    onChange={(e) => updateDraft(editingProvider, "model", e.target.value)}
                    list={`edit-models-${editingProvider}`}
                    placeholder={editing.models[0]?.value ?? "model-id"}
                    className="font-mono text-xs"
                    data-testid={`input-model-${editingProvider}`}
                  />
                  <datalist id={`edit-models-${editingProvider}`}>
                    {editing.models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </datalist>
                  {editing.models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {editing.models.slice(0, 8).map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => updateDraft(editingProvider, "model", m.value)}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded border transition-colors",
                            currentModel === m.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {m.label}
                          {m.free && <span className="ml-1 text-emerald-400">·F</span>}
                          {m.vision && <span className="ml-0.5 text-blue-400">·V</span>}
                          {m.recommended && <span className="ml-0.5 text-amber-400">·★</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {(editing.baseURLEditable || editing.defaultBaseURL) && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Base URL {editing.baseURLEditable ? "" : "(read-only)"}
                    </Label>
                    <Input
                      value={currentBaseURL}
                      onChange={(e) => updateDraft(editingProvider, "baseURL", e.target.value)}
                      readOnly={!editing.baseURLEditable}
                      placeholder={editing.defaultBaseURL ?? "https://your-endpoint.com/v1"}
                      className="font-mono text-xs"
                      data-testid={`input-baseurl-${editingProvider}`}
                    />
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTest(editingProvider)}
                    disabled={testing === editingProvider || (editing.needsKey && !editing.keyConfigured && !draft.apiKey)}
                    data-testid={`button-test-${editingProvider}`}
                  >
                    {testing === editingProvider ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing...</> : "Test connection"}
                  </Button>
                  {testResult[editingProvider] && (
                    <span className={cn(
                      "text-xs flex items-center gap-1.5 truncate",
                      testResult[editingProvider].ok ? "text-green-400" : "text-destructive"
                    )}>
                      {testResult[editingProvider].ok ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                      {testResult[editingProvider].msg}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Separator className="border-border" />

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">All Providers Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {providerNames.map((p) => {
              const info = providers[p];
              const ic = PROVIDER_ICONS[p] ?? PROVIDER_ICONS.custom;
              const PIcon = ic.icon;
              return (
                <div key={p} className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border",
                  info.keyConfigured ? "border-green-400/20 bg-green-400/5" : "border-border bg-card"
                )}>
                  <PIcon className={cn("w-4 h-4 flex-shrink-0", ic.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate">{info.label}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{info.model}</div>
                  </div>
                  {info.keyConfigured ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle className="w-3 h-3" /> {info.keyFromEnv ? "env" : "key"}
                    </span>
                  ) : info.needsKey ? (
                    <span className="text-xs text-muted-foreground">Not configured</span>
                  ) : (
                    <span className="text-xs text-blue-400">No key needed</span>
                  )}
                  {activeProvider === p && (
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">Active</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
