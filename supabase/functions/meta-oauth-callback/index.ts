// POST { code, redirect_uri, workspace_id? } with the user's JWT.
// The SPA receives ?code=... on /app/connect after Facebook Login and forwards it
// here. We exchange it for a long-lived user token, store the token (service-role
// only table), and upsert the user's ad accounts. Returns the account list (no token).
//
// While the Meta app is in Development mode only people with a role on the app
// (admins / developers / testers) can complete this flow.
import { adminClient, env, HttpError, json, loadSubscription, readJson, requireEditor, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { graphGet, graphGetAll } from '../_shared/graph.ts';
import { META_SCOPES } from '../_shared/meta.ts';
import { isSubscriptionActive } from '../_shared/period.ts';

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface MetaAdAccount {
  id: string; // 'act_123'
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<{ code?: string; redirect_uri?: string; workspace_id?: string }>(req);
  if (!body.code) throw new HttpError(400, 'missing_code');

  const { workspaceId, role } = await resolveWorkspace(admin, user.id, body.workspace_id);
  // Connecting Meta stores a token for the whole workspace: owner/admin only.
  requireEditor(role);
  const sub = await loadSubscription(admin, workspaceId);
  if (!sub || !isSubscriptionActive(sub.status, sub.current_period_end ? new Date(sub.current_period_end) : null, new Date())) {
    throw new HttpError(402, 'subscription_inactive');
  }

  // The redirect_uri must be byte-identical to the one used in the login dialog,
  // and must be listed under "Valid OAuth Redirect URIs" in the Meta app.
  const expectedRedirect = `${env('APP_URL').replace(/\/$/, '')}/app/connect`;
  const redirectUri = body.redirect_uri ?? expectedRedirect;
  if (redirectUri !== expectedRedirect) throw new HttpError(400, 'redirect_uri_mismatch', `Expected ${expectedRedirect}`);

  const appId = env('META_APP_ID');
  const appSecret = env('META_APP_SECRET');

  // 1) code -> short-lived user token
  // VERIFY: GET /oauth/access_token?client_id&redirect_uri&client_secret&code
  const short = await graphGet<TokenResponse>('oauth/access_token', {
    client_id: appId,
    redirect_uri: redirectUri,
    client_secret: appSecret,
    code: body.code,
  });

  // 2) short-lived -> long-lived (~60 days)
  // VERIFY: GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token
  const long = await graphGet<TokenResponse>('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: short.access_token,
  });
  const token = long.access_token;
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;

  const me = await graphGet<{ id: string; name?: string }>('me', { fields: 'id,name' }, token);

  const { error: connErr } = await admin.from('meta_connections').upsert(
    {
      workspace_id: workspaceId,
      meta_user_id: me.id,
      meta_user_name: me.name ?? null,
      access_token: token,
      expires_at: expiresAt,
      scopes: META_SCOPES,
      connected_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );
  if (connErr) throw connErr;

  // VERIFY: /me/adaccounts fields (account_status: 1 = ACTIVE).
  const accounts = await graphGetAll<MetaAdAccount>(
    'me/adaccounts',
    { fields: 'id,account_id,name,currency,timezone_name,account_status', limit: '100' },
    token,
    10,
  );

  if (accounts.length) {
    // Upsert without touching `selected` (the user picks accounts in the UI).
    const { error } = await admin.from('ad_accounts').upsert(
      accounts.map((a) => ({
        workspace_id: workspaceId,
        meta_account_id: a.id.startsWith('act_') ? a.id : `act_${a.account_id}`,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone_name,
        account_status: a.account_status,
      })),
      { onConflict: 'workspace_id,meta_account_id' },
    );
    if (error) throw error;
  }

  const { data: rows } = await admin
    .from('ad_accounts')
    .select('id, meta_account_id, name, currency, timezone, account_status, selected')
    .eq('workspace_id', workspaceId)
    .order('name');

  return json({
    meta_user_name: me.name ?? null,
    expires_at: expiresAt,
    accounts: rows ?? [],
    max_ad_accounts: sub.plans.max_ad_accounts,
  });
});
