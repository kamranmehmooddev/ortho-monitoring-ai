export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) { super(message); }
}

const TOKEN_KEY = 'oma.token';
export const tokenStore = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = tokenStore.get();
  if (t) headers.authorization = `Bearer ${t}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 401 && t && !path.startsWith('/auth/login')) onUnauthorized?.();
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.code, data?.error?.details);
  return data as T;
}

/** Fetches an image with the session header and returns an object URL (cached per session). */
const imageCache = new Map<string, Promise<string>>();
export function imageUrl(id: string): Promise<string> {
  let p = imageCache.get(id);
  if (!p) {
    p = fetch(`/api/v1/images/${id}`, { headers: { authorization: `Bearer ${tokenStore.get()}` } })
      .then((r) => { if (!r.ok) throw new Error('image'); return r.blob(); })
      .then((b) => URL.createObjectURL(b));
    p.catch(() => imageCache.delete(id));
    imageCache.set(id, p);
  }
  return p;
}
export const clearImageCache = () => { for (const p of imageCache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {}); imageCache.clear(); };
