/**
 * Paymob "transaction processed" callback HMAC verification. Pure Web Crypto,
 * so it runs in Deno (Edge Functions) and in Node 22 (Vitest).
 *
 * Paymob signs the callback with HMAC-SHA512 (key = the HMAC secret from the
 * dashboard) over the concatenated VALUES of a fixed list of fields, taken in
 * the fixed (alphabetical) order below. The hex digest arrives as the `hmac`
 * query-string parameter of the POST callback.
 */

// VERIFY: field list and order against developers.paymob.com "HMAC calculation"
// (transaction processed callback). Note Paymob's own spelling "error_occured".
export const PAYMOB_TRANSACTION_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Reads 'a.b' from a nested object; also accepts flat keys ('order' or 'source_data.pan') as sent in redirect query strings. */
function pick(obj: Record<string, unknown>, path: string): unknown {
  if (path in obj) {
    const v = obj[path];
    // In the POST body `order` is an object; the HMAC uses its id.
    if (path === 'order.id' && v && typeof v === 'object') return (v as Record<string, unknown>).id;
    return v;
  }
  const [head, ...rest] = path.split('.');
  const v = obj[head];
  if (rest.length === 0) return v;
  if (v && typeof v === 'object') return pick(v as Record<string, unknown>, rest.join('.'));
  // Flat redirect form: `order=123` stands for order.id
  if (head === 'order' && rest.join('.') === 'id') return v;
  return undefined;
}

function str(v: unknown): string {
  // VERIFY: Paymob renders booleans as lowercase "true"/"false" and missing/null values as "".
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** The exact string Paymob signs, built from the callback `obj`. */
export function paymobHmacMessage(obj: Record<string, Json | unknown>): string {
  return PAYMOB_TRANSACTION_HMAC_FIELDS.map((f) => str(pick(obj as Record<string, unknown>, f))).join('');
}

export async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings (case-insensitive). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export async function verifyPaymobHmac(obj: Record<string, unknown>, receivedHmac: string | null | undefined, secret: string): Promise<boolean> {
  if (!receivedHmac || !secret) return false;
  const expected = await hmacSha512Hex(secret, paymobHmacMessage(obj));
  return timingSafeEqualHex(expected, receivedHmac);
}
