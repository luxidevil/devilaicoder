import { useState } from 'react';
import { Rocket, ExternalLink, Loader2, CheckCircle, AlertCircle, Globe, Github } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ProjectFile } from '../../types';
import { exportProjectAsZip } from '../../lib/exportZip';
import { syncProjectFilesToRunner, projectRunnerJson } from '../../lib/runner';

interface Props {
  projectId: number;
  projectName: string;
  files: ProjectFile[];
  runnerUrl: string;
}

interface DeployResult {
  ok: boolean;
  url?: string;
  logs: string;
  provider: string;
}

async function runOnRunner(projectId: number, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return projectRunnerJson(projectId, 'run', { command, timeout: 120000 });
}

const PROVIDERS = [
  {
    id: 'netlify',
    label: 'Netlify',
    icon: Globe,
    color: 'text-teal-400',
    border: 'border-teal-400/30',
    bg: 'bg-teal-400/5',
    desc: 'Deploy via Netlify CLI (requires NETLIFY_AUTH_TOKEN secret)',
    envKey: 'NETLIFY_AUTH_TOKEN',
  },
  {
    id: 'vercel',
    label: 'Vercel',
    icon: Github,
    color: 'text-white',
    border: 'border-white/20',
    bg: 'bg-white/5',
    desc: 'Deploy via Vercel CLI (requires VERCEL_TOKEN secret)',
    envKey: 'VERCEL_TOKEN',
  },
] as const;

export function DeployPanel({ projectId, projectName, files, runnerUrl }: Props) {
  const [selected, setSelected] = useState<'netlify' | 'vercel' | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [buildDir, setBuildDir] = useState('dist');
  const [buildCmd, setBuildCmd] = useState('npm run build');

  const notConnected = !runnerUrl;

  const handleDownloadZip = () => {
    exportProjectAsZip(projectName, files);
  };

  const handleDeploy = async () => {
    if (!selected || !runnerUrl) return;
    setDeploying(true); setResult(null);

    try {
      await syncProjectFilesToRunner(projectId, files);

      if (buildCmd.trim()) {
        const buildRes = await runOnRunner(projectId, buildCmd);
        if (buildRes.exitCode !== 0) {
          setResult({ ok: false, logs: buildRes.stderr || buildRes.stdout, provider: selected });
          setDeploying(false);
          return;
        }
      }

      let cmd = '';
      if (selected === 'netlify') {
        cmd = `npx netlify-cli deploy --dir=${buildDir} --prod --auth "$NETLIFY_AUTH_TOKEN" --json`;
      } else {
        cmd = `npx vercel "${buildDir}" --yes`;
      }

      const deployRes = await runOnRunner(projectId, cmd);
      const combined = (deployRes.stdout + '\n' + deployRes.stderr).trim();

      let deployUrl: string | undefined;
      const urlMatch = combined.match(/https:\/\/[a-z0-9-]+\.(netlify\.app|vercel\.app)[^\s]*/i);
      if (urlMatch) deployUrl = urlMatch[0];

      if (deployRes.exitCode === 0 || deployUrl) {
        setResult({ ok: true, url: deployUrl, logs: combined, provider: selected });
      } else {
        setResult({ ok: false, logs: combined, provider: selected });
      }
    } catch (err: unknown) {
      setResult({ ok: false, logs: err instanceof Error ? err.message : 'Deploy failed', provider: selected ?? '' });
    }

    setDeploying(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <Rocket className="w-3.5 h-3.5 text-primary" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Deploy</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Export</p>
          <button
            onClick={handleDownloadZip}
            disabled={files.length === 0}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 transition-colors disabled:opacity-40 text-left"
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0" />
            <div>
              <div className="text-[12px] font-medium">Download as ZIP</div>
              <div className="text-[10px] text-muted-foreground/60">{files.length} files</div>
            </div>
          </button>
        </div>

        {notConnected ? (
          <div className="p-3 rounded-lg border border-border bg-card text-center">
            <p className="text-[11px] text-muted-foreground">Connect a runner to enable one-click deploy to Netlify / Vercel</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">One-click Deploy</p>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelected(selected === p.id ? null : p.id)}
                      className={cn(
                        'flex flex-col items-start gap-1 p-3 rounded-lg border transition-all text-left',
                        selected === p.id
                          ? `${p.border} ${p.bg} ${p.color}`
                          : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5" />
                        <span className="text-[12px] font-medium">{p.label}</span>
                      </div>
                      <span className="text-[10px] leading-3 opacity-70">{p.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selected && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Build Command</label>
                    <input
                      value={buildCmd}
                      onChange={(e) => setBuildCmd(e.target.value)}
                      placeholder="npm run build"
                      className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Output Dir</label>
                    <input
                      value={buildDir}
                      onChange={(e) => setBuildDir(e.target.value)}
                      placeholder="dist"
                      className="w-full rounded border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                      spellCheck={false}
                    />
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground/60 p-2 rounded border border-border/40 bg-muted/10">
                  Make sure <span className="font-mono text-foreground/60">
                    {PROVIDERS.find((p) => p.id === selected)?.envKey}
                  </span> is set in your Secrets &amp; Env tab and synced to the runner.
                </div>

                <button
                  onClick={handleDeploy}
                  disabled={deploying}
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {deploying
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Deploying...</>
                    : <><Rocket className="w-4 h-4" /> Deploy to {selected === 'netlify' ? 'Netlify' : 'Vercel'}</>}
                </button>
              </div>
            )}

            {result && (
              <div className={cn(
                'space-y-2 p-3 rounded-lg border',
                result.ok ? 'border-green-400/20 bg-green-400/5' : 'border-destructive/20 bg-destructive/5',
              )}>
                <div className={cn('flex items-center gap-2 text-sm font-medium', result.ok ? 'text-green-400' : 'text-destructive')}>
                  {result.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {result.ok ? 'Deploy successful!' : 'Deploy failed'}
                </div>
                {result.url && (
                  <a href={result.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-green-400 hover:underline font-mono truncate">
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    {result.url}
                  </a>
                )}
                {result.logs && (
                  <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto bg-black/20 p-2 rounded">
                    {result.logs.slice(0, 2000)}
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
