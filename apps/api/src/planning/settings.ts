import type { PlanSettings } from './types';

// The defaults the checker ships with (D-08, D-09, D-19). The caller passes settings in, so a later admin
// screen only has to store them.
export const DEFAULT_SETTINGS: PlanSettings = {
  reloadMin: 30,
  earliestLeave: { Fresh: 210, Style: 450, Tech: 450 }, // 03:30 and 07:30
  waitWarnMin: 30,
  budgetMin: { fresh: 270, styleTech: 480 },
  mixBrands: false,
};
