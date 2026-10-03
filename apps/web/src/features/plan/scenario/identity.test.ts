import type { Me, PlanBoard } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import type { BoardScreen } from '../board';
import { scenarioIdentity } from './identity';
const board: PlanBoard = {
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [], deferrals: [], id: null, revision: 0, status: 'draft', savedAt: null, sentAt: null, canUnsend: false, lockedReason: null },
  dropped: [], check: null, orders: [], shops: [], vehicles: [{ id: 'VEH001', type: 'truck', temp: 'ambient', weightCapKg: 3000, volumeCapM3: 15, working: true, offReason: null, litresLeft: 100, fuelLeftPct: 100 }],
  drivers: [], figures: null, counts: null, suggestion: null,
};
const screen = (): BoardScreen => ({ board: structuredClone(board), draft: { mixBrands: false, trips: [], deferrals: [] }, saving: 'saved', acting: false, refused: null, undo: null, history: { undo: null, redo: null } });
const me = { id: 'person', depotId: 'Peliyagoda' } as Me;
const identity = (s = screen(), account: Me | null = me, scope = 'Peliyagoda', generation: number | null = 1, vehicle = 'VEH001', blocked = false) => scenarioIdentity(s, account, scope, generation, vehicle, blocked);
it('F5 binds comparison identity to full content, account, depot, date, reset and selected vehicle', () => {
  const first = identity(); expect(first).not.toBeNull();
  const changed = screen(); changed.board.vehicles[0]!.litresLeft--;
  expect(identity(changed)).not.toBe(first);
  expect(identity(screen(), { ...me, id: 'other' })).not.toBe(first);
  const moved = screen(); moved.board.day!.date = '2026-06-26'; expect(identity(moved)).not.toBe(first);
  const reset = screen(); reset.board.demoDay = 2; expect(identity(reset, me, 'Peliyagoda', 2)).not.toBe(first);
});
it('F5 refuses stale, reading, saving, acting, unsaved, sent, closed, unavailable and foreign identities', () => {
  expect(identity(screen(), me, 'Peliyagoda', 1, 'VEH001', true)).toBeNull();
  expect(identity(screen(), null)).toBeNull(); expect(identity(screen(), { ...me, depotId: 'Kandy' })).toBeNull();
  expect(identity(screen(), me, 'Kandy')).toBeNull(); expect(identity(screen(), me, 'Both')).toBeNull();
  expect(identity(screen(), me, 'Peliyagoda', 2)).toBeNull(); expect(identity(screen(), me, 'Peliyagoda', null)).toBeNull();
  expect(identity(screen(), me, 'Peliyagoda', 1, 'foreign')).toBeNull();
  for (const save of ['saving', 'retrying', 'refused'] as const) { const s = screen(); s.saving = save; expect(identity(s)).toBeNull(); }
  const acting = screen(); acting.acting = true; expect(identity(acting)).toBeNull();
  const unsaved = screen(); unsaved.draft.mixBrands = true; expect(identity(unsaved)).toBeNull();
  const sent = screen(); sent.board.plan.status = 'published'; expect(identity(sent)).toBeNull();
  const closed = screen(); closed.board.day!.open = false; expect(identity(closed)).toBeNull();
  const locked = screen(); locked.board.plan.lockedReason = 'Loading started'; expect(identity(locked)).toBeNull();
  const off = screen(); off.board.vehicles[0]!.working = false; expect(identity(off)).toBeNull();
});
