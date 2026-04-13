import { Link } from "wouter";
import { Code2, Settings } from "lucide-react";

export function Navbar() {
  return (
    <header className="h-14 border-b border-border bg-background flex items-center justify-between px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2 text-primary font-bold tracking-tight">
        <Code2 className="w-5 h-5" />
        <span className="text-foreground">LUXI</span>
      </Link>
      
      <nav className="flex items-center gap-4">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors flex items-center gap-1">
          <Settings className="w-4 h-4" />
          Admin
        </Link>
      </nav>
    </header>
  );
}
