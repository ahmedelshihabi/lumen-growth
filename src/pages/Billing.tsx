import { useEffect, useState } from 'react';
import { Card, PageHeader, cx } from '../components/ui';
import { PlanCards } from '../components/PlanCards';
import { env, supabase } from '../lib/supabase';
import { formatPlanPrice, type Plan } from '../lib/plans';
import { formatDateTime } from '../lib/dates';
import { useSession } from '../state/SessionContext';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/dict';

interface PaymentRow {
  id: string;
  created_at: string;
  provider: 'paymob' | 'manual';
  plan_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  period_end: string | null;
}

const PAY_STATUS = ['pending', 'paid', 'failed', 'refunded', 'cancelled'];

/** Demo mode: a sample of what the history looks like (nothing is stored). */
const DEMO_PAYMENTS: PaymentRow[] = [
  { id: 'd2', created_at: new Date(Date.now() - 2 * 86400000).toISOString(), provider: 'manual', plan_id: 'growth', amount_minor: 249900, currency: 'EGP', status: 'paid', period_end: null },
  { id: 'd1', created_at: new Date(Date.now() - 32 * 86400000).toISOString(), provider: 'manual', plan_id: 'starter', amount_minor: 99900, currency: 'EGP', status: 'paid', period_end: null },
];

const btn = 'flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export default function Billing() {
  const { t, lang, locale } = useI18n();
  const session = useSession();
  const { entitlements: ent, subscription, workspace, plans, mode } = session;
  const [payments, setPayments] = useState<PaymentRow[]>(() => (mode === 'demo' ? DEMO_PAYMENTS : []));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const planName = (id: string) => {
    const p = plans.find((x) => x.id === id);
    return p ? (lang === 'ar' ? p.name_ar : p.name_en) : id;
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const checkoutDone = new URLSearchParams(window.location.search).get('checkout') === 'done';
  const live = mode === 'live' && !!supabase;

  useEffect(() => {
    if (!live || !workspace) return;
    let alive = true;
    void supabase!
      .from('payments')
      .select('id, created_at, provider, plan_id, amount_minor, currency, status, period_end')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => alive && setPayments((data as PaymentRow[]) ?? []));
    // After returning from Paymob the webhook may land a few seconds later.
    const timer = checkoutDone ? window.setTimeout(() => void session.refresh(), 4000) : undefined;
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, workspace?.id, checkoutDone]);

  const payWithPaymob = async (plan: Plan) => {
    if (!live) return;
    setBusy(plan.id);
    setError(null);
    const { data, error } = await supabase!.functions.invoke<{ url: string }>('paymob-checkout', {
      body: { plan_id: plan.id, workspace_id: workspace?.id },
    });
    if (error || !data?.url) {
      setBusy(null);
      setError(error?.message ?? 'checkout_failed');
      return;
    }
    window.location.assign(data.url);
  };

  const downgrade = async () => {
    if (!live || !workspace) return;
    setBusy('free');
    const { error } = await supabase!.rpc('downgrade_to_free', { ws: workspace.id });
    setBusy(null);
    if (error) setError(error.message);
    else await session.refresh();
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(workspace?.id ?? '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const plan = ent.plan;
  const statusKey = !ent.active ? 'locked' : (subscription?.status ?? 'active');
  const statusCls = !ent.active
    ? 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300'
    : ent.trialing
      ? 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300'
      : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300';
  const end = subscription?.current_period_end ?? null;

  let periodText: string;
  if (!end) periodText = t('billing.noExpiry');
  else if (!ent.active) periodText = t('billing.expired', { date: formatDateTime(end) });
  else if (ent.trialing) periodText = t('billing.trialLeft', { n: ent.daysLeft ?? 0 });
  else periodText = t('billing.renewsIn', { date: formatDateTime(end), n: ent.daysLeft ?? 0 });

  const paid = plans.filter((p) => p.price_minor > 0 && p.currency === (plan?.currency ?? 'EGP'));
  const whatsapp = env.supportWhatsapp.replace(/[^\d]/g, '');
  // The transfer flow needs somewhere to send money AND a way to tell us about it.
  const manualReady = Boolean((env.instapayAddress || env.walletNumber) && whatsapp);

  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />

      {checkoutDone && (
        <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          {t('billing.checkoutDone')}
        </div>
      )}
      {mode === 'demo' && <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t('billing.demoNote')}</p>}

      <Card title={t('billing.currentPlan')}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{plan ? (lang === 'ar' ? plan.name_ar : plan.name_en) : '-'}</span>
              <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', statusCls)}>{t(`billing.status.${statusKey}` as 'billing.status.active')}</span>
            </div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{periodText}</div>
          </div>
          {plan && (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">{t('billing.limits', { accounts: plan.max_ad_accounts, members: plan.max_members })}</div>
          )}
          {plan && plan.price_minor > 0 && <div className="ms-auto text-sm font-semibold tabular-nums">{formatPlanPrice(plan, locale)} {t('common.perMonth')}</div>}
        </div>
      </Card>

      <h2 className="mb-3 mt-8 text-base font-semibold">{t('billing.choosePlan')}</h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{env.paymobEnabled ? t('billing.paymobMethods') : t('billing.manualOnly')}</p>
      <PlanCards
        plans={paid}
        currentPlanId={plan?.id}
        action={(p) => {
          const cls = cx(btn, p.tier === 'growth' ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800');
          // Paymob stays wired but hidden until VITE_PAYMOB_ENABLED=true; until then plans are bought by transfer.
          return env.paymobEnabled ? (
            <button type="button" onClick={() => void payWithPaymob(p)} disabled={!live || busy !== null} className={cls}>
              {busy === p.id ? t('billing.redirecting') : t('billing.payPaymob')}
            </button>
          ) : manualReady ? (
            <a href="#manual-payment" className={cx(cls, 'text-center')}>
              {t('billing.payManual')}
            </a>
          ) : null;
        }}
      />
      {error && <p className="mt-3 text-sm text-red-600">{t('common.error', { message: error })}</p>}

      {/* Only methods that are actually configured are shown (TODO(owner): set VITE_MANUAL_INSTAPAY,
          VITE_MANUAL_WALLET and VITE_SUPPORT_WHATSAPP in Vercel). Nothing is ever shown as "to be announced". */}
      {!manualReady && session.profile?.is_platform_admin && (
        <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{t('billing.adminSetNumbers')}</p>
      )}
      {manualReady && (
      <Card className="mt-6" title={t('billing.manualTitle')}>
        <ol id="manual-payment" className="list-decimal space-y-3 px-4 py-4 ps-9 text-sm text-zinc-700 dark:text-zinc-200">
          {(env.instapayAddress || env.walletNumber) && (
          <li>
            {t('billing.manualStep1')}
            <ul className="mt-1.5 space-y-1 text-zinc-600 dark:text-zinc-300">
              {env.instapayAddress && (
                <li>
                  <span className="font-medium">{t('billing.manualInstapay')}:</span> <span dir="ltr">{env.instapayAddress}</span>
                </li>
              )}
              {env.walletNumber && (
                <li>
                  <span className="font-medium">{t('billing.manualWallet')}:</span> <span dir="ltr">{env.walletNumber}</span>
                </li>
              )}
            </ul>
          </li>
          )}
          <li>
            {whatsapp ? (
              <>
                {t('billing.manualStep2')}{' '}
                <a className="font-medium text-brand-700 hover:underline dark:text-brand-300" dir="ltr" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">
                  +{whatsapp}
                </a>
              </>
            ) : (
              t('billing.manualStep2NoWa')
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">{t('billing.workspaceId')}</span>
              <code dir="ltr" className="rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                {workspace?.id}
              </code>
              <button type="button" onClick={() => void copyId()} className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {copied ? t('billing.copied') : t('billing.copy')}
              </button>
            </div>
          </li>
          <li>{t('billing.manualStep3')}</li>
        </ol>
      </Card>
      )}

      {session.role === 'owner' && plan?.id !== 'free' && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t(ent.trialing ? 'billing.downgrade' : 'billing.cancel')}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{t(ent.trialing ? 'billing.downgradeBody' : 'billing.cancelBody')}</div>
            </div>
            {confirmCancel ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-red-700 dark:text-red-300">{t('billing.cancelConfirm', { plan: lang === 'ar' ? plan?.name_ar ?? '' : plan?.name_en ?? '' })}</span>
                <button
                  type="button"
                  onClick={() => void downgrade().then(() => setConfirmCancel(false))}
                  disabled={!live || busy !== null}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {t('billing.cancelYes')}
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                disabled={!live || busy !== null}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t(ent.trialing ? 'billing.downgrade' : 'billing.cancel')}
              </button>
            )}
          </div>
        </Card>
      )}

      {(live || payments.length > 0) && (
        <Card className="mt-6" title={t('billing.history')}>
          {payments.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">{t('billing.noPayments')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">{t('billing.h.date')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('billing.h.plan')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('billing.h.method')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('billing.h.amount')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('billing.h.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-zinc-100 first:border-0 dark:border-zinc-800">
                      <td className="px-4 py-2.5">{formatDateTime(p.created_at, true)}</td>
                      <td className="px-4 py-2.5">{planName(p.plan_id)}</td>
                      <td className="px-4 py-2.5">{t(p.provider === 'paymob' ? 'billing.provider.paymob' : 'billing.provider.manual')}</td>
                      <td className="px-4 py-2.5 text-end tabular-nums">{formatPlanPrice({ price_minor: p.amount_minor, currency: p.currency }, locale)}</td>
                      <td className="px-4 py-2.5">{PAY_STATUS.includes(p.status) ? t(`billing.payStatus.${p.status}` as DictKey) : p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
