import { Navbar } from "@/components/layout/Navbar";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Plus, Terminal, ArrowRight, Check, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { PROJECT_TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";

export default function Home() {
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("blank");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
    const language = template?.language ?? "typescript";

    createProject.mutate(
      { data: { name, description, language, template: templateId } as any },
      {
        onSuccess: (newProject) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setOpen(false);
          setLocation(`/projects/${newProject.id}`);
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-mesh selection:bg-primary/30 relative">
      <div className="pointer-events-none absolute inset-x-0 top-14 h-[420px] grid-pattern opacity-60" />
      <Navbar />

      <main className="relative flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <section className="relative mb-10 mt-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-[11px] font-medium mb-4">
            <Sparkles className="w-3 h-3" />
            <span>AI-native coding workspace</span>
          </div>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div className="max-w-2xl">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Your <span className="text-gradient-brand">Projects</span>
              </h1>
              <p className="text-muted-foreground text-base mt-2 leading-relaxed">
                Pick a workspace to keep building, or spin up a new one. Your AI agent reads, writes,
                runs, and ships — all from a single chat.
              </p>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <button
                  data-testid="button-new-project"
                  className="btn-brand inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg font-semibold text-sm"
                >
                  <Plus className="w-4 h-4" />
                  New Project
                </button>
              </DialogTrigger>
            <DialogContent className="sm:max-w-[640px]">
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Create new project</DialogTitle>
                  <DialogDescription>
                    Pick a starter template or start blank — the AI agent helps either way.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4 mt-2">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Project Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g. My Awesome App"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      data-testid="input-project-name"
                      autoFocus
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">Description (optional)</Label>
                    <Input
                      id="description"
                      placeholder="Brief description of your project"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      data-testid="input-project-description"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Template</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {PROJECT_TEMPLATES.map((t) => {
                        const Icon = t.icon;
                        const selected = templateId === t.id;
                        return (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => setTemplateId(t.id)}
                            className={cn(
                              "relative text-left rounded-lg border p-3 transition-all hover:border-primary/60",
                              selected
                                ? "border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)]"
                                : "border-border bg-card/40"
                            )}
                            data-testid={`template-${t.id}`}
                          >
                            {selected && (
                              <Check className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-primary" />
                            )}
                            <Icon className={cn("w-5 h-5 mb-1.5", t.color)} />
                            <div className="text-sm font-medium">{t.name}</div>
                            <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                              {t.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createProject.isPending || !name.trim()} data-testid="button-submit-project">
                    {createProject.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          </div>
        </section>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="bg-card border-border">
                <CardHeader>
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-4 w-1/3" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((project, idx) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.35 }}
              >
                <Link href={`/projects/${project.id}`}>
                  <Card
                    className="card-glow h-full cursor-pointer group bg-card/80 border-border/70 backdrop-blur-sm overflow-hidden relative"
                    data-testid={`card-project-${project.id}`}
                  >
                    <div className="pointer-events-none absolute -top-px left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-lg flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0">
                            <Terminal className="w-3.5 h-3.5" />
                          </span>
                          <span className="truncate group-hover:text-gradient-brand transition-colors">
                            {project.name}
                          </span>
                        </CardTitle>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-mono uppercase tracking-wider border border-border/60 shrink-0">
                          {project.language}
                        </span>
                      </div>
                      <CardDescription className="line-clamp-2 min-h-[2.5rem] mt-2">
                        {project.description || "No description provided."}
                      </CardDescription>
                    </CardHeader>
                    <CardFooter className="text-xs text-muted-foreground pt-4 flex items-center justify-between border-t border-border/50">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                        Updated {format(new Date(project.updatedAt), "MMM d, yyyy")}
                      </span>
                      <span className="inline-flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 translate-x-[-4px] group-hover:translate-x-0 transition-all">
                        Open <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </CardFooter>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="relative flex flex-col items-center justify-center py-24 text-center rounded-2xl glass overflow-hidden">
            <div className="pointer-events-none absolute inset-0 grid-pattern opacity-40" />
            <div className="relative w-20 h-20 rounded-2xl bg-gradient-brand glow-brand flex items-center justify-center mb-6 animate-float-soft">
              <Zap className="w-9 h-9 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]" />
            </div>
            <h2 className="relative text-2xl font-semibold mb-2 tracking-tight">
              Welcome to <span className="text-gradient-brand">LUXI</span>
            </h2>
            <p className="relative text-muted-foreground max-w-md mb-8 leading-relaxed">
              Your AI coding partner. Spin up a project and tell the agent what to build —
              it reads, writes, runs, and ships.
            </p>
            <button
              onClick={() => setOpen(true)}
              className="btn-brand inline-flex items-center justify-center gap-2 h-11 px-6 rounded-lg font-semibold text-sm"
            >
              <Plus className="w-4 h-4" />
              Create First Project
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
