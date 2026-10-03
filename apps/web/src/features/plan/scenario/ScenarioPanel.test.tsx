import type { PlanScenario, PlanBoard, Me } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { scenarioIdentity } from './identity';
import { ScenarioPanel } from './ScenarioPanel';
const held = vi.hoisted(() => ({ vehicle: 'VEH001', value: null as { identity: string; value: PlanScenario } | null }));
vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return { ...real, useState: (initial: unknown) => [typeof initial === 'string' ? held.vehicle : held.value, vi.fn()] };
});
const me = { id: 'person', depotId: 'Peliyagoda' } as Me;
vi.mock('@/features/auth/api', () => ({ useMe: () => ({ data: { id: 'person', depotId: 'Peliyagoda' } }) }));
vi.mock('@/features/dispatcher/scope', () => ({ useScope: () => ({ scope: 'Peliyagoda' }) }));
vi.mock('@/lib/clock', () => ({ useAppClock: () => ({ state: { day: 1 } }) }));
const board: PlanBoard = {
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [], deferrals: [], id: null, revision: 0, status: 'draft', savedAt: null, sentAt: null, canUnsend: false, lockedReason: null },
  dropped: [], check: null, orders: [], shops: [], vehicles: [{ id: 'VEH001', type: 'truck', temp: 'ambient', weightCapKg: 3000, volumeCapM3: 15, working: true, offReason: null, litresLeft: 100, fuelLeftPct: 100 }],
  drivers: [], figures: null, counts: null, suggestion: null,
};
const screen: BoardScreen = { board, draft: { mixBrands: false, trips: [], deferrals: [] }, saving: 'saved', acting: false, refused: null, undo: null, history: { undo: null, redo: null } };
const preview: PlanScenario = {
  depot: 'Peliyagoda', date: '2026-06-25', ref: { planId: null, demoDay: 1 }, excludedVehicleId: 'VEH001', comparedAt: '2026-06-24T10:30:00.000Z', snapshotKey: 'hash',
  baseline: { summary: { totalOrders: 1, fullyPlanned: 1, partiallyPlanned: 0, deferred: 0, shopsFullyPlanned: 1, shopsWithWaiting: 0, vehicles: 1, trips: 1, fuelLitres: 2.3, repeatedDeferrals: 0 }, orders: [{ orderId: 'original', outletId: 'OUT001', shopName: 'Fresh Nugegoda', status: 'planned', waitedBefore: true, vehicleIds: ['VEH001'], reasons: ['The real baseline planner reason.'] }], check: { ok: true, problems: [], trips: [], vehicles: [] } },
  scenario: { summary: { totalOrders: 1, fullyPlanned: 0, partiallyPlanned: 0, deferred: 1, shopsFullyPlanned: 0, shopsWithWaiting: 1, vehicles: 0, trips: 0, fuelLitres: 0, repeatedDeferrals: 1 }, orders: [{ orderId: 'original', outletId: 'OUT001', shopName: 'Fresh Nugegoda', status: 'deferred', waitedBefore: true, vehicleIds: [], reasons: ['The real scenario planner reason.'] }], check: { ok: true, problems: [], trips: [], vehicles: [] } },
};
const render = (stale = false, refreshing = false, s = screen) => renderToStaticMarkup(<ScenarioPanel screen={s} stale={stale} refreshing={refreshing} />);
it('F2 labels the generated baseline and displays checked original demand, real reasons, fuel and changes without Apply', () => {
  held.value = { identity: scenarioIdentity(screen, me, 'Peliyagoda', 1, held.vehicle, false)!, value: preview };
  const html = render();
  for (const text of ['Generated baseline', 'Orders partly planned', 'Shops fully planned', 'Shops with waiting goods', 'Trip fuel (L)', '2.3', 'Previously waiting orders', 'Fresh Nugegoda', 'planned → deferred', 'real baseline planner reason', 'real scenario planner reason', 'Split parts count together']) expect(html).toContain(text);
  expect(html).not.toContain('Apply'); expect(html).not.toContain('optimal');
});
it('F5 immediately hides stale, refreshing, changed-input and unsaved results', () => {
  held.value = { identity: scenarioIdentity(screen, me, 'Peliyagoda', 1, held.vehicle, false)!, value: preview };
  const changed = { ...screen, board: { ...board, demoDay: 2 } };
  for (const html of [render(true), render(false, true), render(false, false, changed), render(false, false, { ...screen, saving: 'saving' })]) {
    expect(html).not.toContain('Fresh Nugegoda'); expect(html).not.toContain('The real scenario planner reason'); expect(html).toContain('disabled');
  }
});
