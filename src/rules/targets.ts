import type { TargetsByAccount } from './types';

/** Default goals per ad account id (see src/data/mock.ts ACCOUNTS). */
export const DEFAULT_TARGETS: TargetsByAccount = {
  act_1048203311: { targetCpa: 35, targetRoas: 2.5 },
  '482-913-2207': { targetCpa: 32, targetRoas: 3.0 },
  '7190345528810': { targetCpa: 38, targetRoas: 2.0 },
};
