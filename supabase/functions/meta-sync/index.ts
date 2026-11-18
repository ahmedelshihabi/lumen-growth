// Pull the last 30 days of daily Meta insights (campaign + ad level) for the
// workspace's selected ad accounts into insights_daily, plus campaign/ad metadata.
//
// Auth (deployed with --no-verify-jwt, checked here instead):
//   * user JWT  -> syncs that user's workspace (body.workspace_id optional)
//   * header x-cron-secret == CRON_SECRET -> syncs every active workspace (daily cron)
//
// Respects plan.max_ad_accounts: only the first N selected accounts (by
// selected_at) are synced even if more are somehow selected.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { HttpError, adminClient, json, loadSubscription, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { graphGetAll } from '../_shared/graph.ts';
import { budgetToMajor, lastNDaysRange, mapInsightRow, type MetaInsightRow } from '../_shared/meta.ts';
import { isSubscriptionActive } from '../_shared/period.ts';

const SYNC_DAYS = 30;
const CHUNK = 500;

interface AccountRow {
  id: string;
  meta_account_id: string;
  currency: string;
}

async function upsertChunks(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw error;
  }
}

function adFormat(objectType: string | undefined): string {
  const t = (objectType ?? '').toUpperCase();
  if (t.includes('VIDEO')) return 'video';
  if (t.includes('CAROUSEL') || t === 'SHARE_MULTI') return 'carousel'; // VERIFY: creative object_type values
  return 'image';
}

async function syncAccount(admin: SupabaseClient, workspaceId: string, acc: AccountRow, token: string) {
  const { since, until } = lastNDaysRange(new Date(), SYNC_DAYS);
  const timeRange = JSON.stringify({ since, until });

  // Campaign + ad metadata
  // VERIFY: field names on /{act}/campaigns and /{act}/ads.
  const campaigns = await graphGetAll<{
    id: string; name: string; objective?: string; effective_status?: string; daily_budget?: string; start_time?: string;
  }>(`${acc.meta_account_id}/campaigns`, { fields: 'id,name,objective,effective_status,daily_budget,start_time', limit: '200' }, token);
  await upsertChunks(
    admin,
    'campaigns',
    campaigns.map((c) => ({
      workspace_id: workspaceId,
      meta_campaign_id: c.id,
      ad_account_id: acc.id,
      name: c.name,
      objective: c.objective ?? null,
      status: c.effective_status ?? null,
      daily_budget: budgetToMajor(c.daily_budget, acc.currency),
      start_date: c.start_time ? c.start_time.slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    })),
    'workspace_id,meta_campaign_id',
  );

  const ads = await graphGetAll<{ id: string; name: string; campaign_id: string; creative?: { title?: string; body?: string; object_type?: string } }>(
    `${acc.meta_account_id}/ads`,
    { fields: 'id,name,campaign_id,creative{title,body,object_type}', limit: '200' },
    token,
  );
  await upsertChunks(
    admin,
    'ads',
    ads.map((a) => ({
      workspace_id: workspaceId,
      meta_ad_id: a.id,
      meta_campaign_id: a.campaign_id,
      ad_account_id: acc.id,
      name: a.name,
      format: adFormat(a.creative?.object_type),
      headline: a.creative?.title ?? a.creative?.body?.slice(0, 120) ?? null,
      updated_at: new Date().toISOString(),
    })),
    'workspace_id,meta_ad_id',
  );

  // Daily insights at campaign and ad level.
  // VERIFY: GET /{act}/insights params level, time_increment=1, time_range, fields.
  let rowsWritten = 0;
  for (const level of ['campaign', 'ad'] as const) {
    const fields = [
      'campaign_id', 'campaign_name', ...(level === 'ad' ? ['ad_id', 'ad_name'] : []),
      'spend', 'impressions', 'reach', 'clicks', 'frequency', 'actions', 'action_values', 'date_start',
    ].join(',');
    const raw = await graphGetAll<MetaInsightRow>(
      `${acc.meta_account_id}/insights`,
      { level, time_increment: '1', time_range: timeRange, fields, limit: '500' },
      token,
      100,
    );
    const rows = raw
      .map((r) => mapInsightRow(r, level))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({ ...r, workspace_id: workspaceId, ad_account_id: acc.id, currency: acc.currency, fetched_at: new Date().toISOString() }));
    await upsertChunks(admin, 'insights_daily', rows, 'workspace_id,level,campaign_id,ad_id,date');
    rowsWritten += rows.length;
  }
  return { campaigns: campaigns.length, ads: ads.length, rows: rowsWritten };
}

async function syncWorkspace(admin: SupabaseClient, workspaceId: string) {
  const sub = await loadSubscription(admin, workspaceId);
  if (!sub || !isSubscriptionActive(sub.status, sub.current_period_end ? new Date(sub.current_period_end) : null, new Date())) {
    return { workspace_id: workspaceId, skipped: 'subscription_inactive' };
  }
  const { data: conn } = await admin.from('meta_connections').select('access_token, expires_at').eq('workspace_id', workspaceId).maybeSingle();
  if (!conn) return { workspace_id: workspaceId, skipped: 'not_connected' };
  if (conn.expires_at && new Date(conn.expires_at) < new Date()) return { workspace_id: workspaceId, skipped: 'token_expired' };

  const limit = sub.plans.max_ad_accounts;
  const { data: accounts, error } = await admin
    .from('ad_accounts')
    .select('id, meta_account_id, currency, platform')
    .eq('workspace_id', workspaceId)
    .eq('selected', true)
    .order('selected_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results: Record<string, unknown>[] = [];
  // The plan limit counts every platform; only Meta accounts are synced here (google-sync does Google).
  for (const acc of ((accounts ?? []) as (AccountRow & { platform?: string })[]).filter((a) => (a.platform ?? 'meta') === 'meta')) {
    try {
      const r = await syncAccount(admin, workspaceId, acc, conn.access_token as string);
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
    const { data: conns, error } = await admin.from('meta_connections').select('workspace_id');
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
