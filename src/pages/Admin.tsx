import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, cx } from '../components/ui';
import { IconLogo } from '../components/icons';
import { Link } from '../lib/router';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/dates';
import { formatPlanPrice } from '../lib/plans';
import { computeEntitlements, type SubscriptionInfo } from '../lib/entitlements';
import { useSession } from '../state/SessionContext';
import { LanguageToggle, useI18n } from '../i18n';

interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  ownerEmail: string | null;
  subscription: SubscriptionInfo | null;
}

interface PaymentRow {
  id: string;
  workspace_id: string;
  provider: string;
  plan_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider_ref: string | null;
  created_at: string;
}

const METHODS = ['instapay', 'vodafone_cash', 'bank', 'other'] as const;
const DAY = 86_400_000;

function demoRows(): WorkspaceRow[] {
  const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString();
  return [
    { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Nile Fashion', owner_id: 'u1', created_at: iso(-20), ownerEmail: 'owner@nilefashion.example', subscription: { plan_id: 'growth', status: 'trialing', trial_ends_at: iso(-6), current_period_end: iso(-6) } },
    { id: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Cairo Bites', owner_id: 'u2', created_at: iso(-45), ownerEmail: 'ads@cairobites.example', subscription: { plan_id: 'starter', status: 'active', trial_ends_at: null, current_period_end: iso(17) } },
    { id: 'a1b2c3d4-0000-4000-8000-000000000003', name: 'Gulf Growth Agency', owner_id: 'u3', created_at: iso(-3), ownerEmail: 'team@gulfgrowth.example', subscription: { plan_id: 'growth', status: 'trialing', trial_ends_at: iso(11), current_period_end: iso(11) } },
  ];
}

export default function Admin() {
  const { t, lang, locale } = useI18n();
  const session = useSession();
  const live = session.mode === 'live' && !!supabase;
  const [rows, setRows] = useState<WorkspaceRow[]>(() => (live ? [] : demoRows()));
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ plan_id: 'starter', months: 1, method: 'instapay' as (typeof METHODS)[number], reference: '', amount: '', key: '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!live) return;
    const [ws, subs, profiles, pays] = await Promise.all([
      supabase!.from('workspaces').select('id, name, owner_id, created_at').order('created_at', { ascending: false }).limit(500),
      supabase!.from('subscriptions').select('workspace_id, plan_id, status, trial_ends_at, current_period_end'),
      supabase!.from('profiles').select('id, email'),
      supabase!.from('payments').select('id, workspace_id, provider, plan_id, amount_minor, currency, status, provider_ref, created_at').order('created_at', { ascending: false }).limit(30),
    ]);
    const subOf = new Map((subs.data ?? []).map((s) => [s.workspace_id as string, s as unknown as SubscriptionInfo]));
    const emailOf = new Map((profiles.data ?? []).map((p) => [p.id as string, p.email as string | null]));
    setRows(
      (ws.data ?? []).map((w) => ({
        ...(w as Omit<WorkspaceRow, 'ownerEmail' | 'subscription'>),
        ownerEmail: emailOf.get(w.owner_id as string) ?? null,
        subscription: subOf.get(w.id as string) ?? null,
      })),
    );
    setPayments((pays.data as PaymentRow[]) ?? []);
  }, [live]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => [r.name, r.ownerEmail ?? '', r.id].some((v) => v.toLowerCase().includes(q))) : rows;
  }, [rows, query]);

  const openForm = (r: WorkspaceRow) => {
    setMessage(null);
    setOpenId(openId === r.id ? null : r.id);
    const plan = session.plans.find((p) => p.id === (r.subscription?.plan_id ?? 'starter' )) ?? session.plans[1];
    const planId = plan && plan.price_minor > 0 ? plan.id : 'starter';
    const price = session.plans.find((p) => p.id === planId)?.price_minor ?? 0;
    // A fresh idempotency key per opened form: double clicks / retries cannot double-activate.
    setForm({ plan_id: planId, months: 1, method: 'instapay', reference: '', amount: String(price / 100), key: crypto.randomUUID() });
  };

  const activate = async (workspaceId: string) => {
    if (!live) return;
    setBusy(true);
    setMessage(null);
    const amount = Number(form.amount);
    const { data, error } = await supabase!.functions.invoke<{ status: string; period_end?: string }>('admin-activate', {
      body: {
        workspace_id: workspaceId,
        plan_id: form.plan_id,
        months: form.months,
        method: form.method,
        reference: form.reference.trim() || undefined,
        amount_minor: Number.isFinite(amount) && form.amount !== '' ? Math.round(amount * 100) : undefined,
        idempotency_key: form.key,
      },
    });
    setBusy(false);
    if (error) setMessage({ ok: false, text: t('common.error', { message: error.message }) });
    else if (data?.status === 'duplicate') setMessage({ ok: true, text: t('admin.duplicate') });
    else setMessage({ ok: true, text: t('admin.activated', { date: formatDateTime(data?.period_end) }) });
    await load();
  };

  const forbidden = !session.profile?.is_platform_admin;
  const input = 'h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/app" className="flex items-center gap-2 text-sm font-semibold">
            <IconLogo width={22} height={22} /> {t('app.name')}
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <Link href="/app" className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
              {t('common.backToApp')}
            </Link>
            <LanguageToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />
        {forbidden ? (
          <Card className="p-6 text-sm">{t('admin.forbidden')}</Card>
        ) : (
          <>
            {!live && <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t('admin.demoNote')}</p>}
            <Card>
              <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('admin.search')} aria-label={t('admin.search')} className={`${input} sm:w-80`} />
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {shown.map((r) => {
                  const e = computeEntitlements(r.subscription, session.plans);
                  const plan = e.plan;
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{r.name}</div>
                          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400" dir="ltr">
                            {r.ownerEmail ?? r.owner_id} · {r.id}
                          </div>
                        </div>
                        <div className="text-sm">{plan ? (lang === 'ar' ? plan.name_ar : plan.name_en) : '-'}</div>
                        <span
                          className={cx(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            e.active ? (e.trialing ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300') : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
                          )}
                        >
                          {t(`billing.status.${e.active ? r.subscription!.status : 'locked'}` as 'billing.status.active')}
                        </span>
                        <div className="w-36 text-xs text-zinc-500 dark:text-zinc-400">
                          {t('admin.periodEnd')}: {r.subscription?.current_period_end ? formatDateTime(r.subscription.current_period_end) : '∞'}
                        </div>
                        <button type="button" onClick={() => openForm(r)} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
                          {t('admin.activate')}
                        </button>
                      </div>
                      {openId === r.id && (
                        <form
                          className="mt-3 grid gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
                          onSubmit={(ev) => {
                            ev.preventDefault();
                            void activate(r.id);
                          }}
                        >
                          <label className="text-xs font-medium">
                            {t('admin.plan')}
                            <select className={`${input} mt-1`} value={form.plan_id} onChange={(ev) => setForm({ ...form, plan_id: ev.target.value })}>
                              {session.plans.filter((p) => p.price_minor > 0).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {(lang === 'ar' ? p.name_ar : p.name_en) + ' - ' + formatPlanPrice(p, locale)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs font-medium">
                            {t('admin.months')}
                            <input type="number" min={1} max={12} className={`${input} mt-1`} value={form.months} onChange={(ev) => setForm({ ...form, months: Math.max(1, Math.min(12, Number(ev.target.value) || 1)) })} />
                          </label>
                          <label className="text-xs font-medium">
                            {t('admin.method')}
                            <select className={`${input} mt-1`} value={form.method} onChange={(ev) => setForm({ ...form, method: ev.target.value as (typeof METHODS)[number] })}>
                              {METHODS.map((m) => (
                                <option key={m} value={m}>
                                  {t(`admin.method.${m}`)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs font-medium">
                            {t('admin.reference')}
                            <input className={`${input} mt-1`} dir="ltr" value={form.reference} onChange={(ev) => setForm({ ...form, reference: ev.target.value })} />
                          </label>
                          <label className="text-xs font-medium">
                            {t('admin.amount')}
                            <input type="number" min={0} step="0.01" className={`${input} mt-1`} value={form.amount} onChange={(ev) => setForm({ ...form, amount: ev.target.value })} />
                          </label>
                          <button type="submit" disabled={!live || busy} className="h-9 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                            {t('admin.confirm')}
                          </button>
                          {message && <p className={cx('text-sm sm:col-span-2 lg:col-span-6', message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600')}>{message.text}</p>}
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>

            {live && (
              <Card className="mt-6" title={t('admin.recentPayments')}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-t border-zinc-100 first:border-0 dark:border-zinc-800">
                          <td className="px-4 py-2">{formatDateTime(p.created_at, true)}</td>
                          <td className="px-4 py-2 text-xs" dir="ltr">{p.workspace_id.slice(0, 8)}</td>
                          <td className="px-4 py-2">{p.provider}</td>
                          <td className="px-4 py-2">{p.plan_id}</td>
                          <td className="px-4 py-2 text-end tabular-nums">{formatPlanPrice({ price_minor: p.amount_minor, currency: p.currency }, locale)}</td>
                          <td className="px-4 py-2">{p.status}</td>
                          <td className="px-4 py-2 text-xs" dir="ltr">{p.provider_ref ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
