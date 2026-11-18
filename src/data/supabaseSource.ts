/**
 * DataSource backed by Supabase: reads the insights cache that the meta-sync
 * Edge Function fills (insights_daily, campaigns, ads, ad_accounts) plus the
 * user-entered monthly budgets (campaign_budgets). RLS limits every query to
 * the signed-in user's workspace; we also filter by workspace explicitly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdAccount, Campaign, CampaignDailyMetric, CampaignStatus, Creative, CreativeDailyMetric, CreativeFormat, DateRange, ISODate } from './types';
import type { DataSource } from './source';
import type { TargetsByAccount } from '../rules/types';
import { DEFAULT_WORKSPACE_SETTINGS, normalizeSettings, type WorkspaceSettings } from './settings';
import { addDays, localToday } from '../lib/dates';
import { mapObjective } from '../../supabase/functions/_shared/meta.ts';

const PAGE = 1000;

interface InsightRow {
  date: string;
  campaign_id: string;
  ad_id: string;
  spend: number | string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  conversions: number | string;
  revenue: number | string;
  video_views_3s: number | string;
  frequency: number | string;
  messaging_conversations: number | string | null;
}

const n = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

function mapStatus(s: string | null): CampaignStatus {
  if (!s) return 'PAUSED';
  if (s === 'ACTIVE') return 'ACTIVE';
  if (s.includes('LEARNING') || s === 'IN_PROCESS' || s === 'PENDING_REVIEW') return 'LEARNING';
  return 'PAUSED';
}

const PALETTE = ['#6250d6', '#0e9f6e', '#d97706', '#db2777', '#2563eb', '#0891b2', '#7c3aed', '#dc2626'];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export class SupabaseDataSource implements DataSource {
  readonly kind = 'supabase' as const;
  private accountIds: Map<string, string> | null = null; // ad_accounts.id (uuid) -> act_ id

  constructor(private readonly db: SupabaseClient, private readonly workspaceId: string) {}

  private async accountMap(): Promise<Map<string, string>> {
    if (this.accountIds) return this.accountIds;
    const { data, error } = await this.db.from('ad_accounts').select('id, meta_account_id').eq('workspace_id', this.workspaceId);
    if (error) throw error;
    this.accountIds = new Map((data ?? []).map((r) => [r.id as string, r.meta_account_id as string]));
    return this.accountIds;
  }

  async getAsOf(): Promise<ISODate> {
    const { data, error } = await this.db
      .from('insights_daily')
      .select('date')
      .eq('workspace_id', this.workspaceId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.date as string | undefined) ?? addDays(localToday(), -1);
  }

  async getAccounts(): Promise<AdAccount[]> {
    const { data, error } = await this.db
      .from('ad_accounts')
      .select('meta_account_id, name, currency, timezone')
      .eq('workspace_id', this.workspaceId)
      .eq('selected', true)
      .order('name');
    if (error) throw error;
    return (data ?? []).map((a) => ({ id: a.meta_account_id, name: a.name, channel: 'meta', currency: a.currency, timezone: a.timezone }));
  }

  async getCampaigns(): Promise<Campaign[]> {
    const [accounts, campaigns, budgets] = await Promise.all([
      this.accountMap(),
      this.db.from('campaigns').select('meta_campaign_id, ad_account_id, name, objective, status, daily_budget, start_date').eq('workspace_id', this.workspaceId),
      this.db.from('campaign_budgets').select('campaign_id, monthly_budget').eq('workspace_id', this.workspaceId),
    ]);
    if (campaigns.error) throw campaigns.error;
    if (budgets.error) throw budgets.error;
    const budgetOf = new Map((budgets.data ?? []).map((b) => [b.campaign_id as string, n(b.monthly_budget)]));
    return (campaigns.data ?? []).map((c) => ({
      id: c.meta_campaign_id,
      accountId: accounts.get(c.ad_account_id) ?? c.ad_account_id,
      channel: 'meta',
      name: c.name,
      objective: mapObjective(c.objective ?? undefined),
      status: mapStatus(c.status),
      dailyBudget: n(c.daily_budget),
      monthlyBudget: budgetOf.get(c.meta_campaign_id) ?? 0,
      startDate: c.start_date ?? '2000-01-01',
    }));
  }

  async getCreatives(): Promise<Creative[]> {
    const { data, error } = await this.db.from('ads').select('meta_ad_id, meta_campaign_id, name, format, headline').eq('workspace_id', this.workspaceId);
    if (error) throw error;
    return (data ?? []).map((a) => ({
      id: a.meta_ad_id,
      campaignId: a.meta_campaign_id,
      channel: 'meta',
      name: a.name,
      format: (['video', 'image', 'carousel'].includes(a.format) ? a.format : 'image') as CreativeFormat,
      headline: a.headline ?? a.name,
      color: colorFor(a.meta_ad_id),
    }));
  }

  private async insights(level: 'campaign' | 'ad', range: DateRange): Promise<InsightRow[]> {
    const out: InsightRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from('insights_daily')
        .select('date, campaign_id, ad_id, spend, impressions, reach, clicks, conversions, revenue, video_views_3s, frequency, messaging_conversations')
        .eq('workspace_id', this.workspaceId)
        .eq('level', level)
        .gte('date', range.start)
        .lte('date', range.end)
        .order('date')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...((data ?? []) as InsightRow[]));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async getCampaignDaily(range: DateRange): Promise<CampaignDailyMetric[]> {
    return (await this.insights('campaign', range)).map((r) => ({
      date: r.date,
      campaignId: r.campaign_id,
      spend: n(r.spend),
      impressions: n(r.impressions),
      reach: n(r.reach),
      clicks: n(r.clicks),
      conversions: n(r.conversions),
      revenue: n(r.revenue),
      frequency: n(r.frequency),
      conversations: n(r.messaging_conversations),
    }));
  }

  async getCreativeDaily(range: DateRange): Promise<CreativeDailyMetric[]> {
    return (await this.insights('ad', range)).map((r) => ({
      date: r.date,
      creativeId: r.ad_id,
      campaignId: r.campaign_id,
      spend: n(r.spend),
      impressions: n(r.impressions),
      clicks: n(r.clicks),
      conversions: n(r.conversions),
      revenue: n(r.revenue),
      videoViews3s: n(r.video_views_3s),
      frequency: n(r.frequency),
    }));
  }

  async saveMonthlyBudgets(budgets: Record<string, number | null>): Promise<void> {
    const upserts = Object.entries(budgets)
      .filter(([, v]) => v !== null)
      .map(([campaign_id, monthly_budget]) => ({ workspace_id: this.workspaceId, campaign_id, monthly_budget, updated_at: new Date().toISOString() }));
    const deletes = Object.entries(budgets)
      .filter(([, v]) => v === null)
      .map(([id]) => id);
    if (upserts.length) {
      const { error } = await this.db.from('campaign_budgets').upsert(upserts, { onConflict: 'workspace_id,campaign_id' });
      if (error) throw error;
    }
    if (deletes.length) {
      const { error } = await this.db.from('campaign_budgets').delete().eq('workspace_id', this.workspaceId).in('campaign_id', deletes);
      if (error) throw error;
    }
  }

  async getSettings(): Promise<WorkspaceSettings> {
    const { data, error } = await this.db
      .from('workspace_settings')
      .select('currency, timezone, attribution_window, alert_config')
      .eq('workspace_id', this.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ...DEFAULT_WORKSPACE_SETTINGS };
    return normalizeSettings({
      currency: data.currency,
      timezone: data.timezone,
      attributionWindow: data.attribution_window,
      alerts: data.alert_config,
    });
  }

  async saveSettings(s: WorkspaceSettings): Promise<void> {
    const { error } = await this.db.from('workspace_settings').upsert(
      {
        workspace_id: this.workspaceId,
        currency: s.currency,
        timezone: s.timezone,
        attribution_window: s.attributionWindow,
        alert_config: s.alerts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );
    if (error) throw error;
  }

  async getTargets(): Promise<TargetsByAccount> {
    const { data, error } = await this.db
      .from('account_targets')
      .select('ad_account_id, target_cpa, target_roas')
      .eq('workspace_id', this.workspaceId);
    if (error) throw error;
    return Object.fromEntries(
      (data ?? []).map((r) => [r.ad_account_id as string, { targetCpa: n(r.target_cpa), targetRoas: n(r.target_roas) }]),
    );
  }

  async saveTargets(targets: TargetsByAccount | null): Promise<void> {
    if (targets === null) {
      const { error } = await this.db.from('account_targets').delete().eq('workspace_id', this.workspaceId);
      if (error) throw error;
      return;
    }
    const rows = Object.entries(targets)
      .filter(([, t]) => t.targetCpa > 0 && t.targetRoas > 0)
      .map(([ad_account_id, t]) => ({
        workspace_id: this.workspaceId,
        ad_account_id,
        target_cpa: t.targetCpa,
        target_roas: t.targetRoas,
        updated_at: new Date().toISOString(),
      }));
    if (!rows.length) return;
    const { error } = await this.db.from('account_targets').upsert(rows, { onConflict: 'workspace_id,ad_account_id' });
    if (error) throw error;
  }
}
