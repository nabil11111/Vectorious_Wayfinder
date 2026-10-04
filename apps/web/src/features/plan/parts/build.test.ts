import { PlanBoard, type PlanRef } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import { buildPlan, suggestionLine, type BuildAct } from './build';

// Nabil, 1 Oct, with spec 023: once "Build the suggested plan" goes through, the board opens View plan for its day,
// where the plan's trips, decisions and checks are laid out. A refused build, and one that loaded the board again,
// stay on the board with their line.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const BUILT = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [], deferrals: [], id: '00000000-0000-4000-8000-000000000100', revision: 1, status: 'draft', savedAt: '2026-06-24T10:30:00.000Z', sentAt: null, canUnsend: false, lockedReason: null },
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

// L-18: under "No trip open", the suggested plan's line says how many of its decisions are still to make while the draft
// holds the suggestion, and nothing once Start over or Undo has taken all of it away.
it('L-18 says the suggestion\'s decisions only while the draft still holds it', () => {
  const decision = (n: number, open: boolean) => ({
    key: `late_order:00000000-0000-4000-8000-00000000000${n}`, kind: 'late_order' as const, reason: 'No fridge truck was left.', orderId: `00000000-0000-4000-8000-00000000000${n}`,
    vehicleId: null, tripNo: null, leaveAt: null, acceptedAt: null, open,
  });
  const suggestion = { builtAt: '2026-06-24T10:31:00.000Z', choices: [], inDraft: true, provenance: 'suggested' as const, decisions: [decision(1, true), decision(2, true), decision(3, false)] };
  expect(suggestionLine(suggestion)).toEqual({ at: 'Suggested plan · 16:01', open: 2, toMake: '2 decisions to make' });
  expect(suggestionLine({ ...suggestion, decisions: [decision(3, false)] })).toMatchObject({ open: 0, toMake: 'no decisions to make' });
  expect(suggestionLine({ ...suggestion, inDraft: false, decisions: [decision(1, false), decision(2, false)] })).toBeNull();
  expect(suggestionLine(null)).toBeNull();
});
