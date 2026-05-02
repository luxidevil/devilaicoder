import { useState, useEffect } from 'react';
import { X, Key, CheckCircle, Eye, EyeOff, Sparkles, Cpu, Zap, Triangle, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AIProvider, UserKeys } from '../../types';

const PROVIDER_INFO: Record<AIProvider, { name: string; icon: typeof Sparkles; color: string; placeholder: string; link: string }> = {
  gemini: { name: 'Google Gemini', icon: Sparkles, color: 'text-blue-400', placeholder: 'AIza...', link: 'https://aistudio.google.com' },
  anthropic: { name: 'Anthropic Claude', icon: Cpu, color: 'text-orange-400', placeholder: 'sk-ant-...', link: 'https://console.anthropic.com' },
  openai: { name: 'OpenAI', icon: Zap, color: 'text-green-400', placeholder: 'sk-...', link: 'https://platform.openai.com' },
  kimi: { name: 'Moonshot Kimi', icon: Sparkles, color: 'text-fuchsia-400', placeholder: 'sk-...', link: 'https://platform.moonshot.ai/docs/overview' },
  vertex: { name: 'Vertex AI', icon: Triangle, color: 'text-cyan-400', placeholder: 'AQ... or AIza...', link: 'https://console.cloud.google.com/vertex-ai' },
};

const MODELS: Record<AIProvider, { value: string; label: string; group?: string }[]> = {
  gemini: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'Gemini 2.5' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'Gemini 2.5' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', group: 'Gemini 2.5' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', group: 'Gemini 2.0' },
    { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', group: 'Gemini 2.0' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', group: 'Gemini 1.5' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', group: 'Gemini 1.5' },
    { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B', group: 'Gemini 1.5' },
  ],
  anthropic: [
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5', group: 'Claude 4' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', group: 'Claude 4' },
    { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', group: 'Claude 3.7' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', group: 'Claude 3.5' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', group: 'Claude 3.5' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus', group: 'Claude 3' },
  ],
  openai: [
    { value: 'o3', label: 'o3', group: 'Reasoning' },
    { value: 'o3-mini', label: 'o3 Mini', group: 'Reasoning' },
    { value: 'o1', label: 'o1', group: 'Reasoning' },
    { value: 'o1-mini', label: 'o1 Mini', group: 'Reasoning' },
    { value: 'gpt-4.1', label: 'GPT-4.1', group: 'GPT-4' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', group: 'GPT-4' },
    { value: 'gpt-4o', label: 'GPT-4o', group: 'GPT-4' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', group: 'GPT-4' },
  ],
  kimi: [
    { value: 'kimi-k2.5', label: 'Kimi K2.5', group: 'Kimi K2.5' },
    { value: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', group: 'Kimi K2' },
    { value: 'kimi-k2-thinking-turbo', label: 'Kimi K2 Thinking Turbo', group: 'Kimi K2' },
    { value: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo Preview', group: 'Kimi K2' },
  ],
  vertex: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'Gemini 2.5' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'Gemini 2.5' },
    { value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro Preview', group: 'Gemini 2.5' },
    { value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash Preview', group: 'Gemini 2.5' },
    { value: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite', group: 'Gemini 2.5' },
    { value: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', group: 'Gemini 2.0' },
    { value: 'gemini-2.0-flash-lite-001', label: 'Gemini 2.0 Flash Lite', group: 'Gemini 2.0' },
    { value: 'gemini-2.0-pro-exp-02-05', label: 'Gemini 2.0 Pro Exp', group: 'Gemini 2.0' },
    { value: 'gemini-1.5-pro-002', label: 'Gemini 1.5 Pro', group: 'Gemini 1.5' },
    { value: 'gemini-1.5-flash-002', label: 'Gemini 1.5 Flash', group: 'Gemini 1.5' },
    { value: 'claude-opus-4@20250514', label: 'Claude Opus 4 (Vertex)', group: 'Anthropic' },
    { value: 'claude-sonnet-4@20250514', label: 'Claude Sonnet 4 (Vertex)', group: 'Anthropic' },
    { value: 'claude-3-5-sonnet-v2@20241022', label: 'Claude 3.5 Sonnet (Vertex)', group: 'Anthropic' },
    { value: 'claude-3-5-haiku@20241022', label: 'Claude 3.5 Haiku (Vertex)', group: 'Anthropic' },
    { value: 'meta/llama-3.3-70b-instruct-maas', label: 'Llama 3.3 70B', group: 'Meta Llama' },
    { value: 'meta/llama-3.1-405b-instruct-maas', label: 'Llama 3.1 405B', group: 'Meta Llama' },
    { value: 'mistral-large@2411', label: 'Mistral Large', group: 'Mistral' },
    { value: 'mistral-nemo@2407', label: 'Mistral Nemo', group: 'Mistral' },
  ],
};

const STORAGE_KEY = 'luxi_user_keys';

export function loadUserKeys(): UserKeys | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserKeys) : null;
  } catch {
    return null;
  }
}

function saveUserKeys(keys: UserKeys) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

interface Props {
  onClose: () => void;
}

export function UserKeysModal({ onClose }: Props) {
  const saved = loadUserKeys();
  const [provider, setProvider] = useState<AIProvider>(saved?.provider ?? 'gemini');
  const [model, setModel] = useState(saved?.model ?? 'gemini-2.5-flash');
  const [keys, setKeys] = useState({
    gemini: saved?.gemini_key ?? '',
    anthropic: saved?.anthropic_key ?? '',
    openai: saved?.openai_key ?? '',
    kimi: saved?.kimi_key ?? '',
    vertex: saved?.vertex_key ?? '',
  });
  const [showKey, setShowKey] = useState(false);
  const [saved2, setSaved2] = useState(false);

  useEffect(() => {
    setModel(MODELS[provider][0].value);
  }, [provider]);

  const handleSave = () => {
    const userKeys: UserKeys = {
      provider,
      model,
      gemini_key: keys.gemini || undefined,
      anthropic_key: keys.anthropic || undefined,
      openai_key: keys.openai || undefined,
      kimi_key: keys.kimi || undefined,
      vertex_key: keys.vertex || undefined,
    };
    saveUserKeys(userKeys);
    setSaved2(true);
    setTimeout(() => { setSaved2(false); onClose(); }, 900);
  };

  const hasKey = (p: AIProvider) => {
    if (p === 'gemini') return !!keys.gemini;
    if (p === 'anthropic') return !!keys.anthropic;
    if (p === 'openai') return !!keys.openai;
    if (p === 'kimi') return !!keys.kimi;
    if (p === 'vertex') return !!keys.vertex;
    return false;
  };

  const currentKey = keys[provider];
  const info = PROVIDER_INFO[provider];
  const Icon = info.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">AI Provider & API Key</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Select Provider</p>
            <div className="grid grid-cols-2 gap-2">
              {(['gemini', 'anthropic', 'openai', 'kimi', 'vertex'] as AIProvider[]).map((p) => {
                const pi = PROVIDER_INFO[p];
                const PI = pi.icon;
                return (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={cn(
                      'relative flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all',
                      provider === p ? 'border-primary bg-primary/8 text-foreground' : 'border-border bg-muted/20 text-muted-foreground hover:border-border/80',
                    )}
                  >
                    <PI className={cn('w-4 h-4 flex-shrink-0', provider === p ? pi.color : '')} />
                    <span className="text-xs font-medium leading-tight">{pi.name}</span>
                    {hasKey(p) && (
                      <span className="absolute top-1.5 right-1.5">
                        <CheckCircle className="w-3 h-3 text-green-400" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{info.name} API Key</p>
              <a href={info.link} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">Get key</a>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={currentKey}
                onChange={(e) => setKeys({ ...keys, [provider]: e.target.value })}
                placeholder={info.placeholder}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {provider === 'vertex' && (
              <p className="text-[11px] text-muted-foreground">Enable Vertex AI API in Google Cloud Console first, then create an API key.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Model</p>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none pr-8"
              >
                {MODELS[provider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div className="pt-1 space-y-2">
            <button
              onClick={handleSave}
              className={cn(
                'w-full py-2.5 rounded-lg text-sm font-medium transition-all',
                saved2
                  ? 'bg-green-600 text-white'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {saved2 ? 'Saved!' : 'Save & Use This Key'}
            </button>
            <p className="text-[11px] text-center text-muted-foreground/60">
              Keys are stored locally in your browser only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
