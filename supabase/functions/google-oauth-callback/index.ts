// POST { code, redirect_uri, workspace_id? } with the user's JWT.
// The SPA receives ?code=...&state=google:... on /app/connect after Google sign-in and
// forwards it here. We exchange it for a refresh token, store it (service-role-only
// table), and upsert the Google Ads accounts the user can access. Returns the account
// list (no token). Read-only: only the adwords scope is requested and only GAQL reads run.
import { HttpError, adminClient, env, json, loadSubscription, readJson, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { emailFromIdToken, exchangeCode, listAccessibleCustomers, searchStream } from '../_shared/google-api.ts';
import { CUSTOMER_GAQL, GOOGLE_ADS_SCOPE, gadsAccountId, type GadsCustomerRow } from '../_shared/google.ts';
import { isSubscriptionActive } from '../_shared/period.ts';

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<{ code?: string; redirect_uri?: string; workspace_id?: string }>(req);
  if (!body.code) throw new HttpError(400, 'missing_code');

  const { workspaceId } = await resolveWorkspace(admin, user.id, body.workspace_id);
  const sub = await loadSubscription(admin, workspaceId);
  if (!sub || !isSubscriptionActive(sub.status, sub.current_period_end ? new Date(sub.current_period_end) : null, new Date())) {
    throw new HttpError(402, 'subscription_inactive');
  }

  // Must be byte-identical to the redirect_uri used on the consent screen and listed
  // under "Authorized redirect URIs" in the Google Cloud OAuth client.
  const expectedRedirect = `${env('APP_URL').replace(/\/$/, '')}/app/connect`;
  const redirectUri = body.redirect_uri ?? expectedRedirect;
  if (redirectUri !== expectedRedirect) throw new HttpError(400, 'redirect_uri_mismatch', `Expected ${expectedRedirect}`);

  const tokens = await exchangeCode(body.code, redirectUri);
  const { data: existing } = await admin.from('google_connections').select('refresh_token').eq('workspace_id', workspaceId).maybeSingle();
  // Google only returns refresh_token on first consent; prompt=consent should force it, but keep the old one as a fallback.
  const refreshToken = tokens.refresh_token ?? (existing?.refresh_token as string | undefined);
  if (!refreshToken) throw new HttpError(400, 'google_no_refresh_token', 'Google did not return a refresh token. Remove Lumen from your Google account permissions and connect again.');

  const email = emailFromIdToken(tokens.id_token);
  const { error: connErr } = await admin.from('google_connections').upsert(
    {
      workspace_id: workspaceId,
      google_email: email,
      refresh_token: refreshToken,
      scopes: [GOOGLE_ADS_SCOPE],
      connected_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );
  if (connErr) throw connErr;

  const customerIds = await listAccessibleCustomers(tokens.access_token);
  const accounts: Record<string, unknown>[] = [];
  for (const id of customerIds.slice(0, 50)) {
    try {
      const [row] = await searchStream<GadsCustomerRow>(tokens.access_token, id, CUSTOMER_GAQL, id);
      const c = row?.customer;
      // Manager (MCC) accounts have no campaigns of their own; skip them in the picker.
      if (c?.manager) continue;
      accounts.push({
        workspace_id: workspaceId,
        meta_account_id: gadsAccountId(id),
        platform: 'google',
        name: c?.descriptiveName || `Google Ads ${id}`,
        currency: c?.currencyCode ?? 'USD',
        timezone: c?.timeZone ?? 'UTC',
        // VERIFY: CustomerStatus ENABLED -> 1 like Meta's ACTIVE so the UI shows it as active.
        account_status: c?.status === 'ENABLED' ? 1 : 2,
      });
    } catch {
      // Accounts the user can list but not query (e.g. cancelled, or reachable only via a manager) are skipped.
    }
  }

  if (accounts.length) {
    const { error } = await admin.from('ad_accounts').upsert(accounts, { onConflict: 'workspace_id,meta_account_id' });
    if (error) throw error;
  }

  const { data: rows } = await admin
    .from('ad_accounts')
    .select('id, meta_account_id, name, currency, timezone, account_status, selected, platform')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'google')
    .order('name');

  return json({ google_email: email, accounts: rows ?? [], max_ad_accounts: sub.plans.max_ad_accounts });
});
