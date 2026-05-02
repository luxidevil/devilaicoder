import { useState, useEffect } from 'react';
import { Lock, Plus, Trash2, Eye, EyeOff, Save, Upload, CheckCircle, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import { cn } from '../../lib/utils';
import { loadProjectSecrets, saveProjectSecrets } from '../../lib/api';
import { projectRunnerJson } from '../../lib/runner';

interface Secret { key: string; value: string; show: boolean; }

interface Props {
  projectId: number;
  runnerUrl: string;
}

async function loadFromDB(projectId: number): Promise<Secret[]> {
  const parsed = await loadProjectSecrets(projectId);
  return parsed.map((s) => ({ ...s, show: false }));
}

async function saveToDB(projectId: number, secrets: Secret[]): Promise<void> {
  const rows = secrets.map(({ key, value }) => ({ key, value }));
  await saveProjectSecrets(projectId, rows);
}

export function SecretsPanel({ projectId, runnerUrl }: Props) {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  useEffect(() => {
    setLoading(true);
    loadFromDB(projectId).then((s) => { setSecrets(s); setLoading(false); });
  }, [projectId]);

  const addSecret = () => {
    const k = newKey.trim().toUpperCase().replace(/\s+/g, '_');
    if (!k) return;
    setSecrets((prev) => {
      const existing = prev.findIndex((s) => s.key === k);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], value: newVal };
        return updated;
      }
      return [...prev, { key: k, value: newVal, show: false }];
    });
    setNewKey(''); setNewVal('');
  };

  const removeSecret = (idx: number) => {
    setSecrets((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleShow = (idx: number) => {
    setSecrets((prev) => prev.map((s, i) => i === idx ? { ...s, show: !s.show } : s));
  };

  const updateSecret = (idx: number, field: 'key' | 'value', val: string) => {
    setSecrets((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  };

  const handleSave = async () => {
    setSaving(true);
    await saveToDB(projectId, secrets);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSyncToRunner = async () => {
    if (!runnerUrl) { setSyncMsg({ ok: false, text: 'Runner not connected' }); return; }
    setSyncing(true); setSyncMsg(null);
    try {
      const envContent = secrets
        .filter((s) => s.key.trim())
        .map((s) => `${s.key}=${s.value}`)
        .join('\n') + '\n';

      await projectRunnerJson(projectId, 'write', {
        filePath: '.env',
        content: envContent,
      });
      setSyncMsg({ ok: true, text: `.env written to runner (${secrets.length} vars)` });
    } catch (err: unknown) {
      setSyncMsg({ ok: false, text: err instanceof Error ? err.message : 'Sync failed' });
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 4000);
  };

  const envPreview = secrets.filter((s) => s.key.trim()).map((s) => `${s.key}=***`).join('\n');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Secrets & Env</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saved ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={handleSyncToRunner}
            disabled={syncing || !runnerUrl}
            title={runnerUrl ? 'Write .env to runner' : 'Runner not connected'}
            className={cn(
              'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors disabled:opacity-40',
              runnerUrl
                ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                : 'border-border bg-muted/20 text-muted-foreground cursor-not-allowed',
            )}
          >
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            Sync to Runner
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 text-[11px] border-b border-border',
          syncMsg.ok ? 'text-green-400 bg-green-400/5' : 'text-red-400 bg-red-400/5',
        )}>
          {syncMsg.ok ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
          {syncMsg.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <KeyRound className="w-8 h-8 text-muted-foreground/20 mb-3" />
            <p className="text-xs text-muted-foreground">No secrets yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 max-w-[200px]">
              Add environment variables and click "Sync to Runner" to write a .env file
            </p>
          </div>
        ) : (
          secrets.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 group">
              <input
                value={s.key}
                onChange={(e) => updateSecret(i, 'key', e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                placeholder="KEY_NAME"
                className="w-32 flex-shrink-0 rounded border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
              <span className="text-muted-foreground/50 text-[11px]">=</span>
              <div className="relative flex-1">
                <input
                  type={s.show ? 'text' : 'password'}
                  value={s.value}
                  onChange={(e) => updateSecret(i, 'value', e.target.value)}
                  placeholder="value"
                  className="w-full rounded border border-border bg-input px-2 py-1 pr-7 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  spellCheck={false}
                />
                <button
                  onClick={() => toggleShow(i)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  {s.show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <button
                onClick={() => removeSecret(i)}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-destructive transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}

        <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
            onKeyDown={(e) => { if (e.key === 'Enter') addSecret(); }}
            placeholder="NEW_KEY"
            className="w-32 flex-shrink-0 rounded border border-dashed border-border/60 bg-input/50 px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary focus:border-solid"
            spellCheck={false}
          />
          <span className="text-muted-foreground/30 text-[11px]">=</span>
          <input
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addSecret(); }}
            placeholder="value"
            className="flex-1 rounded border border-dashed border-border/60 bg-input/50 px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary focus:border-solid"
            spellCheck={false}
          />
          <button
            onClick={addSecret}
            disabled={!newKey.trim()}
            className="text-primary/70 hover:text-primary disabled:opacity-30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {secrets.length > 0 && (
          <div className="mt-3 p-2 rounded border border-border/40 bg-muted/10">
            <p className="text-[10px] text-muted-foreground/50 font-mono whitespace-pre">{envPreview || '(empty)'}</p>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border/40 flex-shrink-0">
        <p className="text-[10px] text-muted-foreground/50 leading-4">
          Secrets are stored encrypted in the database. "Sync to Runner" writes a .env file to the runner's project sandbox.
        </p>
      </div>
    </div>
  );
}
