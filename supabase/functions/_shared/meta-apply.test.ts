import { describe, expect, it } from 'vitest';
import { checkBudgetChange, validateActions } from './meta-apply.ts';

describe('apply guard rails', () => {
  it('allows changes up to 2x and down to 0.25x, above the currency minimum', () => {
    expect(checkBudgetChange(1000, 1600, 'EGP')).toBe('ok');
    expect(checkBudgetChange(1000, 2000, 'EGP')).toBe('ok');
    expect(checkBudgetChange(1000, 2100, 'EGP')).toBe('budget_change_too_big');
    expect(checkBudgetChange(1000, 200, 'EGP')).toBe('budget_change_too_big');
    expect(checkBudgetChange(100, 40, 'EGP')).toBe('budget_too_low');
    expect(checkBudgetChange(null, 500, 'EGP')).toBe('budget_not_on_campaign'); // ad-set budgets (ABO)
    expect(checkBudgetChange(1000, Number.NaN, 'EGP')).toBe('budget_invalid');
  });
  it('accepts at most two well-formed actions', () => {
    expect(validateActions([{ op: 'pause', campaignId: '1202' }])).toBe(true);
    expect(validateActions([{ op: 'set_daily_budget', campaignId: '1', to: 500 }, { op: 'set_daily_budget', campaignId: '2', to: 900 }])).toBe(true);
    expect(validateActions([{ op: 'delete', campaignId: '1' }])).toBe(false);
    expect(validateActions([{ op: 'pause', campaignId: 'act_1' }])).toBe(false);
    expect(validateActions([{ op: 'set_daily_budget', campaignId: '1' }])).toBe(false);
    expect(validateActions([{ op: 'pause', campaignId: '1' }, { op: 'pause', campaignId: '2' }, { op: 'pause', campaignId: '3' }])).toBe(false);
  });
});
