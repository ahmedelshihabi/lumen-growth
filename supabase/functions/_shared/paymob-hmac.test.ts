import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PAYMOB_TRANSACTION_HMAC_FIELDS, hmacSha512Hex, paymobHmacMessage, timingSafeEqualHex, verifyPaymobHmac } from './paymob-hmac.ts';

const SECRET = 'TEST_HMAC_SECRET_not_real';

// Shape of the `obj` in a Paymob "transaction processed" POST callback (values made up).
const txn = {
  id: 192036465,
  pending: false,
  amount_cents: 249900,
  success: true,
  is_auth: false,
  is_capture: false,
  is_standalone_payment: true,
  is_voided: false,
  is_refunded: false,
  is_3d_secure: true,
  integration_id: 4123456,
  has_parent_transaction: false,
  order: { id: 217503754, merchant_order_id: 'b5b1c1a6-0000-4000-8000-000000000001' },
  created_at: '2026-11-14T12:34:56.123456',
  currency: 'EGP',
  source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
  error_occured: false,
  owner: 302852,
  data: { message: 'Approved' },
};

const EXPECTED_MESSAGE =
  '249900' + '2026-11-14T12:34:56.123456' + 'EGP' + 'false' + 'false' + '192036465' + '4123456' + 'true' + 'false' + 'false' +
  'false' + 'true' + 'false' + '217503754' + '302852' + 'false' + '2346' + 'MasterCard' + 'card' + 'true';

const nodeHmac = (msg: string) => createHmac('sha512', SECRET).update(msg).digest('hex');

describe('Paymob HMAC', () => {
  it('uses the 20 documented fields in alphabetical order', () => {
    expect(PAYMOB_TRANSACTION_HMAC_FIELDS).toHaveLength(20);
    expect([...PAYMOB_TRANSACTION_HMAC_FIELDS]).toEqual([...PAYMOB_TRANSACTION_HMAC_FIELDS].sort());
  });

  it('concatenates values (nested order.id / source_data.*, booleans as true/false)', () => {
    expect(paymobHmacMessage(txn)).toBe(EXPECTED_MESSAGE);
  });

  it('accepts the flat redirect-callback form too', () => {
    const flat = {
      ...txn,
      order: '217503754',
      'source_data.pan': '2346',
      'source_data.type': 'card',
      'source_data.sub_type': 'MasterCard',
      source_data: undefined,
      success: 'true',
      pending: 'false',
    };
    expect(paymobHmacMessage(flat)).toBe(EXPECTED_MESSAGE);
  });

  it('matches an independent HMAC-SHA512 implementation', async () => {
    expect(await hmacSha512Hex(SECRET, EXPECTED_MESSAGE)).toBe(nodeHmac(EXPECTED_MESSAGE));
  });

  it('verifies a genuine signature (case-insensitive hex)', async () => {
    const sig = nodeHmac(EXPECTED_MESSAGE);
    expect(await verifyPaymobHmac(txn, sig, SECRET)).toBe(true);
    expect(await verifyPaymobHmac(txn, sig.toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects tampered amounts, wrong secrets and missing signatures', async () => {
    const sig = nodeHmac(EXPECTED_MESSAGE);
    expect(await verifyPaymobHmac({ ...txn, amount_cents: 100 }, sig, SECRET)).toBe(false);
    expect(await verifyPaymobHmac({ ...txn, success: false }, sig, SECRET)).toBe(false);
    expect(await verifyPaymobHmac(txn, sig, 'other-secret')).toBe(false);
    expect(await verifyPaymobHmac(txn, null, SECRET)).toBe(false);
    expect(await verifyPaymobHmac(txn, sig, '')).toBe(false);
  });

  it('renders null/missing values as empty strings', () => {
    const msg = paymobHmacMessage({ ...txn, source_data: { pan: null, type: 'wallet', sub_type: 'wallet' } });
    expect(msg).toContain('302852' + 'false' + '' + 'wallet' + 'wallet' + 'true');
  });

  it('timingSafeEqualHex compares length and content', () => {
    expect(timingSafeEqualHex('abcd', 'ABCD')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abcde')).toBe(false);
  });
});
