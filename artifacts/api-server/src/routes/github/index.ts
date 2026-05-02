import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, filesTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fsPromises from "fs/promises";
import * as pathLib from "path";

const execFileAsync = promisify(execFile);
const router: IRouter = Router();

const PROJECTS_ROOT = pathLib.join(process.env.HOME || "/home/runner", "projects");
const CMD_TIMEOUT = 120_000;

function getProjectDir(projectId: number): string {
  return pathLib.join(PROJECTS_ROOT, String(projectId));
}

function getToken(req: any): string | null {
  const headerToken = req.headers["x-github-token"] as string | undefined;
  if (headerToken && /^[A-Za-z0-9_]+$/.test(headerToken)) return headerToken;
  return process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? null;
}

function scrubToken(text: string, token: string | null): string {
  if (!text) return text;
  let out = text;
  if (token) out = out.split(token).join("***REDACTED***");
  // Also scrub any "x-access-token:..." patterns
  out = out.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***REDACTED***@");
  return out;
}

function authedRepoUrl(repoUrl: string, token: string | null): string {
  if (!token) return repoUrl;
  return repoUrl.replace(/^https:\/\/(?:[^@]+@)?github\.com\//, `https://x-access-token:${token}@github.com/`);
}

const REPO_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;
const BRANCH_RE = /^[A-Za-z0-9_./-]{1,200}$/;

function validateRepoUrl(url: string): boolean {
  return REPO_URL_RE.test(url);
}

function validateBranch(b: string): boolean {
  return BRANCH_RE.test(b) && !b.startsWith("-") && !b.includes("..");
}

router.get("/github/status", async (req, res): Promise<void> => {
  const token = getToken(req);
  if (!token) {
    res.json({ configured: false });
    return;
  }
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "luxi-ide" },
    });
    if (!r.ok) {
      res.json({ configured: true, valid: false, error: `HTTP ${r.status}` });
      return;
    }
    const u = (await r.json()) as { login?: string; name?: string; avatar_url?: string };
    res.json({ configured: true, valid: true, login: u.login, name: u.name, avatarUrl: u.avatar_url });
  } catch (err: any) {
    res.json({ configured: true, valid: false, error: scrubToken(err.message ?? "unknown error", token) });
  }
});

router.get("/github/repos", async (req, res): Promise<void> => {
  const token = getToken(req);
  if (!token) {
    res.status(400).json({ error: "GitHub token not configured" });
    return;
  }
  try {
    const all: any[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "luxi-ide" },
      });
      if (!r.ok) break;
      const data = (await r.json()) as any[];
      if (!Array.isArray(data) || data.length === 0) break;
      all.push(...data);
      if (data.length < 100) break;
    }
    res.json(
      all.map((r: any) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        description: r.description,
        defaultBranch: r.default_branch,
        cloneUrl: r.clone_url,
        sshUrl: r.ssh_url,
        updatedAt: r.updated_at,
        language: r.language,
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: scrubToken(err.message ?? "unknown error", token) });
  }
});

router.post("/projects/:projectId/github/clone", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }
  const { repoUrl, branch } = (req.body ?? {}) as { repoUrl?: string; branch?: string };
  if (!repoUrl || !validateRepoUrl(repoUrl)) {
    res.status(400).json({ error: "repoUrl must be a https://github.com/owner/repo URL" });
    return;
  }
  if (branch && !validateBranch(branch)) {
    res.status(400).json({ error: "Invalid branch name" });
    return;
  }
  const token = getToken(req);
  const url = authedRepoUrl(repoUrl, token);

  const projectDir = getProjectDir(projectId);
  const sanitizedUrl = repoUrl.replace(/\.git\/?$/, "") + ".git";

  // Always sanitize/remove any token-bearing remote on exit, regardless of outcome
  const sanitizeRemote = async () => {
    try {
      const hasGitDir = await fsPromises.stat(pathLib.join(projectDir, ".git")).then(() => true).catch(() => false);
      if (!hasGitDir) return;
      // Try setting to a clean URL, fall back to removing the remote entirely
      const setOk = await execFileAsync("git", ["remote", "set-url", "origin", sanitizedUrl], { cwd: projectDir, timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!setOk) {
        await execFileAsync("git", ["remote", "remove", "origin"], { cwd: projectDir, timeout: 15_000 }).catch(() => {});
      }
    } catch {}
  };

  try {
    await fsPromises.rm(projectDir, { recursive: true, force: true }).catch(() => {});
    await fsPromises.mkdir(pathLib.dirname(projectDir), { recursive: true });

    const args = ["clone", "--depth", "50"];
    if (branch) args.push("--branch", branch, "--single-branch");
    args.push(url, projectDir);

    const { stderr } = await execFileAsync("git", args, { timeout: CMD_TIMEOUT });

    await sanitizeRemote();

    // Wipe existing DB files & re-import disk
    await db.delete(filesTable).where(eq(filesTable.projectId, projectId));
    const imported = await importDir(projectId, projectDir);

    res.json({
      success: true,
      filesImported: imported,
      info: scrubToken(stderr, token).split("\n").filter(Boolean).slice(-3).join(" | "),
    });
  } catch (err: any) {
    // Best-effort sanitize on failure too — partial clone may have left token in .git/config
    await sanitizeRemote();
    const safeMsg = scrubToken(err.message ?? "Clone failed", token).slice(0, 500);
    logger.error({ err: safeMsg }, "GitHub clone failed");
    res.status(500).json({ error: safeMsg });
  }
});

router.post("/projects/:projectId/github/push", async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  if (!projectId) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }
  const { repoUrl, branch, commitMessage } = (req.body ?? {}) as {
    repoUrl?: string;
    branch?: string;
    commitMessage?: string;
  };
  if (!repoUrl || !validateRepoUrl(repoUrl)) {
    res.status(400).json({ error: "repoUrl must be a https://github.com/owner/repo URL" });
    return;
  }
  const targetBranch = branch || "main";
  if (!validateBranch(targetBranch)) {
    res.status(400).json({ error: "Invalid branch name" });
    return;
  }
  const token = getToken(req);
  if (!token) {
    res.status(400).json({ error: "GitHub token not configured" });
    return;
  }
  const url = authedRepoUrl(repoUrl, token);
  const sanitizedUrl = repoUrl.replace(/\.git\/?$/, "") + ".git";
  // Limit & strip newlines from commit message to keep it a single safe arg
  const msg = (commitMessage || `Update from Luxi IDE — ${new Date().toISOString()}`)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);

  const projectDir = getProjectDir(projectId);
  try {
    // Sync DB files to disk first
    const files = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
    await fsPromises.mkdir(projectDir, { recursive: true });
    for (const f of files) {
      const full = pathLib.join(projectDir, f.path);
      await fsPromises.mkdir(pathLib.dirname(full), { recursive: true });
      await fsPromises.writeFile(full, f.content, "utf-8");
    }

    const isRepo = await fsPromises.stat(pathLib.join(projectDir, ".git")).then(() => true).catch(() => false);
    if (!isRepo) {
      await execFileAsync("git", ["init"], { cwd: projectDir, timeout: 30_000 });
      await execFileAsync("git", ["checkout", "-B", targetBranch], { cwd: projectDir, timeout: 30_000 }).catch(() => {});
    }

    await execFileAsync("git", ["config", "user.email", "luxi-ide@users.noreply.github.com"], { cwd: projectDir, timeout: 15_000 });
    await execFileAsync("git", ["config", "user.name", "Luxi IDE"], { cwd: projectDir, timeout: 15_000 });

    // Set authed remote for the push, then sanitize after
    await execFileAsync("git", ["remote", "remove", "origin"], { cwd: projectDir, timeout: 15_000 }).catch(() => {});
    await execFileAsync("git", ["remote", "add", "origin", url], { cwd: projectDir, timeout: 15_000 });

    await execFileAsync("git", ["add", "-A"], { cwd: projectDir, timeout: 60_000 });

    let committed = true;
    try {
      await execFileAsync("git", ["commit", "-m", msg], { cwd: projectDir, timeout: 60_000 });
    } catch {
      committed = false;
    }

    let pushStderr = "";
    try {
      const { stderr } = await execFileAsync("git", ["push", "-u", "origin", targetBranch], { cwd: projectDir, timeout: CMD_TIMEOUT });
      pushStderr = stderr;
    } finally {
      // Always strip token from disk regardless of push success
      await execFileAsync("git", ["remote", "set-url", "origin", sanitizedUrl], { cwd: projectDir, timeout: 15_000 }).catch(() => {});
    }

    res.json({
      success: true,
      committed,
      branch: targetBranch,
      info: scrubToken(pushStderr, token).split("\n").filter(Boolean).slice(-3).join(" | "),
    });
  } catch (err: any) {
    // Best-effort sanitize remote on failure path too
    await execFileAsync("git", ["remote", "set-url", "origin", sanitizedUrl], { cwd: projectDir, timeout: 15_000 }).catch(() => {});
    const safeMsg = scrubToken(err.message ?? "Push failed", token).slice(0, 500);
    logger.error({ err: safeMsg }, "GitHub push failed");
    res.status(500).json({ error: safeMsg });
  }
});

router.post("/github/create-repo", async (req, res): Promise<void> => {
  const token = getToken(req);
  if (!token) {
    res.status(400).json({ error: "GitHub token not configured" });
    return;
  }
  const { name, description, private: isPrivate } = (req.body ?? {}) as {
    name?: string;
    description?: string;
    private?: boolean;
  };
  if (!name || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) {
    res.status(400).json({ error: "name must match /^[A-Za-z0-9_.-]{1,100}$/" });
    return;
  }
  try {
    const r = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "luxi-ide",
      },
      body: JSON.stringify({ name, description: description ?? "", private: !!isPrivate, auto_init: true }),
    });
    if (!r.ok) {
      const errBody = await r.text();
      res.status(r.status).json({ error: errBody.slice(0, 500) });
      return;
    }
    const data = (await r.json()) as any;
    res.json({
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      cloneUrl: data.clone_url,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
    });
  } catch (err: any) {
    res.status(500).json({ error: scrubToken(err.message ?? "Create failed", token) });
  }
});

async function importDir(projectId: number, dir: string): Promise<number> {
  let count = 0;
  const SKIP = new Set(["node_modules", ".git", "venv", ".venv", "__pycache__", ".next", "dist", "build", ".cache"]);
  async function walk(curDir: string, prefix: string) {
    let entries;
    try {
      entries = await fsPromises.readdir(curDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(pathLib.join(curDir, entry.name), rel);
      } else if (entry.isFile()) {
        try {
          const stat = await fsPromises.stat(pathLib.join(curDir, entry.name));
          if (stat.size > 1_000_000) continue;
          const content = await fsPromises.readFile(pathLib.join(curDir, entry.name), "utf-8");
          const lang = entry.name.split(".").pop()?.toLowerCase() ?? null;
          await db.insert(filesTable).values({ projectId, name: entry.name, path: rel, content, language: lang });
          count++;
        } catch {
          // binary file or read error — skip
        }
      }
    }
  }
  await walk(dir, "");
  await db.update(projectsTable).set({ updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
  return count;
}

export default router;
