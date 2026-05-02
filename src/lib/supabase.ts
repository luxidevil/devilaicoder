export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';
export const AUTH_TOKEN_STORAGE_KEY = 'luxi_auth_token';

export function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {}
}

async function readError(response: Response) {
  try {
    const data = await response.json() as { error?: string };
    if (data.error) return data.error;
  } catch {}
  return `${response.status} ${response.statusText}`;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const isJsonBody = init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type');
  if (isJsonBody) headers.set('Content-Type', 'application/json');

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (response.status === 204) {
    return null as T;
  }
  return response.json() as Promise<T>;
}
