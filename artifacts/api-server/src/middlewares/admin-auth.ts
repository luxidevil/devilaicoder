import type { Request, Response, NextFunction } from "express";

const PUBLIC_PATHS = new Set<string>(["/healthz", "/health"]);

// Fail-fast in production if ADMIN_CREDS is missing (no insecure fallback in prod).
if (process.env.NODE_ENV === "production" && !process.env.ADMIN_CREDS) {
  // eslint-disable-next-line no-console
  console.error("FATAL: ADMIN_CREDS env is required in production. Refusing to start with default LUXI:LUXI credentials.");
  process.exit(1);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }
  const auth = req.headers["authorization"];
  if (!auth || typeof auth !== "string" || !auth.startsWith("Basic ")) {
    res.status(401).set("WWW-Authenticate", 'Basic realm="LUXI IDE"').json({ error: "Unauthorized" });
    return;
  }
  const b64 = auth.slice("Basic ".length);
  let decoded = "";
  try {
    decoded = Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const expected = process.env.ADMIN_CREDS || "LUXI:LUXI";
  if (decoded !== expected) {
    res.status(401).set("WWW-Authenticate", 'Basic realm="LUXI IDE"').json({ error: "Unauthorized" });
    return;
  }
  next();
}
