import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Plus, Terminal, Code2, ArrowRight, Trash2, Zap, Settings, Sparkles, ChevronRight, Clock, LogOut, Github } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, Input, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Label, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, SelectItem, Skeleton } from '../components/ui/index';
import { listProjects, createProject, deleteProject, createFile } from '../lib/api';
import { PROJECT_TEMPLATES } from '../lib/templates';
import { cn } from '../lib/utils';
import type { Project } from '../types';

const PROMPT_BOOT_STORAGE_PREFIX = 'luxi_boot_prompt:';

const LANGUAGES = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'other', label: 'Other' },
];

const LANG_COLORS: Record<string, string> = {
  typescript: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  javascript: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  python: 'bg-green-500/15 text-green-400 border-green-500/20',
  rust: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  go: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
};

function langBadge(lang: string) {
  return LANG_COLORS[lang] ?? 'bg-muted/50 text-muted-foreground border-border';
}

function buildProjectNameFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .replace(/^[^a-z0-9]+/i, '')
    .trim();

  if (!cleaned) return 'Untitled Project';

  const withoutLeadVerb = cleaned.replace(/^(build|create|make|generate|design|develop|scaffold|fix)\s+/i, '');
  const words = withoutLeadVerb
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  if (words.length === 0) return 'Untitled Project';

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function Home() {
  const { user, authDisabled, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('typescript');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [creatingFromPrompt, setCreatingFromPrompt] = useState(false);

  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: listProjects });

  const createMutation = useMutation({
    mutationFn: createProject,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); setDeleteId(null); },
  });

  const finishProjectSetup = async (project: Project, templateId: string | null, bootPrompt?: string) => {
    const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      await Promise.all(
        template.files.map((f) =>
          createFile(project.id, {
            name: f.path.split('/').pop() || f.path,
            path: f.path,
            content: f.content,
            language: f.path.split('.').pop() === 'ts' || f.path.split('.').pop() === 'tsx' ? 'typescript' : f.path.split('.').pop() === 'py' ? 'python' : 'javascript',
          }),
        ),
      );
    }

    if (bootPrompt?.trim()) {
      try {
        sessionStorage.setItem(`${PROMPT_BOOT_STORAGE_PREFIX}${project.id}`, bootPrompt.trim());
      } catch {}
    }

    queryClient.invalidateQueries({ queryKey: ['projects'] });
    setOpen(false);
    setName('');
    setDescription('');
    setSelectedTemplate(null);
    const projectUrl = bootPrompt?.trim()
      ? `/projects/${project.id}?prompt=${encodeURIComponent(bootPrompt.trim())}`
      : `/projects/${project.id}`;
    setLocation(projectUrl);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    const lang = selectedTemplate ? (PROJECT_TEMPLATES.find((t) => t.id === selectedTemplate)?.language ?? language) : language;
    try {
      const project = await createMutation.mutateAsync({ name: name.trim(), description: description.trim(), language: lang });
      await finishProjectSetup(project, selectedTemplate);
    } finally {
      setCreating(false);
    }
  };

  const handlePromptCreate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setCreatingFromPrompt(true);
    try {
      setPrompt('');
      const project = await createMutation.mutateAsync({
        name: buildProjectNameFromPrompt(trimmedPrompt),
        description: trimmedPrompt.slice(0, 140),
        language: 'typescript',
      });
      await finishProjectSetup(project, null, trimmedPrompt);
    } finally {
      setCreatingFromPrompt(false);
    }
  };

  const openWithTemplate = (templateId: string) => {
    const t = PROJECT_TEMPLATES.find((tpl) => tpl.id === templateId);
    if (!t) return;
    setSelectedTemplate(templateId);
    setLanguage(t.language);
    setName('');
    setOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-12 flex items-center px-6 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="font-bold text-base text-foreground tracking-tight">LUXI IDE</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[160px]">{user.email}</span>
          )}
          <Link href="/admin">
            <a className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <Settings className="w-4 h-4" />
            </a>
          </Link>
          {!authDisabled && (
            <button
              onClick={async () => { await signOut(); setLocation('/auth'); }}
              className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 lg:px-8 space-y-10">
        <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-card overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">Prompt First</span>
            </div>
            <CardTitle className="text-2xl">Start with one prompt</CardTitle>
            <CardDescription className="max-w-2xl">
              Type what you want to build. LUXI will create a fresh blank project, open the IDE, and send the prompt to the agent automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handlePromptCreate();
                }
              }}
              placeholder="Build a full-stack research dashboard with auth, file upload, and AI summaries..."
              rows={5}
              className="w-full rounded-xl border border-border bg-background/80 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary resize-none transition-colors"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => { void handlePromptCreate(); }} disabled={creatingFromPrompt || !prompt.trim()}>
                <Sparkles className="w-4 h-4 mr-2" />
                {creatingFromPrompt ? 'Creating Workspace...' : 'Build With AI'}
              </Button>
              <Button variant="outline" onClick={() => { setSelectedTemplate(null); setOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" /> Blank Project
              </Button>
              <span className="text-xs text-muted-foreground">
                Tip: press `Ctrl/Cmd + Enter` to launch the build.
              </span>
            </div>
          </CardContent>
        </Card>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary/70" />
            <h2 className="text-sm font-semibold text-foreground">Start from a template</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {PROJECT_TEMPLATES.map((t) => (
              <motion.button
                key={t.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openWithTemplate(t.id)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-all text-center group"
              >
                <span className="text-2xl">{t.icon}</span>
                <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{t.name}</span>
                <span className="text-[10px] text-muted-foreground/60 leading-tight">{t.description.split(',')[0]}</span>
              </motion.button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-muted-foreground/60" />
            <h2 className="text-sm font-semibold text-foreground">Saved Projects</h2>
            {projects && projects.length > 0 && (
              <span className="text-xs text-muted-foreground/50 font-mono">{projects.length}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            These are existing workspaces already saved in your account. Use the prompt box above when you want a fresh blank build.
          </p>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader><Skeleton className="h-5 w-3/4 mb-2" /><Skeleton className="h-4 w-1/2" /></CardHeader>
                  <CardContent><Skeleton className="h-4 w-full" /></CardContent>
                </Card>
              ))}
            </div>
          ) : projects && projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project: Project, idx: number) => (
                <motion.div key={project.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }} className="relative group">
                  <Link href={`/projects/${project.id}`}>
                    <a>
                      <Card className="h-full hover:border-primary/50 transition-all cursor-pointer hover:shadow-lg hover:shadow-primary/5">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="text-base group-hover:text-primary transition-colors flex items-center gap-2 min-w-0">
                              <Terminal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <span className="truncate">{project.name}</span>
                            </CardTitle>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {project.repo_url && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                                  <Github className="w-2.5 h-2.5" />
                                  Repo
                                </span>
                              )}
                              <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-mono border', langBadge(project.language))}>
                                {project.language}
                              </span>
                            </div>
                          </div>
                          <CardDescription className="line-clamp-2 min-h-[2.5rem] mt-1">
                            {project.description || 'No description provided.'}
                          </CardDescription>
                        </CardHeader>
                        <CardFooter className="text-xs text-muted-foreground pt-3 flex items-center justify-between border-t border-border/50">
                          <span>Updated {format(new Date(project.updated_at), 'MMM d, yyyy')}</span>
                          <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </CardFooter>
                      </Card>
                    </a>
                  </Link>
                  <button
                    onClick={(e) => { e.preventDefault(); setDeleteId(project.id); }}
                    className="absolute top-3 right-8 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl bg-card/20">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-5">
                <Code2 className="w-7 h-7 text-primary" />
              </div>
              <h2 className="text-lg font-semibold mb-2 text-foreground">No projects yet</h2>
              <p className="text-muted-foreground max-w-sm mb-6 text-sm">Pick a template above or create a blank project to get started.</p>
              <Button onClick={() => { setSelectedTemplate(null); setOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" />Create First Project
              </Button>
            </div>
          )}
        </div>
      </main>

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setSelectedTemplate(null); } }}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>
                {selectedTemplate ? `New ${PROJECT_TEMPLATES.find((t) => t.id === selectedTemplate)?.name} Project` : 'New Project'}
              </DialogTitle>
              <DialogDescription>
                {selectedTemplate
                  ? `Starting with ${PROJECT_TEMPLATES.find((t) => t.id === selectedTemplate)?.description}`
                  : 'Set up a new AI-powered coding workspace.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 mt-2">
              {selectedTemplate && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-xl">{PROJECT_TEMPLATES.find((t) => t.id === selectedTemplate)?.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{PROJECT_TEMPLATES.find((t) => t.id === selectedTemplate)?.name}</p>
                    <p className="text-xs text-muted-foreground">{PROJECT_TEMPLATES.find((t) => t.id === selectedTemplate)?.files.length} files will be created</p>
                  </div>
                  <button type="button" onClick={() => setSelectedTemplate(null)} className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Clear
                  </button>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="proj-name">Project Name</Label>
                <Input id="proj-name" placeholder="e.g. My Awesome App" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proj-desc">Description (optional)</Label>
                <Input id="proj-desc" placeholder="Brief description" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              {!selectedTemplate && (
                <div className="grid gap-2">
                  <Label htmlFor="proj-lang">Language</Label>
                  <Select id="proj-lang" value={language} onValueChange={setLanguage}>
                    {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setSelectedTemplate(null); }}>Cancel</Button>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? 'Creating...' : 'Create Project'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>This permanently deletes the project and all its files. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
