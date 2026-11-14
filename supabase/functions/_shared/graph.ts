// Minimal Graph API client for the Edge Functions.
import { GRAPH_BASE } from './meta.ts';
import { HttpError } from './http.ts';

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

export async function graphGet<T>(path: string, params: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // Tokens go in the Authorization header rather than the URL so they never land in logs.
  // VERIFY: Graph API accepts "Authorization: Bearer <user token>" (it documents "OAuth <token>" too).
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { error?: unknown }).error) {
    const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } }).error;
    const code = err?.code === 190 ? 'meta_token_invalid' : 'meta_api_error';
    throw new HttpError(502, code, `Meta API: ${err?.message ?? res.statusText} (code ${err?.code ?? res.status})`);
  }
  return body as T;
}

/** Follows `paging.next` up to `maxPages`. */
export async function graphGetAll<T>(path: string, params: Record<string, string>, token: string, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let page = await graphGet<Paged<T>>(path, params, token);
  out.push(...page.data);
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    page = await graphGet<Paged<T>>(page.paging.next, {}, token);
    out.push(...page.data);
  }
  return out;
}
