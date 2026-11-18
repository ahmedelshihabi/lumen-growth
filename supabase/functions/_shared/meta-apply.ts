/**
 * Guard rails for changes Lumen applies on Meta from a recommendation. Pure, unit tested,
 * and enforced on the server whatever the browser sends.
 */
import { minDailyBudget } from './meta-create.ts';

/** One step may at most double a budget or cut it to a quarter (bigger jumps reset learning). */
export const MAX_BUDGET_UP = 2;
export const MAX_BUDGET_DOWN = 0.25;

export type ApplyOp = 'pause' | 'activate' | 'set_daily_budget';
export interface ApplyAction {
  op: ApplyOp;
  campaignId: string;
  campaignName?: string;
  /** set_daily_budget: new daily budget in the account currency (major units). */
  to?: number;
}

export type BudgetCheck = 'ok' | 'budget_not_on_campaign' | 'budget_invalid' | 'budget_too_low' | 'budget_change_too_big';

export function checkBudgetChange(current: number | null, to: number | undefined, currency: string): BudgetCheck {
  if (current === null || !(current > 0)) return 'budget_not_on_campaign';
  if (typeof to !== 'number' || !Number.isFinite(to) || to <= 0) return 'budget_invalid';
  if (to < minDailyBudget(currency)) return 'budget_too_low';
  const ratio = to / current;
  if (ratio > MAX_BUDGET_UP || ratio < MAX_BUDGET_DOWN) return 'budget_change_too_big';
  return 'ok';
}

export function validateActions(actions: unknown): actions is ApplyAction[] {
  return (
    Array.isArray(actions) &&
    actions.length > 0 &&
    actions.length <= 2 &&
    actions.every(
      (a) =>
        a &&
        typeof a === 'object' &&
        ['pause', 'activate', 'set_daily_budget'].includes((a as ApplyAction).op) &&
        typeof (a as ApplyAction).campaignId === 'string' &&
        /^\d+$/.test((a as ApplyAction).campaignId) &&
        ((a as ApplyAction).op !== 'set_daily_budget' || typeof (a as ApplyAction).to === 'number'),
    )
  );
}
