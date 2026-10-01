import { expect, it } from 'vitest';
import type { LookupTripRef } from '@wayfinder/contracts';
import { matchesTrip, shownVehicles } from './filters';
import { axisOf, placeOn } from './parts/axis';
import { fuelLeftWords, fuelTone, measureWords, tripState } from './words';

// The History and Fleet views drawn in the browser from their reads (spec 017, rules 6, 9 and 10): filters by the
// returned flags and fields only, the static timeline's span, and the words that keep missing and over-quota figures
// distinct from zero. These sit beside the API's own criterion tests; they work nothing out of the business.

it('History filters keep whole trips by their returned flags and brands, and Deferred keeps no trip rows', () => {
  const fresh = { brands: ['Fresh' as const], flags: { late: false, short: false, returned: false } };
  const late = { brands: ['Fresh' as const], flags: { late: true, short: false, returned: false } };
  const unknown = { brands: ['Tech' as const], flags: { late: null, short: true, returned: false } };
  const mixed = { brands: ['Fresh' as const, 'Style' as const], flags: { late: false, short: true, returned: true } };
  const trips = [fresh, late, unknown, mixed];
  const kept = (attention: 'all' | 'late' | 'short' | 'returned' | 'deferred', brand: 'all' | 'Fresh' | 'Style' | 'Tech' = 'all') =>
    trips.filter((trip) => matchesTrip(trip, { attention, brand }));
  expect(kept('all')).toEqual(trips);
  // An arrival never recorded is not late.
  expect(kept('late')).toEqual([late]);
  expect(kept('short')).toEqual([unknown, mixed]);
  expect(kept('returned')).toEqual([mixed]);
  expect(kept('deferred')).toEqual([]);
  // A brand keeps a mixed trip whole, once.
  expect(kept('all', 'Style')).toEqual([mixed]);
  expect(kept('all', 'Fresh')).toEqual([fresh, late, mixed]);
  expect(kept('returned', 'Tech')).toEqual([]);
});

it('Fleet groups reefer trucks, dry trucks and vans, puts archived rows and unknown fuel last, and lets Reefer and Van overlap', () => {
  const vehicle = (id: string, type: 'truck' | 'van', temp: 'reefer' | 'ambient', remaining: number | null, extra: { archived?: boolean; out?: boolean; off?: string } = {}) => ({
    id, type, temp, group: type === 'van' ? 'vans' as const : temp === 'reefer' ? 'reefer_trucks' as const : 'dry_trucks' as const,
    archivedAt: extra.archived ? '2026-06-24T10:00:00.000Z' : null, offReason: extra.off ?? null, recordedOut: extra.out ?? false,
    fuel: remaining === null ? null : { remaining },
  });
  const fleet = [
    vehicle('VEH035', 'van', 'reefer', 252, { out: true }), vehicle('VEH003', 'truck', 'reefer', 404, { archived: true }), vehicle('VEH001', 'truck', 'reefer', 40),
    vehicle('VEH030', 'truck', 'ambient', 198, { off: 'Brake service' }), vehicle('VEH037', 'van', 'ambient', null), vehicle('VEH038', 'van', 'ambient', 238),
    vehicle('VEH002', 'truck', 'reefer', 40),
  ];
  const ids = (state: 'all' | 'out' | 'not_out' | 'workshop', type: 'all' | 'reefer' | 'dry' | 'van', sort: 'fuel' | 'id' = 'fuel') =>
    shownVehicles(fleet, { state, type, sort }).map((group) => [group.group, group.vehicles.map((each) => each.id)]);
  expect(ids('all', 'all')).toEqual([
    ['reefer_trucks', ['VEH001', 'VEH002', 'VEH003']], ['dry_trucks', ['VEH030']], ['vans', ['VEH038', 'VEH035', 'VEH037']],
  ]);
  expect(ids('all', 'all', 'id')).toEqual([
    ['reefer_trucks', ['VEH001', 'VEH002', 'VEH003']], ['dry_trucks', ['VEH030']], ['vans', ['VEH035', 'VEH037', 'VEH038']],
  ]);
  // Reefer is every fridge vehicle, vans included; Van is both kinds of van. The two overlap.
  expect(ids('all', 'reefer')).toEqual([['reefer_trucks', ['VEH001', 'VEH002', 'VEH003']], ['vans', ['VEH035']]]);
  expect(ids('all', 'van')).toEqual([['vans', ['VEH038', 'VEH035', 'VEH037']]]);
  expect(ids('all', 'dry')).toEqual([['dry_trucks', ['VEH030']], ['vans', ['VEH038', 'VEH037']]]);
  expect(ids('out', 'all')).toEqual([['vans', ['VEH035']]]);
  expect(ids('workshop', 'all')).toEqual([['dry_trucks', ['VEH030']]]);
  expect(ids('not_out', 'van')).toEqual([['vans', ['VEH038', 'VEH037']]]);
});

it('Fleet words keep an over quota, a zero quota and an unknown week apart, and never say where a vehicle is', () => {
  expect(fuelTone(null)).toBeNull();
  expect(fuelTone({ remaining: 40, remainingPct: 12 })).toBe('warn');
  expect(fuelTone({ remaining: 30, remainingPct: 9 })).toBe('bad');
  expect(fuelTone({ remaining: 265, remainingPct: 62 })).toBe('good');
  expect(fuelTone({ remaining: -2.7, remainingPct: -1 })).toBe('bad');
  expect(fuelTone({ remaining: -50, remainingPct: null })).toBe('bad');
  expect(fuelTone({ remaining: 0, remainingPct: null })).toBeNull();
  expect(fuelLeftWords({ remaining: 40 })).toBe('40 L');
  expect(fuelLeftWords({ remaining: -2.7 })).toBe('Over quota by 2.7 L');
  const trip = (status: LookupTripRef['status'], extra: Partial<LookupTripRef> = {}): LookupTripRef => ({
    tripId: '00000000-0000-4000-8000-000000000001', planId: '00000000-0000-4000-8000-000000000002', date: '2026-06-25', vehicleId: 'VEH035', tripNo: 1, status,
    driver: { id: '00000000-0000-4000-8000-000000000003', name: 'Dilshan' }, leavesAt: '2026-06-24T23:06:00.000Z', plannedReturn: '2026-06-25T00:40:00.000Z', km: 7.2,
    readyAt: null, leftAt: null, backAt: null, ...extra,
  });
  expect(tripState(trip('planned'), '2026-06-25')).toBe('planned · trip 1 · leaves 04:36');
  expect(tripState(trip('ready', { readyAt: '2026-06-24T21:05:00.000Z' }), '2026-06-25')).toBe('ready 02:35 · trip 1');
  expect(tripState(trip('out', { leftAt: '2026-06-24T23:10:00.000Z' }), '2026-06-25')).toBe('out · trip 1 · left 04:40');
  expect(tripState(trip('out'), '2026-06-26')).toBe('out since Thu 25 · trip 1');
  expect(tripState(trip('done', { backAt: '2026-06-25T01:00:00.000Z' }), '2026-06-25')).toBe('returned 06:30 · trip 1');
  // A stage never recorded is said with its coverage, never as zero.
  expect(measureWords({ units: null, known: 3, total: 5 })).toBe('not recorded (3 of 5 lines)');
  expect(measureWords({ units: 0, known: 0, total: 0 })).toBe('0');
});

it('History draws its timeline from even depot hours around every kept and recorded time', () => {
  const at = (hhmm: string) => new Date(`2026-06-25T${hhmm}:00+05:30`).toISOString();
  const trip = {
    schedule: { leavesAt: at('04:36'), backAt: at('06:10') }, leftAt: at('04:40'), backAt: null,
    stops: [{ plannedArrival: at('05:00'), arrivedAt: at('05:02'), doneAt: at('05:10') }, { plannedArrival: at('05:24'), arrivedAt: null, doneAt: null }],
  };
  const axis = axisOf([trip] as never)!;
  expect(new Date(axis.start).toISOString()).toBe(at('04:00'));
  expect(new Date(axis.end).toISOString()).toBe(at('08:00'));
  expect(axis.ticks.map((tick) => new Date(tick).toISOString())).toEqual([at('04:00'), at('06:00'), at('08:00')]);
  expect(placeOn(axis, at('06:00'))).toBe(50);
  expect(axisOf([])).toBeNull();
});
