import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Shield, Key, BarChart3, CheckCircle, AlertCircle, Loader2, Eye, EyeOff,
  Home, Sparkles, Cpu, Zap, Triangle, Users, ChevronDown, ChevronUp,
  Plus, Minus, Crown, Star, Gift, Search, RefreshCw, Server, ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import {
  Button, Input, Label, Separator, Card, CardContent, CardDescription,
  CardHeader, CardTitle, Select, SelectItem,
} from '../components/ui/index';
import {
  getAdminSettings, saveAdminSettings, getAdminStats,
  listAdminUsers, grantCredits, setSubscriptionTier,
  getAdminRunnerConfig, saveRunnerConfig, testRunnerConfig,
  type AdminUser,
} from '../lib/api';
import { useAuth } from '../lib/auth';

type P = 'gemini' | 'anthropic' | 'openai' | 'vertex';
type P2 = P | 'kimi';
type AdminTab = 'overview' | 'ai' | 'users' | 'runner';

const MODELS: Record<P2, { value: string; label: string }[]> = {
  gemini: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
  ],
  anthropic: [
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  openai: [
    { value: 'o3', label: 'o3' },
    { value: 'o3-mini', label: 'o3 Mini' },
    { value: 'o1', label: 'o1' },
    { value: 'o1-mini', label: 'o1 Mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  kimi: [
    { value: 'kimi-k2.5', label: 'Kimi K2.5' },
    { value: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    { value: 'kimi-k2-thinking-turbo', label: 'Kimi K2 Thinking Turbo' },
    { value: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo Preview' },
  ],
  vertex: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro Preview' },
    { value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash Preview' },
    { value: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash Lite' },
    { value: 'gemini-2.0-pro-exp-02-05', label: 'Gemini 2.0 Pro Exp' },
    { value: 'gemini-1.5-pro-002', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash-002', label: 'Gemini 1.5 Flash' },
    { value: 'claude-opus-4@20250514', label: 'Claude Opus 4 (Vertex)' },
    { value: 'claude-sonnet-4@20250514', label: 'Claude Sonnet 4 (Vertex)' },
    { value: 'claude-3-5-sonnet-v2@20241022', label: 'Claude 3.5 Sonnet (Vertex)' },
    { value: 'claude-3-5-haiku@20241022', label: 'Claude 3.5 Haiku (Vertex)' },
    { value: 'meta/llama-3.3-70b-instruct-maas', label: 'Llama 3.3 70B' },
    { value: 'meta/llama-3.1-405b-instruct-maas', label: 'Llama 3.1 405B' },
    { value: 'mistral-large@2411', label: 'Mistral Large' },
    { value: 'mistral-nemo@2407', label: 'Mistral Nemo' },
  ],
};

const PINFO: Record<P2, { name: string; icon: typeof Sparkles; color: string; ph: string; label: string }> = {
  gemini: { name: 'Google Gemini', icon: Sparkles, color: 'text-blue-400', ph: 'AIza...', label: 'Google AI Studio API Key' },
  anthropic: { name: 'Anthropic Claude', icon: Cpu, color: 'text-orange-400', ph: 'sk-ant-...', label: 'Anthropic API Key' },
  openai: { name: 'OpenAI', icon: Zap, color: 'text-green-400', ph: 'sk-...', label: 'OpenAI API Key' },
  kimi: { name: 'Moonshot Kimi', icon: Sparkles, color: 'text-fuchsia-400', ph: 'sk-...', label: 'Moonshot API Key' },
  vertex: { name: 'Vertex AI', icon: Triangle, color: 'text-cyan-400', ph: 'AQ... or AIza...', label: 'Vertex AI API Key' },
};

const TIER_STYLES: Record<string, { label: string; color: string; icon: typeof Star }> = {
  free: { label: 'Free', color: 'text-muted-foreground bg-muted/50 border-border', icon: Star },
  pro: { label: 'Pro', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20', icon: Star },
  unlimited: { label: 'Unlimited', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20', icon: Crown },
};

function TierBadge({ tier }: { tier: string }) {
  const s = TIER_STYLES[tier] ?? TIER_STYLES.free;
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border', s.color)}>
      <Icon className="w-2.5 h-2.5" />{s.label}
    </span>
  );
}

function UserRow({ user, onRefresh }: { user: AdminUser; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [creditAmount, setCreditAmount] = useState('50');
  const [creditNote, setCreditNote] = useState('');
  const [tier, setTier] = useState(user.subscription_tier);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleGrant = async (isAdd: boolean) => {
    const amt = parseInt(creditAmount);
    if (!amt || amt <= 0) return;
    setSaving(true); setMsg('');
    try {
      await grantCredits(user.id, isAdd ? amt : -amt, creditNote || (isAdd ? 'Admin grant' : 'Admin deduction'));
      setMsg(isAdd ? `+${amt} credits granted` : `-${amt} credits deducted`);
      setCreditNote('');
      onRefresh();
    } catch { setMsg('Failed to update credits'); }
    setSaving(false);
  };

  const handleTierChange = async (newTier: string) => {
    setSaving(true); setMsg('');
    try {
      await setSubscriptionTier(user.id, newTier);
      setTier(newTier);
      setMsg(`Tier set to ${newTier}`);
      onRefresh();
    } catch { setMsg('Failed to update tier'); }
    setSaving(false);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
          {(user.display_name || user.email).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{user.display_name || 'No name'}</span>
            <TierBadge tier={user.subscription_tier} />
            {user.is_admin && (
              <span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-full">Admin</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground truncate block">{user.email}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-mono font-semibold text-foreground">{user.credit_balance}</div>
            <div className="text-[10px] text-muted-foreground">credits</div>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs text-muted-foreground">{format(new Date(user.created_at), 'MMM d, yyyy')}</div>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <div className="text-xl font-mono font-bold text-foreground">{user.credit_balance}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Balance</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <div className="text-xl font-mono font-bold text-foreground">{user.total_purchased}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">All-time</div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center col-span-2">
              <div className="text-xs font-medium text-foreground mb-1">Tier</div>
              <TierBadge tier={tier} />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Grant / Deduct Credits</Label>
            <div className="flex gap-2 flex-wrap">
              <Input
                type="number"
                min="1"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="Amount"
                className="w-24 font-mono text-sm"
              />
              <Input
                value={creditNote}
                onChange={(e) => setCreditNote(e.target.value)}
                placeholder="Note (optional)"
                className="flex-1 min-w-[120px] text-sm"
              />
              <button
                onClick={() => handleGrant(true)}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-600/30 text-green-400 hover:bg-green-600/30 transition-colors text-xs font-medium disabled:opacity-40"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
              <button
                onClick={() => handleGrant(false)}
                disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-600/30 text-red-400 hover:bg-red-600/30 transition-colors text-xs font-medium disabled:opacity-40"
              >
                <Minus className="w-3 h-3" /> Deduct
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Subscription Tier</Label>
            <div className="flex gap-2 flex-wrap">
              {['free', 'pro', 'unlimited'].map((t) => (
                <button
                  key={t}
                  onClick={() => handleTierChange(t)}
                  disabled={saving}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-40',
                    tier === t
                      ? 'bg-primary/15 border-primary/40 text-primary'
                      : 'border-border bg-muted/20 text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  {t === 'unlimited' && <Crown className="w-3 h-3" />}
                  {t === 'pro' && <Star className="w-3 h-3" />}
                  {t === 'free' && <Gift className="w-3 h-3" />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {msg && (
            <div className={cn('flex items-center gap-2 text-xs p-2 rounded-lg border', msg.includes('Failed') ? 'text-destructive border-destructive/20 bg-destructive/5' : 'text-green-400 border-green-400/20 bg-green-400/5')}>
              {msg.includes('Failed') ? <AlertCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
              {msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const [, setLocation] = useLocation();
  const { user, authDisabled, signOut } = useAuth();
  const queryClient = useQueryClient();
  const authed = !!user?.is_admin;
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  const [provider, setProvider] = useState<P2>('gemini');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [keys, setKeys] = useState<Record<P2, string>>({ gemini: '', anthropic: '', openai: '', vertex: '', kimi: '' });
  const [showKeys, setShowKeys] = useState<Record<P2, boolean>>({ gemini: false, anthropic: false, openai: false, vertex: false, kimi: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const [userSearch, setUserSearch] = useState('');

  const [runnerUrl, setRunnerUrl] = useState('');
  const [runnerSecret, setRunnerSecret] = useState('');
  const [showP, setShowP] = useState(false);
  const [runnerSaving, setRunnerSaving] = useState(false);
  const [runnerSaved, setRunnerSaved] = useState(false);
  const [runnerErr, setRunnerErr] = useState('');
  const [runnerTesting, setRunnerTesting] = useState(false);
  const [runnerTestResult, setRunnerTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: settings } = useQuery({ queryKey: ['admin-settings'], queryFn: getAdminSettings, enabled: authed });
  const { data: stats } = useQuery({ queryKey: ['admin-stats'], queryFn: getAdminStats, enabled: authed });
  const { data: allUsers = [], refetch: refetchUsers, isFetching: loadingUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listAdminUsers,
    enabled: authed && activeTab === 'users',
  });
  const { data: runnerConfig } = useQuery({
    queryKey: ['runner-config'],
    queryFn: getAdminRunnerConfig,
    enabled: authed && activeTab === 'runner',
  });

  useEffect(() => { if (settings) { setProvider(settings.provider as P2); setModel(settings.model); } }, [settings]);
  useEffect(() => { if (runnerConfig) { setRunnerUrl(runnerConfig.runner_url); setRunnerSecret(runnerConfig.runner_secret); } }, [runnerConfig]);

  const filteredUsers = allUsers.filter((u) =>
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.display_name.toLowerCase().includes(userSearch.toLowerCase()),
  );

  if (!authed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground mt-1">This account does not have admin access.</p>
          </div>
          <Card>
            <CardContent className="p-6">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sign in with the first account you created in this Mongo-backed setup, or grant this user admin access in Mongo.
                </p>
                <Button className="w-full" onClick={() => setLocation('/')}>Go Home</Button>
                {!authDisabled && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={async () => {
                      await signOut();
                      setLocation('/auth');
                    }}
                  >
                    Sign Out
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  const isKeySet = (p: P2) => {
    if (!settings) return false;
    if (p === 'gemini') return settings.geminiKeyConfigured;
    if (p === 'anthropic') return settings.anthropicKeyConfigured;
    if (p === 'openai') return settings.openaiKeyConfigured;
    if (p === 'kimi') return settings.kimiKeyConfigured;
    if (p === 'vertex') return settings.vertexKeyConfigured;
    return false;
  };

  const tabs: { id: AdminTab; label: string; icon: typeof Shield }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'ai', label: 'AI Settings', icon: Key },
    { id: 'users', label: 'Users & Credits', icon: Users },
    { id: 'runner', label: 'Runner', icon: Server },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 flex items-center px-6 border-b border-border bg-card">
        <Link href="/">
          <a className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mr-4">
            <Home className="w-4 h-4" /><span className="text-sm">Home</span>
          </a>
        </Link>
        <div className="w-px h-4 bg-border mr-4" />
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Admin Panel</span>
        </div>
        {!authDisabled && (
          <button
            onClick={async () => { await signOut(); setLocation('/auth'); }}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        )}
      </header>

      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex gap-1 mb-6 bg-muted/30 rounded-xl p-1 border border-border">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center',
                  activeTab === tab.id ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'overview' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Platform Stats</h2>
              {stats ? (
                <div className="grid grid-cols-3 gap-4">
                  {([
                    ['Projects', stats.projectCount, 'text-blue-400'],
                    ['Files', stats.fileCount, 'text-green-400'],
                    ['Users', stats.userCount, 'text-amber-400'],
                  ] as [string, number, string][]).map(([l, v, c]) => (
                    <Card key={l}>
                      <CardContent className="p-5">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <BarChart3 className={cn('w-5 h-5', c)} />
                          </div>
                          <div>
                            <p className="text-2xl font-bold font-mono text-foreground">{v}</p>
                            <p className="text-xs text-muted-foreground">{l}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />)}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Credit System</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gift className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Free</span>
                    </div>
                    <p className="text-xs text-muted-foreground">10 credits on signup. Uses platform API. Users can add their own key to bypass.</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-medium text-foreground">Pro</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Custom credit balance. Grant credits from Users tab after payment.</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Crown className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-medium text-foreground">Unlimited</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Bypasses credit check entirely. Infinite platform API usage.</p>
                  </CardContent>
                </Card>
              </div>
              <div className="mt-3 p-3 rounded-lg border border-amber-400/20 bg-amber-400/5 text-xs text-amber-300">
                <strong>How to monetize:</strong> Users without their own API key use your platform key and consume credits. When someone pays you, grant them credits from the Users tab and optionally upgrade their tier.
              </div>
            </div>

            <Separator />

            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">API Keys Status</h2>
              <div className="space-y-2">
                {(['gemini', 'anthropic', 'openai', 'kimi', 'vertex'] as P2[]).map((p) => {
                  const info = PINFO[p];
                  const Icon = info.icon;
                  const ks = isKeySet(p);
                  return (
                    <div key={p} className={cn('flex items-center gap-3 p-3 rounded-lg border', ks ? 'border-green-400/20 bg-green-400/5' : 'border-border bg-card')}>
                      <Icon className={cn('w-4 h-4', info.color)} />
                      <span className="text-sm text-foreground flex-1">{info.name}</span>
                      {ks
                        ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" />Configured</span>
                        : <span className="text-xs text-muted-foreground">Not configured</span>}
                      {provider === p && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">Active</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'ai' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">AI Provider Configuration</h2>
              {settings && (
                <div className={cn('flex items-center gap-2 text-sm mb-4 p-3 rounded-lg border', isKeySet(provider) ? 'text-green-400 bg-green-400/5 border-green-400/20' : 'text-amber-400 bg-amber-400/5 border-amber-400/20')}>
                  {isKeySet(provider) ? <><CheckCircle className="w-4 h-4" />{PINFO[provider].name} API key is configured</> : <><AlertCircle className="w-4 h-4" />No {PINFO[provider].name} API key. Add it below.</>}
                </div>
              )}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2"><Key className="w-4 h-4 text-primary" />AI Settings</CardTitle>
                  <CardDescription>Platform-wide AI provider and API keys. Users without their own key will use these and consume credits.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaving(true); setSaveErr(''); setSaved(false);
                      try {
                        await saveAdminSettings({ provider, model, geminiApiKey: keys.gemini || undefined, anthropicApiKey: keys.anthropic || undefined, openaiApiKey: keys.openai || undefined, vertexApiKey: keys.vertex || undefined, kimiApiKey: keys.kimi || undefined });
                        queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
                        setKeys({ gemini: '', anthropic: '', openai: '', vertex: '', kimi: '' });
                        setSaved(true);
                        setTimeout(() => setSaved(false), 3000);
                      } catch { setSaveErr('Failed to save.'); }
                      setSaving(false);
                    }}
                    className="space-y-5"
                  >
                    <div className="space-y-1.5">
                      <Label>AI Provider</Label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(['gemini', 'anthropic', 'openai', 'kimi', 'vertex'] as P2[]).map((p) => {
                          const info = PINFO[p];
                          const Icon = info.icon;
                          return (
                            <button key={p} type="button" onClick={() => { setProvider(p); setModel(MODELS[p][0].value); }}
                              className={cn('relative flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all', provider === p ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40')}>
                              <Icon className={cn('w-5 h-5', provider === p ? info.color : '')} />
                              <span className="font-medium text-xs text-center leading-tight">{info.name}</span>
                              {isKeySet(p) && <span className="absolute top-1.5 right-1.5"><CheckCircle className="w-3 h-3 text-green-400" /></span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="akey">{PINFO[provider].label}{isKeySet(provider) && <span className="ml-1 text-xs text-muted-foreground font-normal">(leave blank to keep current)</span>}</Label>
                      <div className="relative">
                        <Input id="akey" type={showKeys[provider] ? 'text' : 'password'} value={keys[provider]} onChange={(e) => setKeys({ ...keys, [provider]: e.target.value })} placeholder={isKeySet(provider) ? '••••••••••••••••' : PINFO[provider].ph} className="font-mono pr-10" />
                        <button type="button" onClick={() => setShowKeys({ ...showKeys, [provider]: !showKeys[provider] })} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showKeys[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mdl">Default Model</Label>
                      <Select id="mdl" value={model} onValueChange={setModel}>
                        {MODELS[provider].map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </Select>
                    </div>
                    {saveErr && <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="w-4 h-4" />{saveErr}</div>}
                    {saved && <div className="flex items-center gap-2 text-green-400 text-sm"><CheckCircle className="w-4 h-4" />Settings saved successfully</div>}
                    <Button type="submit" disabled={saving} className="w-full">
                      {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Settings'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {activeTab === 'users' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Users & Credits</h2>
              <button
                onClick={() => refetchUsers()}
                disabled={loadingUsers}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', loadingUsers && 'animate-spin')} /> Refresh
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by email or name..."
                className="pl-9"
              />
            </div>

            {loadingUsers ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                {userSearch ? 'No users match your search.' : 'No users registered yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((u) => (
                  <UserRow key={u.id} user={u} onRefresh={() => refetchUsers()} />
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground text-center">
              {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'} shown
            </div>
          </motion.div>
        )}

        {activeTab === 'runner' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Local Execution Runner</h2>
              <p className="text-xs text-muted-foreground mb-4">Connect a runner server (on your Mac or DigitalOcean droplet) to enable real terminal execution, code running, and package installs.</p>

              <div className="p-3 rounded-lg border border-blue-400/20 bg-blue-400/5 text-xs text-blue-300 mb-4 space-y-1">
                <div className="font-medium text-blue-200 mb-1">Quick Start</div>
                <div>1. On your server: <code className="font-mono bg-black/20 px-1 rounded">node runner/server.js</code></div>
                <div>2. Set <code className="font-mono bg-black/20 px-1 rounded">LUXI_RUNNER_SECRET=yourtoken</code> env var</div>
                <div>3. Enter the URL and same shared secret below, then save</div>
                <div>4. Click "Test Connection" to verify</div>
              </div>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4 text-primary" />Runner Configuration</CardTitle>
                  <CardDescription>Configure where the LUXI runner server is running. Leave blank to disable real execution.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setRunnerSaving(true); setRunnerErr(''); setRunnerSaved(false);
                      try {
                        await saveRunnerConfig(runnerUrl.trim(), runnerSecret.trim());
                        queryClient.invalidateQueries({ queryKey: ['runner-config'] });
                        setRunnerSaved(true);
                        setTimeout(() => setRunnerSaved(false), 3000);
                      } catch { setRunnerErr('Failed to save runner config.'); }
                      setRunnerSaving(false);
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="runner-url">Runner URL</Label>
                      <Input
                        id="runner-url"
                        value={runnerUrl}
                        onChange={(e) => setRunnerUrl(e.target.value)}
                        placeholder="http://localhost:3210 or https://your-droplet.com:3210"
                        className="font-mono text-sm"
                      />
                      <p className="text-[11px] text-muted-foreground">Use ngrok URL for local Mac, or your DigitalOcean droplet IP</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="runner-secret">Runner Secret</Label>
                      <div className="relative">
                        <Input
                          id="runner-secret"
                          type={showP ? 'text' : 'password'}
                          value={runnerSecret}
                          onChange={(e) => setRunnerSecret(e.target.value)}
                          placeholder="Same as LUXI_RUNNER_SECRET env var"
                          className="font-mono text-sm pr-10"
                        />
                        <button type="button" onClick={() => setShowP(!showP)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showP ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {runnerErr && <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="w-4 h-4" />{runnerErr}</div>}
                    {runnerSaved && <div className="flex items-center gap-2 text-green-400 text-sm"><CheckCircle className="w-4 h-4" />Runner config saved</div>}
                    {runnerTestResult && (
                      <div className={cn('flex items-center gap-2 text-sm', runnerTestResult.ok ? 'text-green-400' : 'text-destructive')}>
                        {runnerTestResult.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {runnerTestResult.msg}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button type="submit" disabled={runnerSaving} className="flex-1">
                        {runnerSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Config'}
                      </Button>
                      <button
                        type="button"
                        disabled={!runnerUrl || runnerTesting}
                        onClick={async () => {
                          setRunnerTesting(true); setRunnerTestResult(null);
                          try {
                            const data = await testRunnerConfig(runnerUrl.trim(), runnerSecret.trim());
                            setRunnerTestResult({ ok: true, msg: `Connected! Node ${data.node} on ${data.platform}` });
                          } catch (err) {
                            setRunnerTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Connection failed' });
                          }
                          setRunnerTesting(false);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-muted/30 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-40"
                      >
                        {runnerTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        Test
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>

            <Separator />

            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Runner Capabilities</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: Zap, color: 'text-yellow-400', label: 'Real Command Execution', desc: 'Run any shell command — npm, python, git, make, curl — with actual output streamed back.' },
                  { icon: Cpu, color: 'text-green-400', label: 'Code Execution', desc: 'Execute Python, Node.js, Bash, Ruby, and Go scripts and get the real output.' },
                  { icon: Key, color: 'text-blue-400', label: 'Package Installation', desc: 'Install npm, pip, yarn, or pnpm packages directly on the runner machine.' },
                  { icon: Server, color: 'text-cyan-400', label: 'Local Filesystem', desc: 'Read and write files on the runner machine, sandboxed per project.' },
                ].map(({ icon: Icon, color, label, desc }) => (
                  <div key={label} className="p-3 rounded-lg border border-border bg-card flex gap-3">
                    <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', color)} />
                    <div>
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
