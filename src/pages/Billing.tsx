import { useEffect, useState } from 'react';
import { Card, PageHeader, cx } from '../components/ui';
import { PlanCards } from '../components/PlanCards';
import { env, supabase } from '../lib/supabase';
import { formatPlanPrice, type Plan } from '../lib/plans';
import { formatDateTime } from '../lib/dates';
import { useSession } from '../state/SessionContext';
import { useI18n } from '../i18n';

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

const btn = 'flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';

export default function Billing() {
  const { t, lang, locale } = useI18n();
  const session = useSession();
  const { entitlements: ent, subscription, workspace, plans, mode } = session;
  const [payments, setPayments] = useState<PaymentRow[]>([]);
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
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{env.paymobEnabled ? t('billing.paymobMethods') : t('billing.paymobSoon')}</p>
      <PlanCards
        plans={paid}
        currentPlanId={plan?.id}
        action={(p) => (
          <button
            type="button"
            onClick={() => void payWithPaymob(p)}
            disabled={!live || !env.paymobEnabled || busy !== null}
            className={cx(btn, p.tier === 'growth' ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800')}
          >
            {busy === p.id ? t('billing.redirecting') : t('billing.payPaymob')}
          </button>
        )}
      />
      {error && <p className="mt-3 text-sm text-red-600">{t('common.error', { message: error })}</p>}

      <Card className="mt-6" title={t('billing.manualTitle')}>
        <ol className="list-decimal space-y-3 px-4 py-4 ps-9 text-sm text-zinc-700 dark:text-zinc-200">
          <li>
            {t('billing.manualStep1')}
            <ul className="mt-1.5 space-y-1 text-zinc-600 dark:text-zinc-300">
              <li>
                <span className="font-medium">{t('billing.manualInstapay')}:</span> <span dir="ltr">{env.instapayAddress || t('billing.manualNotSet')}</span>
              </li>
              <li>
                <span className="font-medium">{t('billing.manualWallet')}:</span> <span dir="ltr">{env.walletNumber || t('billing.manualNotSet')}</span>
              </li>
            </ul>
          </li>
          <li>
            {t('billing.manualStep2')}{' '}
            {whatsapp ? (
              <a className="font-medium text-brand-700 hover:underline dark:text-brand-300" dir="ltr" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">
                +{whatsapp}
              </a>
            ) : (
              t('billing.manualNotSet')
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

      {session.role === 'owner' && plan?.id !== 'free' && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t('billing.downgrade')}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('billing.downgradeBody')}</div>
            </div>
            <button
              type="button"
              onClick={() => void downgrade()}
              disabled={!live || busy !== null}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t('billing.downgrade')}
            </button>
          </div>
        </Card>
      )}

      {live && (
        <Card className="mt-6" title={t('billing.history')}>
          {payments.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">{t('billing.noPayments')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-zinc-100 first:border-0 dark:border-zinc-800">
                      <td className="px-4 py-2.5">{formatDateTime(p.created_at, true)}</td>
                      <td className="px-4 py-2.5">{p.plan_id}</td>
                      <td className="px-4 py-2.5">{p.provider}</td>
                      <td className="px-4 py-2.5 text-end tabular-nums">{formatPlanPrice({ price_minor: p.amount_minor, currency: p.currency }, locale)}</td>
                      <td className="px-4 py-2.5">{p.status}</td>
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
