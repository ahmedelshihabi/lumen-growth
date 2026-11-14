// POST { plan_id, workspace_id? } with the user's JWT -> { url }
// Creates a pending payment row and a Paymob payment intention, and returns the
// hosted Unified Checkout URL to redirect the browser to.
import { HttpError, adminClient, env, json, readJson, requireUser, resolveWorkspace, serve, type PlanRow } from '../_shared/http.ts';
import { createIntention, parseIntegrationIds, unifiedCheckoutUrl } from '../_shared/paymob.ts';

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<{ plan_id?: string; workspace_id?: string; phone?: string }>(req);
  const { workspaceId } = await resolveWorkspace(admin, user.id, body.workspace_id);

  const { data: plan, error: planErr } = await admin.from('plans').select('*').eq('id', body.plan_id ?? '').maybeSingle<PlanRow>();
  if (planErr) throw planErr;
  if (!plan || !plan.is_public) throw new HttpError(400, 'unknown_plan');
  if (plan.price_minor <= 0) throw new HttpError(400, 'plan_is_free');

  const merchantRef = crypto.randomUUID();
  const { data: payment, error: payErr } = await admin
    .from('payments')
    .insert({
      workspace_id: workspaceId,
      plan_id: plan.id,
      provider: 'paymob',
      amount_minor: plan.price_minor,
      currency: plan.currency,
      status: 'pending',
      merchant_ref: merchantRef,
      period_days: plan.interval_days,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (payErr) throw payErr;

  const supabaseUrl = env('SUPABASE_URL');
  const appUrl = env('APP_URL').replace(/\/$/, '');
  const fullName = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? '').trim();
  const [firstName, ...rest] = fullName.split(/\s+/);

  const intention = await createIntention({
    amountMinor: plan.price_minor,
    currency: plan.currency,
    integrationIds: parseIntegrationIds(env('PAYMOB_INTEGRATION_IDS')),
    itemName: `Lumen Growth ${plan.name_en} - ${plan.interval_days} days`,
    itemDescription: `Workspace ${workspaceId}`,
    email: user.email ?? 'NA',
    firstName: firstName ?? '',
    lastName: rest.join(' '),
    phone: body.phone ?? user.phone ?? '',
    specialReference: merchantRef,
    notificationUrl: `${supabaseUrl}/functions/v1/paymob-webhook`,
    redirectionUrl: `${appUrl}/app/billing?checkout=done`,
    extras: { workspace_id: workspaceId, plan_id: plan.id, payment_id: payment.id as string },
  });

  await admin
    .from('payments')
    .update({ provider_order_id: intention.orderId, raw: { intention: intention.raw } })
    .eq('id', payment.id);

  return json({ url: unifiedCheckoutUrl(env('PAYMOB_PUBLIC_KEY'), intention.clientSecret), payment_id: payment.id });
});
