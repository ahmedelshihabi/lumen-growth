// Google OAuth + Google Ads REST calls (Deno, I/O). Pure helpers live in google.ts.
import { HttpError, env } from './http.ts';
import { GOOGLE_ADS_BASE, GOOGLE_TOKEN_URL, flattenSearchStream, normalizeCustomerId } from './google.ts';

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new HttpError(res.status === 400 ? 400 : 502, 'google_oauth_failed', body.error_description ?? body.error ?? `Google token error ${res.status}`);
  }
  return body;
}

/** Authorization code -> access + refresh token. */
export function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest({
    code,
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

/** Refresh token -> short-lived access token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const t = await tokenRequest({
    refresh_token: refreshToken,
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  });
  return t.access_token;
}

/** Email of the Google account from the id_token (no extra call; signature not needed here). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

function adsHeaders(accessToken: string, loginCustomerId?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env('GOOGLE_ADS_DEVELOPER_TOKEN'),
    'Content-Type': 'application/json',
  };
  // VERIFY: login-customer-id is required when the user reaches the account through a manager (MCC).
  const login = loginCustomerId ?? Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID');
  if (login) h['login-customer-id'] = normalizeCustomerId(login);
  return h;
}

async function adsError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; details?: unknown[] } } | unknown[];
  const err = Array.isArray(body) ? (body[0] as { error?: { message?: string } })?.error : body.error;
  const msg = err?.message ?? `Google Ads API error ${res.status}`;
  throw new HttpError(res.status === 401 ? 401 : res.status === 403 ? 403 : 502, 'google_ads_error', `Google Ads: ${msg}`);
}

/** Customer ids the signed-in user can access directly. */
// VERIFY: GET customers:listAccessibleCustomers returns { resourceNames: ['customers/123', ...] }.
export async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const res = await fetch(`${GOOGLE_ADS_BASE}/customers:listAccessibleCustomers`, { headers: adsHeaders(accessToken, null) });
  if (!res.ok) await adsError(res);
  const body = (await res.json()) as { resourceNames?: string[] };
  return (body.resourceNames ?? []).map(normalizeCustomerId);
}

/** Run a GAQL query with searchStream and return every result row. */
// VERIFY: POST customers/{id}/googleAds:searchStream with body { query }.
export async function searchStream<T>(accessToken: string, customerId: string, query: string, loginCustomerId?: string | null): Promise<T[]> {
  const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${normalizeCustomerId(customerId)}/googleAds:searchStream`, {
    method: 'POST',
    headers: adsHeaders(accessToken, loginCustomerId),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) await adsError(res);
  return flattenSearchStream<T>(await res.json());
}
