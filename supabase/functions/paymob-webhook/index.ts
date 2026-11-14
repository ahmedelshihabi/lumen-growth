// Paymob "transaction processed" callback. Deployed with --no-verify-jwt
// (Paymob does not send a Supabase JWT); authenticity comes from the HMAC.
//
// Idempotent: the payment row flips pending -> paid once inside
// apply_paid_payment(); replays return 200 { status: 'duplicate' } and change nothing.
import { HttpError, adminClient, env, json, loadSubscription, serve } from '../_shared/http.ts';
import { verifyPaymobHmac } from '../_shared/paymob-hmac.ts';
import { nextPeriodEnd } from '../_shared/period.ts';

interface PaymobTxn {
  id: number | string;
  success: boolean;
  pending: boolean;
  is_refunded?: boolean;
  is_voided?: boolean;
  amount_cents: number;
  currency: string;
  order?: { id: number | string; merchant_order_id?: string | null };
  [k: string]: unknown;
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const url = new URL(req.url);
  const payload = (await req.json().catch(() => null)) as { type?: string; obj?: PaymobTxn } | null;
  if (!payload?.obj) throw new HttpError(400, 'invalid_payload');

  // VERIFY: Paymob sends the HMAC as ?hmac=... on the POST callback URL.
  const ok = await verifyPaymobHmac(payload.obj, url.searchParams.get('hmac'), env('PAYMOB_HMAC_SECRET'));
  if (!ok) throw new HttpError(401, 'invalid_hmac');

  // VERIFY: type is "TRANSACTION" for payment callbacks (others: "TOKEN", "DELIVERY_STATUS").
  if (payload.type && payload.type !== 'TRANSACTION') return json({ status: 'ignored', type: payload.type });

  const txn = payload.obj;
  const admin = adminClient();
  const orderId = txn.order?.id != null ? String(txn.order.id) : null;
  // VERIFY: with the Intention API the special_reference comes back as order.merchant_order_id.
  const merchantRef = txn.order?.merchant_order_id ?? null;

  let query = admin.from('payments').select('*').eq('provider', 'paymob').limit(1);
  if (merchantRef && orderId) query = query.or(`merchant_ref.eq.${merchantRef},provider_order_id.eq.${orderId}`);
  else if (merchantRef) query = query.eq('merchant_ref', merchantRef);
  else if (orderId) query = query.eq('provider_order_id', orderId);
  else return json({ status: 'unmatched' });

  const { data: payment, error } = await query.maybeSingle();
  if (error) throw error;
  if (!payment) {
    console.warn('Paymob callback for unknown order', orderId, merchantRef);
    return json({ status: 'unmatched' });
  }
  if (payment.status === 'paid') return json({ status: 'duplicate' });

  const raw = { ...(payment.raw ?? {}), transaction: txn };

  if (!txn.success || txn.pending || txn.is_voided || txn.is_refunded) {
    if (!txn.pending) {
      await admin.from('payments').update({ status: 'failed', raw }).eq('id', payment.id).eq('status', 'pending');
    }
    return json({ status: txn.pending ? 'pending' : 'failed' });
  }

  if (Number(txn.amount_cents) !== payment.amount_minor || String(txn.currency).toUpperCase() !== payment.currency) {
    await admin
      .from('payments')
      .update({ status: 'failed', raw, note: `amount_mismatch: got ${txn.amount_cents} ${txn.currency}` })
      .eq('id', payment.id)
      .eq('status', 'pending');
    return json({ status: 'amount_mismatch' });
  }

  const sub = await loadSubscription(admin, payment.workspace_id);
  const currentEnd = sub?.current_period_end && (sub.status === 'active' || sub.status === 'trialing') ? new Date(sub.current_period_end) : null;
  const periodEnd = nextPeriodEnd(currentEnd, new Date(), payment.period_days);

  const { data: result, error: rpcErr } = await admin.rpc('apply_paid_payment', {
    p_payment_id: payment.id,
    p_provider_ref: String(txn.id),
    p_raw: raw,
    p_period_end: periodEnd.toISOString(),
  });
  if (rpcErr) throw rpcErr;
  return json({ status: result, period_end: periodEnd.toISOString() });
});
