import { spawn, type ChildProcess } from "child_process";

export interface ManagedProc {
  proc: ChildProcess;
  output: string[];
  projectId: number;
  name: string;
  command: string;
  cwd: string;
  startedAt: number;
  port?: number;
  exitCode: number | null;
}

const MAX_BUFFER_LINES = 500;
const procs = new Map<string, ManagedProc>();

export function procKey(projectId: number, name: string): string {
  return `${projectId}:${name}`;
}

export function isAlive(entry: ManagedProc): boolean {
  return entry.exitCode === null && !entry.proc.killed;
}

export interface StartOptions {
  projectId: number;
  name: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onOutputLine?: (line: string, entry: ManagedProc) => void;
}

export function startProcess(opts: StartOptions): ManagedProc {
  const { projectId, name, command, cwd, env, onOutputLine } = opts;
  const key = procKey(projectId, name);

  const existing = procs.get(key);
  if (existing) {
    try { existing.proc.kill("SIGTERM"); } catch {}
    procs.delete(key);
  }

  const proc = spawn("sh", ["-c", command], {
    cwd, env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const entry: ManagedProc = {
    proc, output: [], projectId, name, command, cwd,
    startedAt: Date.now(), exitCode: null,
  };

  const pushLines = (raw: string, prefix = "") => {
    const lines = raw.split("\n");
    for (const l of lines) {
      const line = prefix ? `${prefix}${l}` : l;
      entry.output.push(line);
      try { onOutputLine?.(line, entry); } catch {}
    }
    if (entry.output.length > MAX_BUFFER_LINES) {
      entry.output.splice(0, entry.output.length - MAX_BUFFER_LINES);
    }
  };

  proc.stdout?.on("data", (data: Buffer) => pushLines(data.toString()));
  proc.stderr?.on("data", (data: Buffer) => pushLines(data.toString(), "[stderr] "));
  proc.on("exit", (code) => {
    entry.exitCode = code;
    entry.output.push(`[Process exited: ${code}]`);
  });

  procs.set(key, entry);
  return entry;
}

export function stopProcess(projectId: number, name: string): boolean {
  const key = procKey(projectId, name);
  const entry = procs.get(key);
  if (!entry) return false;
  try { entry.proc.kill("SIGTERM"); } catch {}
  procs.delete(key);
  return true;
}

export function getProcess(projectId: number, name: string): ManagedProc | undefined {
  return procs.get(procKey(projectId, name));
}

export function listProcesses(projectId: number): ManagedProc[] {
  return Array.from(procs.values()).filter(p => p.projectId === projectId);
}

/** Stop and remove every process associated with a project. Used on project delete. */
export function killProjectProcesses(projectId: number): number {
  let killed = 0;
  for (const [key, entry] of procs.entries()) {
    if (entry.projectId === projectId) {
      try { entry.proc.kill("SIGTERM"); } catch {}
      procs.delete(key);
      killed++;
    }
  }
  return killed;
}

/** Restrict process names to a safe charset to keep map keys + URL paths sane. */
const SAFE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
export function isValidProcessName(name: string): boolean {
  return typeof name === "string" && SAFE_NAME_RE.test(name);
}

export function tailLogs(projectId: number, name: string, lines = 200): string[] | undefined {
  const entry = procs.get(procKey(projectId, name));
  if (!entry) return undefined;
  return entry.output.slice(-lines);
}

export function setProcessPort(projectId: number, name: string, port: number): void {
  const entry = procs.get(procKey(projectId, name));
  if (entry) entry.port = port;
}
