// Paymob Intention API client (Edge Functions only).
import { HttpError, env } from './http.ts';

// VERIFY: regional API hosts. Egypt: accept.paymob.com, KSA: ksa.paymob.com,
// UAE: uae.paymob.com, Oman: oman.paymob.com. Override with PAYMOB_API_BASE.
export function paymobBase(): string {
  return (Deno.env.get('PAYMOB_API_BASE') ?? 'https://accept.paymob.com').replace(/\/$/, '');
}

export interface IntentionInput {
  amountMinor: number;
  currency: string;
  integrationIds: number[];
  itemName: string;
  itemDescription: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  specialReference: string;
  notificationUrl: string;
  redirectionUrl: string;
  extras: Record<string, string>;
}

export interface IntentionResult {
  id: string;
  clientSecret: string;
  orderId: string | null;
  raw: Record<string, unknown>;
}

export function parseIntegrationIds(raw: string): number[] {
  const ids = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => Number(s));
  if (!ids.length || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new HttpError(500, 'bad_integration_ids', 'PAYMOB_INTEGRATION_IDS must be a comma-separated list of numeric integration IDs');
  }
  return ids;
}

export async function createIntention(input: IntentionInput): Promise<IntentionResult> {
  // VERIFY: endpoint path (POST /v1/intention/), "Token <secret key>" auth scheme,
  // and the request body shape below against developers.paymob.com "Create Intention".
  const res = await fetch(`${paymobBase()}/v1/intention/`, {
    method: 'POST',
    headers: { Authorization: `Token ${env('PAYMOB_SECRET_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amountMinor, // VERIFY: amount in cents/piasters (integer)
      currency: input.currency,
      payment_methods: input.integrationIds, // card, wallet (Vodafone Cash...), Fawry... integration IDs
      items: [{ name: input.itemName, amount: input.amountMinor, description: input.itemDescription, quantity: 1 }],
      // VERIFY: which billing_data fields are mandatory; Paymob historically accepts "NA" for unknown values.
      billing_data: {
        first_name: input.firstName || 'NA',
        last_name: input.lastName || 'NA',
        email: input.email,
        phone_number: input.phone || 'NA',
        apartment: 'NA',
        floor: 'NA',
        street: 'NA',
        building: 'NA',
        city: 'NA',
        state: 'NA',
        country: 'EG',
      },
      special_reference: input.specialReference, // VERIFY: must be unique per intention
      notification_url: input.notificationUrl, // VERIFY: per-intention override of the dashboard callback URL
      redirection_url: input.redirectionUrl,
      extras: input.extras,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.client_secret !== 'string') {
    console.error('Paymob intention failed', res.status, body);
    throw new HttpError(502, 'paymob_error', `Paymob rejected the payment intention (HTTP ${res.status})`);
  }
  return {
    id: String(body.id ?? ''),
    clientSecret: body.client_secret as string,
    // VERIFY: response field name for the order id that later appears as obj.order.id in the webhook.
    orderId: body.intention_order_id != null ? String(body.intention_order_id) : null,
    raw: { id: body.id, intention_order_id: body.intention_order_id, status: body.status },
  };
}

/** Hosted "Unified Checkout" page for an intention. */
export function unifiedCheckoutUrl(publicKey: string, clientSecret: string): string {
  // VERIFY: unified checkout URL format.
  const p = new URLSearchParams({ publicKey, clientSecret });
  return `${paymobBase()}/unifiedcheckout/?${p.toString()}`;
}
