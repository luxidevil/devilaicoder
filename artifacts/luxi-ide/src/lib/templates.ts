import { FileText, Atom, Server, Globe, Rocket, Code2, type LucideIcon } from "lucide-react";

export interface ProjectTemplateMeta {
  id: string;
  name: string;
  description: string;
  language: string;
  icon: LucideIcon;
  color: string;
}

export const PROJECT_TEMPLATES: ProjectTemplateMeta[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Empty project. Start from scratch with the agent.",
    language: "typescript",
    icon: FileText,
    color: "text-gray-400",
  },
  {
    id: "vite-react",
    name: "Vite + React",
    description: "Modern React SPA with TypeScript, Vite, and HMR.",
    language: "typescript",
    icon: Atom,
    color: "text-cyan-400",
  },
  {
    id: "express-ts",
    name: "Express + TS",
    description: "REST API server with Express, TypeScript, tsx watch.",
    language: "typescript",
    icon: Server,
    color: "text-emerald-400",
  },
  {
    id: "flask-python",
    name: "Flask (Python)",
    description: "Minimal Flask web app with health route.",
    language: "python",
    icon: Code2,
    color: "text-yellow-400",
  },
  {
    id: "static-html",
    name: "Static HTML",
    description: "Plain HTML, CSS, and JavaScript. No build step.",
    language: "html",
    icon: Globe,
    color: "text-orange-400",
  },
  {
    id: "nextjs",
    name: "Next.js",
    description: "Full-stack React framework with the App Router.",
    language: "typescript",
    icon: Rocket,
    color: "text-purple-400",
  },
];
