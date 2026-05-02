const STORAGE_KEY = "luxi.adminAuth";

function loadCreds(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function saveCreds(b64: string): void {
  try { localStorage.setItem(STORAGE_KEY, b64); } catch { /* noop */ }
}

function clearCreds(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

function promptCreds(): string | null {
  const user = window.prompt("LUXI IDE — admin username", "LUXI");
  if (!user) return null;
  const pass = window.prompt("LUXI IDE — admin password");
  if (pass == null) return null;
  const b64 = btoa(`${user}:${pass}`);
  saveCreds(b64);
  return b64;
}

function isApiUrl(input: RequestInfo | URL): boolean {
  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else url = (input as Request).url;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    return u.pathname.startsWith("/api/") || u.pathname === "/api";
  } catch {
    return false;
  }
}

export function installAuthFetch(): void {
  if ((window as any).__LUXI_AUTH_FETCH_INSTALLED__) return;
  (window as any).__LUXI_AUTH_FETCH_INSTALLED__ = true;
  const orig = window.fetch.bind(window);

  const withAuth = async (input: RequestInfo | URL, init: RequestInit = {}, b64: string | null): Promise<Response> => {
    if (!isApiUrl(input)) return orig(input, init);
    // Skip the public health endpoint
    const url = typeof input === "string" ? input : (input instanceof URL ? input.pathname : (input as Request).url);
    if (/\/api\/healthz?$/.test(url)) return orig(input, init);

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (b64 && !headers.has("authorization")) headers.set("authorization", `Basic ${b64}`);
    return orig(input, { ...init, headers });
  };

  window.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    let b64 = loadCreds();
    let res = await withAuth(input, init, b64);
    if (res.status === 401 && isApiUrl(input)) {
      clearCreds();
      const fresh = promptCreds();
      if (fresh) {
        res = await withAuth(input, init, fresh);
        if (res.status === 401) {
          clearCreds();
          window.alert("LUXI IDE — incorrect admin credentials.");
        }
      }
    }
    return res;
  }) as typeof window.fetch;
}
