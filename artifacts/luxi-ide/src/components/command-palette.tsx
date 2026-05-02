import { useEffect, useState, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  File,
  FilePlus,
  Save,
  History,
  Github,
  Lock,
  Cog,
  Home as HomeIcon,
  Terminal,
  Play,
  Sparkles,
} from "lucide-react";

export interface PaletteFile {
  id: number;
  name: string;
  path: string;
  language?: string | null;
}

export interface PaletteAction {
  id: string;
  label: string;
  icon: any;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: PaletteFile[];
  onOpenFile: (file: PaletteFile) => void;
  actions: PaletteAction[];
}

export function CommandPalette({ open, onOpenChange, files, onOpenFile, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const sortedFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files.slice(0, 50);
    return files
      .map((f) => {
        const path = f.path.toLowerCase();
        const name = f.name.toLowerCase();
        let score = 0;
        if (name === q) score = 1000;
        else if (name.startsWith(q)) score = 500;
        else if (name.includes(q)) score = 100;
        else if (path.includes(q)) score = 50;
        return { f, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x) => x.f);
  }, [query, files]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command, search files..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem
                key={a.id}
                value={`action ${a.label}`}
                onSelect={() => {
                  onOpenChange(false);
                  setTimeout(() => a.run(), 0);
                }}
              >
                <a.icon className="w-4 h-4 mr-2" />
                <span>{a.label}</span>
                {a.shortcut && (
                  <span className="ml-auto text-xs text-muted-foreground font-mono">{a.shortcut}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sortedFiles.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={query ? "Files" : "Recent files"}>
              {sortedFiles.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`file ${f.path}`}
                  onSelect={() => {
                    onOpenChange(false);
                    onOpenFile(f);
                  }}
                >
                  <File className="w-4 h-4 mr-2 text-muted-foreground" />
                  <span className="font-mono text-sm">{f.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground truncate max-w-[40%]">
                    {f.path}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

// Icons exported so callers can use them when defining actions
export const PaletteIcons = {
  FilePlus,
  Save,
  History,
  Github,
  Lock,
  Cog,
  HomeIcon,
  Terminal,
  Play,
  Sparkles,
};
