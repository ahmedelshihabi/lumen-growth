import { useCallback, useEffect, useState } from 'react';
import { Card, cx } from './ui';
import { supabase } from '../lib/supabase';
import { fmtMoney } from '../lib/format';
import { useSession } from '../state/SessionContext';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/dict';
import type { RecAction, Recommendation } from '../rules/recommendations';
import { recKey } from '../rules/keys';

export interface AppliedRow {
  id: string;
  op: RecAction['op'];
  campaign_id: string;
  campaign_name: string | null;
  before: { status: string | null; daily_budget: number | null };
  after: { status: string | null; daily_budget: number | null };
  applied_at: string;
  undone_at?: string | null;
}

const KNOWN = [
  'budget_not_on_campaign',
  'budget_too_low',
  'budget_change_too_big',
  'meta_reconnect_required',
  'meta_not_connected',
  'campaign_not_in_workspace',
  'viewer_read_only',
  'subscription_inactive',
  'meta_permission_denied',
  'meta_token_invalid',
];

async function errorText(error: unknown, t: (k: DictKey, v?: Record<string, string | number>) => string): Promise<string> {
  let code = '';
  let message = error instanceof Error ? error.message : String(error);
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const j = (await ctx.json()) as { error?: string; message?: string };
      code = j.error ?? '';
      message = j.message ?? message;
    } catch {
      /* not JSON */
    }
  }
  const hit = KNOWN.find((k) => k === code || message.includes(k));
  return hit ? t(`apply.err.${hit}` as DictKey) : message;
}

/** One line per change: "Pause X", "X daily budget 8,000 -> 6,400". */
/** "from -> to" reads right-to-left in Arabic, so the arrow must point left there. */
const arrow = (lang: string) => (lang === 'ar' ? '←' : '→');

export function ActionLine({ a }: { a: RecAction }) {
  const { t, lang } = useI18n();
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-medium">
        <bdi>{a.campaignName}</bdi>
      </span>
      {a.op === 'set_daily_budget' ? (
        <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
          {t('apply.budget')}: <bdi>{fmtMoney(a.from)}</bdi> {arrow(lang)} <bdi className="font-semibold text-zinc-900 dark:text-zinc-50">{fmtMoney(a.to)}</bdi>
        </span>
      ) : (
        <span className={cx('font-semibold', a.op === 'pause' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300')}>
          {t(a.op === 'pause' ? 'apply.pause' : 'apply.activate')}
        </span>
      )}
    </li>
  );
}

/** Confirmation dialog; on success calls onApplied with the logged rows. */
export function ApplyDialog({ rec, onClose, onApplied }: { rec: Recommendation; onClose: () => void; onApplied: (rows: AppliedRow[]) => void }) {
  const { t } = useI18n();
  const { mode, workspace } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = rec.actions ?? [];
  const startsSpending = actions.some((a) => a.op === 'activate');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    if (mode !== 'live' || !supabase) {
      // Demo: show what would happen, change nothing.
      const now = new Date().toISOString();
      onApplied(
        actions.map((a, i) => ({
          id: `demo-${Date.now()}-${i}`,
          op: a.op,
          campaign_id: a.campaignId,
          campaign_name: a.campaignName,
          before: { status: a.op === 'activate' ? 'PAUSED' : 'ACTIVE', daily_budget: a.op === 'set_daily_budget' ? a.from : null },
          after: { status: a.op === 'pause' ? 'PAUSED' : 'ACTIVE', daily_budget: a.op === 'set_daily_budget' ? a.to : null },
          applied_at: now,
        })),
      );
      return;
    }
    const { data, error: e } = await supabase.functions.invoke('meta-apply', {
      body: {
        action: 'apply',
        workspace_id: workspace?.id,
        rec_key: recKey(rec),
        actions: actions.map((a) => ({ op: a.op, campaignId: a.campaignId, campaignName: a.campaignName, to: a.op === 'set_daily_budget' ? a.to : undefined })),
      },
    });
    setBusy(false);
    if (e) return setError(await errorText(e, t));
    onApplied((data as { applied: AppliedRow[] }).applied);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="apply-title">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <h2 id="apply-title" className="text-lg font-bold">
          {t('apply.confirmTitle')}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{t('apply.confirmBody')}</p>
        <ul className="mt-4 space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
          {actions.map((a, i) => (
            <ActionLine key={i} a={a} />
          ))}
        </ul>
        {startsSpending && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">⚠️ {t('apply.startsSpending')}</p>}
        {rec.warningMsg && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">⚠️ {t(rec.warningMsg.key, rec.warningMsg.vars)}</p>}
        {mode !== 'live' && <p className="mt-3 text-xs text-zinc-500">{t('apply.demo')}</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={cx('rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-60', startsSpending ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-600 hover:bg-brand-700')}
          >
            {busy ? t('apply.applying') : t('apply.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Recent changes" with undo. Live: from applied_actions; demo: what was applied in this tab. */
export function AppliedList({ local, onUndone }: { local: AppliedRow[]; onUndone: (id: string) => void }) {
  const { t, locale, lang } = useI18n();
  const { mode, workspace, canEdit } = useSession();
  const live = mode === 'live' && !!supabase;
  const [rows, setRows] = useState<AppliedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!live || !workspace) return;
    const { data } = await supabase!
      .from('applied_actions')
      .select('id, op, campaign_id, campaign_name, before, after, applied_at, undone_at')
      .eq('workspace_id', workspace.id)
      .order('applied_at', { ascending: false })
      .limit(15);
    setRows((data as AppliedRow[]) ?? []);
  }, [live, workspace]);

  useEffect(() => {
    void load();
  }, [load, local.length]);

  const list = live ? rows : local;
  if (!list.length) return null;

  const undo = async (r: AppliedRow) => {
    setError(null);
    if (!live) return onUndone(r.id);
    setBusy(r.id);
    const { error: e } = await supabase!.functions.invoke('meta-apply', { body: { action: 'undo', workspace_id: workspace?.id, action_id: r.id } });
    setBusy(null);
    if (e) return setError(await errorText(e, t));
    onUndone(r.id);
    void load();
  };

  const describe = (r: AppliedRow) =>
    r.op === 'set_daily_budget'
      ? `${t('apply.budget')}: ${fmtMoney(r.before.daily_budget ?? 0)} ${arrow(lang)} ${fmtMoney(r.after.daily_budget ?? 0)}`
      : t(r.op === 'pause' ? 'apply.paused' : 'apply.activated');

  return (
    <Card className="mt-4" title={t('apply.recent')}>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {list.map((r) => (
          <li key={r.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3 text-sm', r.undone_at && 'opacity-50')}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                <bdi>{r.campaign_name ?? r.campaign_id}</bdi>
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                <bdi>{describe(r)}</bdi> · {new Date(r.applied_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                {r.undone_at ? ` · ${t('apply.undone')}` : ''}
              </div>
            </div>
            {!r.undone_at && canEdit && (
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void undo(r)}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t('apply.undo')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="border-t border-zinc-100 px-4 py-2 text-sm text-red-600 dark:border-zinc-800">{error}</p>}
    </Card>
  );
}
