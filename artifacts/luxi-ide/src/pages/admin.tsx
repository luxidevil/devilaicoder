import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const ADMIN_B64 = btoa("LUXI:LUXI");
const ADMIN_HEADER = `Basic ${ADMIN_B64}`;
const AUTH_KEY = "luxi_admin_authed";

type ProviderName = "gemini" | "anthropic" | "openai";

interface ProviderModel {
  value: string;
  label: string;
}

interface AdminSettings {
  provider: string;
  model: string;
  geminiKeyConfigured: boolean;
  anthropicKeyConfigured: boolean;
  openaiKeyConfigured: boolean;
  providerModels: Record<ProviderName, ProviderModel[]>;
  updatedAt: string | null;
}

interface AdminStats {
  projectCount: number;
  fileCount: number;
  totalRequests: number;
}

const PROVIDER_INFO: Record<ProviderName, { name: string; icon: typeof Sparkles; color: string; keyPlaceholder: string; keyLabel: string; keyLink: string; keyLinkText: string }> = {
  gemini: {
    name: "Google Gemini",
    icon: Sparkles,
    color: "text-blue-400",
    keyPlaceholder: "AIza...",
    keyLabel: "Google AI Studio API Key",
    keyLink: "https://aistudio.google.com",
    keyLinkText: "aistudio.google.com",
  },
  anthropic: {
    name: "Anthropic Claude",
    icon: Cpu,
    color: "text-orange-400",
    keyPlaceholder: "sk-ant-...",
    keyLabel: "Anthropic API Key",
    keyLink: "https://console.anthropic.com",
    keyLinkText: "console.anthropic.com",
  },
  openai: {
    name: "OpenAI",
    icon: Zap,
    color: "text-green-400",
    keyPlaceholder: "sk-...",
    keyLabel: "OpenAI API Key",
    keyLink: "https://platform.openai.com",
    keyLinkText: "platform.openai.com",
  },
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
  const [provider, setProvider] = useState<ProviderName>("gemini");
  const [model, setModel] = useState("gemini-2.0-flash");
  const [apiKeys, setApiKeys] = useState<Record<ProviderName, string>>({ gemini: "", anthropic: "", openai: "" });
  const [showKeys, setShowKeys] = useState<Record<ProviderName, boolean>>({ gemini: false, anthropic: false, openai: false });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored === "true") {
      setIsAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthed) {
      loadData();
    }
  }, [isAuthed]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      const [sRes, stRes] = await Promise.all([
        fetch("/api/admin/settings", { headers: { Authorization: ADMIN_HEADER } }),
        fetch("/api/admin/stats", { headers: { Authorization: ADMIN_HEADER } }),
      ]);
      if (sRes.ok) {
        const s = await sRes.json() as AdminSettings;
        setSettings(s);
        setProvider(s.provider as ProviderName);
        setModel(s.model);
      }
      if (stRes.ok) {
        const st = await stRes.json() as AdminStats;
        setStats(st);
      }
    } finally {
      setLoadingData(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    const b64 = btoa(`${loginUser}:${loginPass}`);
    const res = await fetch("/api/admin/settings", {
      headers: { Authorization: `Basic ${b64}` },
    });
    setLoginLoading(false);
    if (res.ok) {
      localStorage.setItem(AUTH_KEY, "true");
      setIsAuthed(true);
    } else {
      setLoginError("Invalid credentials. Try LUXI / LUXI.");
    }
  };

  const handleProviderChange = (newProvider: ProviderName) => {
    setProvider(newProvider);
    const models = settings?.providerModels?.[newProvider];
    if (models && models.length > 0) {
      setModel(models[0].value);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    const body: Record<string, string> = { provider, model };
    if (apiKeys.gemini.trim()) body.geminiApiKey = apiKeys.gemini.trim();
    if (apiKeys.anthropic.trim()) body.anthropicApiKey = apiKeys.anthropic.trim();
    if (apiKeys.openai.trim()) body.openaiApiKey = apiKeys.openai.trim();

    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: ADMIN_HEADER,
      },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (res.ok) {
      const updated = await res.json() as AdminSettings;
      setSettings(updated);
      setApiKeys({ gemini: "", anthropic: "", openai: "" });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } else {
      setSaveError("Failed to save settings.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthed(false);
  };

  const currentKeyConfigured = settings
    ? (provider === "gemini" ? settings.geminiKeyConfigured
      : provider === "anthropic" ? settings.anthropicKeyConfigured
      : settings.openaiKeyConfigured)
    : false;

  const providerInfo = PROVIDER_INFO[provider];
  const ProviderIcon = providerInfo.icon;
  const models = settings?.providerModels?.[provider] ?? [];

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
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
                  <Input
                    id="username"
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                    placeholder="LUXI"
                    autoFocus
                    data-testid="input-admin-username"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPass ? "text" : "password"}
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      placeholder="LUXI"
                      data-testid="input-admin-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
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
                  {loginLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in...</>
                  ) : "Sign In"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-4">
            Default credentials: LUXI / LUXI
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 flex items-center px-6 border-b border-border bg-card">
        <Link href="/">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mr-4" data-testid="button-back-home">
            <Home className="w-4 h-4" />
            <span className="text-sm">Home</span>
          </button>
        </Link>
        <div className="w-px h-4 bg-border mr-4" />
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Admin Panel</span>
        </div>
        <button
          onClick={handleLogout}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-logout"
        >
          Sign out
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Platform Stats</h2>
          {loadingData ? (
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-card border border-border rounded-lg animate-pulse" />
              ))}
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

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">AI Provider Configuration</h2>

          {settings && (
            <div className={cn(
              "flex items-center gap-2 text-sm mb-4 p-3 rounded-lg border",
              currentKeyConfigured
                ? "text-green-400 bg-green-400/5 border-green-400/20"
                : "text-amber-400 bg-amber-400/5 border-amber-400/20"
            )}>
              {currentKeyConfigured ? (
                <><CheckCircle className="w-4 h-4" /> {providerInfo.name} API key is configured and active</>
              ) : (
                <><AlertCircle className="w-4 h-4" /> No {providerInfo.name} API key configured. Add your key below.</>
              )}
            </div>
          )}

          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" />
                AI Settings
              </CardTitle>
              <CardDescription>
                Choose your AI provider and configure API keys. Supports Gemini, Claude, and OpenAI.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveSettings} className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-sm">AI Provider</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["gemini", "anthropic", "openai"] as ProviderName[]).map((p) => {
                      const info = PROVIDER_INFO[p];
                      const PIcon = info.icon;
                      const isKeySet = settings
                        ? (p === "gemini" ? settings.geminiKeyConfigured
                          : p === "anthropic" ? settings.anthropicKeyConfigured
                          : settings.openaiKeyConfigured)
                        : false;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleProviderChange(p)}
                          className={cn(
                            "relative flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all text-sm",
                            provider === p
                              ? "border-primary bg-primary/5 text-foreground"
                              : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40"
                          )}
                        >
                          <PIcon className={cn("w-5 h-5", provider === p ? info.color : "")} />
                          <span className="font-medium">{info.name}</span>
                          {isKeySet && (
                            <span className="absolute top-1.5 right-1.5">
                              <CheckCircle className="w-3 h-3 text-green-400" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="api-key" className="text-sm flex items-center gap-1.5">
                    <ProviderIcon className={cn("w-3.5 h-3.5", providerInfo.color)} />
                    {providerInfo.keyLabel}
                    {currentKeyConfigured && (
                      <span className="ml-1 text-xs text-muted-foreground font-normal">(leave blank to keep current)</span>
                    )}
                  </Label>
                  <div className="relative">
                    <Input
                      id="api-key"
                      type={showKeys[provider] ? "text" : "password"}
                      value={apiKeys[provider]}
                      onChange={(e) => setApiKeys({ ...apiKeys, [provider]: e.target.value })}
                      placeholder={currentKeyConfigured ? "••••••••••••••••" : providerInfo.keyPlaceholder}
                      className="font-mono pr-10"
                      data-testid="input-api-key"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeys({ ...showKeys, [provider]: !showKeys[provider] })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKeys[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get your key at{" "}
                    <a href={providerInfo.keyLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {providerInfo.keyLinkText}
                    </a>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="model" className="text-sm">Model</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger id="model" data-testid="select-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {saveError && (
                  <div className="flex items-center gap-2 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>{saveError}</span>
                  </div>
                )}

                {saveSuccess && (
                  <div className="flex items-center gap-2 text-green-400 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>Settings saved successfully</span>
                  </div>
                )}

                <Button type="submit" disabled={saving} className="w-full" data-testid="button-save-settings">
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : "Save Settings"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {settings?.updatedAt && (
            <p className="text-xs text-muted-foreground mt-3">
              Last updated: {new Date(settings.updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <Separator className="border-border" />

        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">API Keys Status</h2>
          <div className="space-y-2">
            {(["gemini", "anthropic", "openai"] as ProviderName[]).map((p) => {
              const info = PROVIDER_INFO[p];
              const PIcon = info.icon;
              const isKeySet = settings
                ? (p === "gemini" ? settings.geminiKeyConfigured
                  : p === "anthropic" ? settings.anthropicKeyConfigured
                  : settings.openaiKeyConfigured)
                : false;
              return (
                <div key={p} className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border",
                  isKeySet ? "border-green-400/20 bg-green-400/5" : "border-border bg-card"
                )}>
                  <PIcon className={cn("w-4 h-4", info.color)} />
                  <span className="text-sm text-foreground flex-1">{info.name}</span>
                  {isKeySet ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <CheckCircle className="w-3 h-3" /> Configured
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not configured</span>
                  )}
                  {provider === p && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">Active</span>
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
