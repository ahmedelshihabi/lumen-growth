// Pull the last 30 days of daily Google Ads campaign metrics for the workspace's
// selected Google accounts into insights_daily (level 'campaign'), plus campaign metadata.
//
// Auth (deployed with verify_jwt = false, checked here instead), same as meta-sync:
//   * user JWT  -> syncs that user's workspace (body.workspace_id optional)
//   * header x-cron-secret == CRON_SECRET -> syncs every connected workspace (daily cron)
//
// Plan limit: max_ad_accounts counts Meta + Google accounts together, oldest selection first.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { HttpError, adminClient, json, loadSubscription, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { refreshAccessToken, searchStream } from '../_shared/google-api.ts';
import {
  CAMPAIGNS_GAQL,
  campaignDailyGaql,
  mapCampaignDailyRow,
  mapCampaignRow,
  mergeDaily,
  stripGads,
  type GadsCampaignRow,
} from '../_shared/google.ts';
import { lastNDaysRange } from '../_shared/meta.ts';
import { isSubscriptionActive } from '../_shared/period.ts';

const SYNC_DAYS = 30;
const CHUNK = 500;

interface AccountRow {
  id: string;
  meta_account_id: string;
  currency: string;
  platform: string;
}

async function upsertChunks(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw error;
  }
}

async function syncAccount(admin: SupabaseClient, workspaceId: string, acc: AccountRow, accessToken: string, loginCustomerId: string | null) {
  const customerId = stripGads(acc.meta_account_id);
  const { since, until } = lastNDaysRange(new Date(), SYNC_DAYS);
  const now = new Date().toISOString();

  const meta = (await searchStream<GadsCampaignRow>(accessToken, customerId, CAMPAIGNS_GAQL, loginCustomerId))
    .map(mapCampaignRow)
    .filter((c): c is NonNullable<typeof c> => c !== null);
  await upsertChunks(
    admin,
    'campaigns',
    meta.map((c) => ({ ...c, workspace_id: workspaceId, ad_account_id: acc.id, platform: 'google', updated_at: now })),
    'workspace_id,meta_campaign_id',
  );

  const daily = mergeDaily(
    (await searchStream<GadsCampaignRow>(accessToken, customerId, campaignDailyGaql(since, until), loginCustomerId))
      .map(mapCampaignDailyRow)
      .filter((r): r is NonNullable<typeof r> => r !== null),
  );
  await upsertChunks(
    admin,
    'insights_daily',
    daily.map((r) => ({ ...r, workspace_id: workspaceId, ad_account_id: acc.id, platform: 'google', currency: acc.currency, fetched_at: now })),
    'workspace_id,level,campaign_id,ad_id,date',
  );
  return { campaigns: meta.length, rows: daily.length };
}

async function syncWorkspace(admin: SupabaseClient, workspaceId: string) {
  const sub = await loadSubscription(admin, workspaceId);
  if (!sub || !isSubscriptionActive(sub.status, sub.current_period_end ? new Date(sub.current_period_end) : null, new Date())) {
    return { workspace_id: workspaceId, skipped: 'subscription_inactive' };
  }
  const { data: conn } = await admin
    .from('google_connections')
    .select('refresh_token, login_customer_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!conn) return { workspace_id: workspaceId, skipped: 'not_connected' };

  // Same plan limit as meta-sync: the first N selected accounts across all platforms.
  const limit = sub.plans.max_ad_accounts;
  const { data: selected, error } = await admin
    .from('ad_accounts')
    .select('id, meta_account_id, currency, platform')
    .eq('workspace_id', workspaceId)
    .eq('selected', true)
    .order('selected_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  const accounts = ((selected ?? []) as AccountRow[]).filter((a) => a.platform === 'google');
  if (!accounts.length) return { workspace_id: workspaceId, limit, accounts: [] };

  const accessToken = await refreshAccessToken(conn.refresh_token as string);
  const results: Record<string, unknown>[] = [];
  for (const acc of accounts) {
    try {
      const r = await syncAccount(admin, workspaceId, acc, accessToken, (conn.login_customer_id as string | null) ?? null);
      await admin.from('ad_accounts').update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq('id', acc.id);
      results.push({ account: acc.meta_account_id, ...r });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from('ad_accounts').update({ last_sync_error: message.slice(0, 500) }).eq('id', acc.id);
      results.push({ account: acc.meta_account_id, error: message });
    }
  }
  return { workspace_id: workspaceId, limit, accounts: results };
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const cronSecret = Deno.env.get('CRON_SECRET');

  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    const { data: conns, error } = await admin.from('google_connections').select('workspace_id');
    if (error) throw error;
    const out = [];
    for (const c of conns ?? []) out.push(await syncWorkspace(admin, c.workspace_id as string));
    return json({ mode: 'cron', workspaces: out });
  }

  const user = await requireUser(req, admin);
  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string };
  const { workspaceId } = await resolveWorkspace(admin, user.id, body.workspace_id);
  return json(await syncWorkspace(admin, workspaceId));
});
