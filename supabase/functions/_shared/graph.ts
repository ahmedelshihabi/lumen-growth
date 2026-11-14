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
  return parseGraph<T>(res);
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_title?: string; error_user_msg?: string };
}

async function parseGraph<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as GraphErrorBody).error) {
    const err = (body as GraphErrorBody).error;
    const code = err?.code === 190 ? 'meta_token_invalid' : err?.code === 200 || err?.code === 10 ? 'meta_permission_denied' : 'meta_api_error';
    // error_user_msg is Meta's human-readable explanation (e.g. "budget too low"); prefer it.
    const msg = err?.error_user_msg || err?.message || res.statusText;
    throw new HttpError(502, code, `Meta API: ${msg} (code ${err?.code ?? res.status}${err?.error_subcode ? `/${err.error_subcode}` : ''})`);
  }
  return body as T;
}

/** POST form fields (object values must already be JSON strings, see toFormFields). */
export async function graphPost<T>(path: string, fields: Record<string, string>, token: string): Promise<T> {
  const url = `${GRAPH_BASE}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return parseGraph<T>(res);
}

export async function graphDelete(path: string, token: string): Promise<void> {
  const url = `${GRAPH_BASE}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  await parseGraph<unknown>(res);
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
