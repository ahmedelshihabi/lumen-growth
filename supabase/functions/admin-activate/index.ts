// POST (platform admin only)
// { workspace_id, plan_id, months?: 1-12, method: 'instapay'|'vodafone_cash'|'bank'|'other',
//   reference?: string, amount_minor?: number, currency?: string, idempotency_key: string }
// Records a manual payment (InstaPay / Vodafone Cash transfer) and activates or
// extends the subscription. The fallback until Paymob is approved.
import { HttpError, adminClient, json, loadSubscription, readJson, requireUser, serve, type PlanRow } from '../_shared/http.ts';
import { nextPeriodEnd, periodDaysForMonths } from '../_shared/period.ts';

interface Body {
  workspace_id?: string;
  plan_id?: string;
  months?: number;
  method?: string;
  reference?: string;
  amount_minor?: number;
  currency?: string;
  note?: string;
  idempotency_key?: string;
}

const METHODS = ['instapay', 'vodafone_cash', 'bank', 'other'];

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);

  const { data: profile } = await admin.from('profiles').select('is_platform_admin').eq('id', user.id).maybeSingle();
  if (!profile?.is_platform_admin) throw new HttpError(403, 'not_platform_admin');

  const b = await readJson<Body>(req);
  if (!b.workspace_id || !b.plan_id || !b.idempotency_key) throw new HttpError(400, 'missing_fields');
  if (!METHODS.includes(b.method ?? '')) throw new HttpError(400, 'invalid_method');
  if (!/^[\w-]{8,80}$/.test(b.idempotency_key)) throw new HttpError(400, 'invalid_idempotency_key');

  const { data: plan } = await admin.from('plans').select('*').eq('id', b.plan_id).maybeSingle<PlanRow>();
  if (!plan) throw new HttpError(400, 'unknown_plan');
  const { data: ws } = await admin.from('workspaces').select('id').eq('id', b.workspace_id).maybeSingle();
  if (!ws) throw new HttpError(404, 'unknown_workspace');

  let days: number;
  try {
    days = periodDaysForMonths(b.months ?? 1);
  } catch {
    throw new HttpError(400, 'invalid_months');
  }
  const amount = Number.isInteger(b.amount_minor) && b.amount_minor! >= 0 ? b.amount_minor! : plan.price_minor * (days / 30);
  const merchantRef = `manual:${b.idempotency_key}`;

  // Replay of the same click/request: report the existing result.
  const { data: existing } = await admin.from('payments').select('id, status, period_end').eq('merchant_ref', merchantRef).maybeSingle();
  if (existing?.status === 'paid') return json({ status: 'duplicate', period_end: existing.period_end });

  let paymentId = existing?.id as string | undefined;
  if (!paymentId) {
    const { data: inserted, error } = await admin
      .from('payments')
      .insert({
        workspace_id: b.workspace_id,
        plan_id: plan.id,
        provider: 'manual',
        amount_minor: amount,
        currency: (b.currency ?? plan.currency).toUpperCase(),
        status: 'pending',
        merchant_ref: merchantRef,
        period_days: days,
        note: b.note?.slice(0, 500) ?? null,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return json({ status: 'duplicate' });
      throw error;
    }
    paymentId = inserted.id as string;
  }

  const sub = await loadSubscription(admin, b.workspace_id);
  const samePlanRunning = sub && (sub.status === 'active' || sub.status === 'trialing') && sub.current_period_end;
  const periodEnd = nextPeriodEnd(samePlanRunning ? new Date(sub!.current_period_end!) : null, new Date(), days);

  const { data: result, error: rpcErr } = await admin.rpc('apply_paid_payment', {
    p_payment_id: paymentId,
    p_provider_ref: b.reference?.trim() || merchantRef,
    p_raw: { method: b.method, reference: b.reference ?? null, activated_by: user.id, months: b.months ?? 1 },
    p_period_end: periodEnd.toISOString(),
  });
  if (rpcErr) {
    // unique (provider, provider_ref): this transfer reference was already used to activate.
    if (rpcErr.code === '23505') throw new HttpError(409, 'reference_already_used');
    throw rpcErr;
  }
  return json({ status: result, period_end: periodEnd.toISOString() });
});
