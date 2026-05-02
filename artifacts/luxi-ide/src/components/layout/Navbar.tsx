import { Link, useLocation } from "wouter";
import { Sparkles, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border/60 glass-strong flex items-center justify-between px-4 sm:px-6">
      <Link href="/" className="group flex items-center gap-2.5" data-testid="link-home">
        <span className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-brand glow-brand-sm">
          <Sparkles className="w-4 h-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
          <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-white/20" />
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold tracking-tight text-gradient-brand">LUXI</span>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/80 group-hover:text-foreground/80 transition-colors">
            ide
          </span>
        </span>
      </Link>

      <nav className="flex items-center gap-1.5">
        <Link
          href="/admin"
          aria-label="Admin"
          className={cn(
            "text-sm font-medium transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-md border",
            isAdmin
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
          data-testid="link-admin"
        >
          <BarChart3 className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Admin</span>
        </Link>
      </nav>
    </header>
  );
}
