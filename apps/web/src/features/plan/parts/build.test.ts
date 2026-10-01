import { PlanBoard, type PlanRef } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import { buildPlan, type BuildAct } from './build';

// Nabil, 1 Oct, with spec 023: once "Build the suggested plan" goes through, the board opens View plan for its day,
// where the plan's trips, decisions and checks are laid out. A refused build, and one that loaded the board again,
// stay on the board with their line.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const BUILT = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [], deferrals: [], id: '00000000-0000-4000-8000-000000000100', revision: 1, status: 'draft', savedAt: '2026-06-24T10:30:00.000Z', sentAt: null, canUnsend: false },
  dropped: [], check: null, orders: [], shops: [], vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});
const REF: PlanRef = { planId: null, demoDay: 1 };

it('spec 023 opens View plan for the day the build answered', async () => {
  const open = vi.fn();
  const act: BuildAct = async (run, done) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(BUILT)));
    try {
      done?.(await run('2026-06-25', REF));
    } finally {
      vi.unstubAllGlobals();
    }
    return null;
  };
  expect(await buildPlan(act, open)).toBeNull();
  expect(open).toHaveBeenCalledWith('2026-06-25');
});

it('spec 023 stays on the board when the build is refused or the board is loaded again instead', async () => {
  const open = vi.fn();
  // Refused, with the server's sentence for the board to show.
  expect(await buildPlan(async () => 'The planner could not build a plan that passes every check, so the draft is as it was.', open))
    .toBe('The planner could not build a plan that passes every check, so the draft is as it was.');
  // Stale: the board loads again with its line, and the queue answers nothing.
  expect(await buildPlan(async () => null, open)).toBeNull();
  expect(open).not.toHaveBeenCalled();
});
