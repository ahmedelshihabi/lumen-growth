// POST (user JWT, owner/admin only) — applies a recommendation on Meta, or undoes one.
//   { action: 'apply', workspace_id?, rec_key?, actions: ApplyAction[] }  -> { applied: [{id, op, campaign_id, before, after}] }
//   { action: 'undo',  workspace_id?, action_id }                         -> { undone: id }
//
// Every change reads the live value from Meta first, is checked against the guard rails in
// _shared/meta-apply.ts, is logged in public.applied_actions (before/after), and mirrored to
// public.campaigns. A two-step change (budget shift) is reverted if the second step fails.
import { HttpError, adminClient, json, loadSubscription, readJson, requireEditor, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { graphGet, graphPost } from '../_shared/graph.ts';
import { META_CREATE_SCOPES, budgetToMajor, majorToMinor } from '../_shared/meta.ts';
import { isSubscriptionActive } from '../_shared/period.ts';
import { checkBudgetChange, validateActions, type ApplyAction } from '../_shared/meta-apply.ts';

interface Body {
  action?: 'apply' | 'undo';
  workspace_id?: string;
  rec_key?: string;
  actions?: unknown;
  action_id?: string;
}

interface LiveCampaign {
  id: string;
  name?: string;
  status?: string;
  daily_budget?: string;
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<Body>(req);
  const { workspaceId, role } = await resolveWorkspace(admin, user.id, body.workspace_id);
  requireEditor(role);

  const sub = await loadSubscription(admin, workspaceId);
  if (!sub || !isSubscriptionActive(sub.status, sub.current_period_end ? new Date(sub.current_period_end) : null, new Date())) {
    throw new HttpError(402, 'subscription_inactive');
  }

  const { data: conn } = await admin.from('meta_connections').select('access_token, scopes').eq('workspace_id', workspaceId).maybeSingle();
  if (!conn) throw new HttpError(400, 'meta_not_connected');
  const scopes = (conn.scopes as string[] | null) ?? [];
  if (!META_CREATE_SCOPES.every((s) => scopes.includes(s))) throw new HttpError(403, 'meta_reconnect_required');
  const token = conn.access_token as string;

  /** The campaign must belong to this workspace; returns its account currency. */
  const loadCampaign = async (campaignId: string) => {
    const { data, error } = await admin
      .from('campaigns')
      .select('meta_campaign_id, name, ad_accounts(currency)')
      .eq('workspace_id', workspaceId)
      .eq('meta_campaign_id', campaignId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(403, 'campaign_not_in_workspace');
    const currency = ((data.ad_accounts as unknown as { currency?: string } | null)?.currency ?? 'USD').toUpperCase();
    return { name: data.name as string, currency };
  };

  // VERIFY: GET /{campaign} fields status, daily_budget (minor units, absent for ad-set budgets).
  const live = (id: string) => graphGet<LiveCampaign>(id, { fields: 'id,name,status,daily_budget' }, token);

  /** Apply one change on Meta. Returns before/after in major units. */
  const applyOne = async (a: ApplyAction) => {
    const { name, currency } = await loadCampaign(a.campaignId);
    const cur = await live(a.campaignId);
    const before = { status: cur.status ?? null, daily_budget: budgetToMajor(cur.daily_budget, currency) };
    const after = { ...before };
    if (a.op === 'set_daily_budget') {
      const check = checkBudgetChange(before.daily_budget, a.to, currency);
      if (check !== 'ok') throw new HttpError(400, check);
      // VERIFY: POST /{campaign} daily_budget in minor units for campaign-budget (CBO) campaigns.
      await graphPost(a.campaignId, { daily_budget: String(majorToMinor(a.to!, currency)) }, token);
      after.daily_budget = a.to!;
    } else {
      const status = a.op === 'pause' ? 'PAUSED' : 'ACTIVE';
      await graphPost(a.campaignId, { status }, token);
      after.status = status;
    }
    await admin
      .from('campaigns')
      .update({ status: after.status, daily_budget: after.daily_budget, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('meta_campaign_id', a.campaignId);
    return { a, name: a.campaignName ?? name, before, after };
  };

  /** Put a campaign back to a recorded state (used by undo and by the rollback of a failed shift). */
  const restore = async (campaignId: string, op: string, before: { status: string | null; daily_budget: number | null }) => {
    if (op === 'set_daily_budget' && before.daily_budget) {
      const { currency } = await loadCampaign(campaignId);
      await graphPost(campaignId, { daily_budget: String(majorToMinor(before.daily_budget, currency)) }, token);
    } else if (before.status) {
      await graphPost(campaignId, { status: before.status }, token);
    }
    await admin
      .from('campaigns')
      .update({ status: before.status, daily_budget: before.daily_budget, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('meta_campaign_id', campaignId);
  };

  if (body.action === 'undo') {
    if (!body.action_id) throw new HttpError(400, 'action_id_required');
    const { data: row, error } = await admin
      .from('applied_actions')
      .select('id, campaign_id, op, before, undone_at')
      .eq('workspace_id', workspaceId)
      .eq('id', body.action_id)
      .maybeSingle();
    if (error) throw error;
    if (!row || row.undone_at) throw new HttpError(404, 'action_not_found');
    await restore(row.campaign_id as string, row.op as string, row.before as { status: string | null; daily_budget: number | null });
    await admin.from('applied_actions').update({ undone_at: new Date().toISOString(), undone_by: user.id }).eq('id', row.id);
    return json({ undone: row.id });
  }

  if (body.action !== 'apply') throw new HttpError(400, 'unknown_action');
  if (!validateActions(body.actions)) throw new HttpError(400, 'invalid_actions');

  const done: Awaited<ReturnType<typeof applyOne>>[] = [];
  try {
    for (const a of body.actions) done.push(await applyOne(a));
  } catch (e) {
    // Budget shift: don't leave one side changed.
    for (const d of done.reverse()) {
      try {
        await restore(d.a.campaignId, d.a.op, d.before);
      } catch (err) {
        console.error('rollback failed', d.a.campaignId, err);
      }
    }
    throw e;
  }

  const { data: rows, error } = await admin
    .from('applied_actions')
    .insert(
      done.map((d) => ({
        workspace_id: workspaceId,
        campaign_id: d.a.campaignId,
        campaign_name: d.name,
        op: d.a.op,
        before: d.before,
        after: d.after,
        rec_key: body.rec_key ?? null,
        applied_by: user.id,
      })),
    )
    .select('id, op, campaign_id, campaign_name, before, after, applied_at');
  if (error) throw error;
  return json({ applied: rows ?? [] });
});
