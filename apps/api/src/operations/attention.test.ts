import { randomUUID } from 'node:crypto';
import type { DriverTrip, Issue, OperationsTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { attentionOf, outRowOf, compareOut, timelineOf } from './attention';
import { depotInstant } from '../lib/clock';
const at = (min: number) => depotInstant('2026-06-25', min).toISOString();
const trip: DriverTrip = { tripId: randomUUID(), revision: 0, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1, brand: 'Fresh', district: 'Colombo', status: 'ready',
  leavesAt: at(276), backBy: at(370), backByWords: 'back by 06:10', readyAt: at(156), leftAt: null, backAt: null, problems: [], stops: [{ id: randomUUID(), seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street', windowOpen: '05:00', windowClose: '09:00', note: null, arrivedAt: null, doneAt: null, outcome: null, lines: [] }] };
const arrivals = new Map([[trip.stops[0]!.id, at(300)]]);

it('AC-16 attention names missing reports and retries without predictions', () => {
  expect(attentionOf(trip, arrivals, at(276))).toEqual({ kind: 'none' });
  expect(attentionOf(trip, arrivals, at(277))).toEqual({ kind: 'departure_unreported', plannedAt: at(276), sentence: 'Departure not reported · planned 04:36', word: 'watching' });
  const out = { ...trip, status: 'out' as const, leftAt: at(211) };
  expect(attentionOf(out, arrivals, at(300))).toEqual({ kind: 'none' });
  expect(attentionOf(out, arrivals, at(301))).toEqual({ kind: 'arrival_unreported', stopId: trip.stops[0]!.id, plannedAt: at(300) });
  const retry = { ...out, stops: [{ ...out.stops[0]!, retriedAt: at(302) }] };
  expect(attentionOf(retry, arrivals, at(500))).toEqual({ kind: 'retry_requested', stopId: trip.stops[0]!.id, requestedAt: at(302) });
  expect(outRowOf(retry, arrivals, [], at(500))).toMatchObject({ arrivalIsOriginal: true, plannedArrival: at(300), plannedReturn: at(370), progress: { numerator: 0, denominator: 1, percent: 0 } });
  const arrived = { ...retry, stops: [{ ...retry.stops[0]!, arrivedAt: at(510) }] };
  expect(outRowOf(arrived, arrivals, [], at(600)).status.kind).toBe('at_stop');
  const done = { ...out, stops: [{ ...out.stops[0]!, outcome: 'closed' as const, doneAt: at(400) }] };
  expect(outRowOf(done, arrivals, [], at(500))).toMatchObject({ nextStop: null, plannedArrival: null, status: { kind: 'returning' }, progress: { percent: 100 } });
  // A planned return already past says when it was due, never when it will be (spec 016, rule 4).
  expect(outRowOf(done, arrivals, [], at(500)).status).toEqual({ kind: 'returning', sentence: 'Returning · was due back 06:10' });
  expect(outRowOf(done, arrivals, [], at(370)).status).toEqual({ kind: 'returning', sentence: 'Returning · planned back 06:10' });
  const issue = { id: randomUUID(), kind: 'closed', reason: 'nobody_there', status: 'open', raisedAt: at(400) } as Issue;
  expect(outRowOf(done, arrivals, [issue], at(500)).status).toMatchObject({ kind: 'open_problem', issueId: issue.id, summary: 'Nobody there' });
});

it('Q-20 names an open flag of a truck that cannot take it all "Won\'t fit", and keeps the words of every other reason', () => {
  const summaryOf = (kind: Issue['kind'], reason: Issue['reason'], lines: Partial<Issue['lines'][number]>[] = []) => {
    const issue = { id: randomUUID(), kind, reason, status: 'open', raisedAt: at(150), lines } as Issue;
    const row = outRowOf(trip, arrivals, [issue], at(200)).status;
    return row.kind === 'open_problem' ? row.summary : null;
  };
  expect(summaryOf('loading', 'wont_fit')).toBe('Won\'t fit');
  expect([summaryOf('loading', 'short'), summaryOf('loading', 'damaged'), summaryOf('loading', 'wrong_item')]).toEqual(['Short', 'Damaged', 'Wrong item']);
  expect([summaryOf('refused', 'expired'), summaryOf('refused', 'not_ordered'), summaryOf('closed', 'nobody_there')]).toEqual(['Expired', 'Not ordered', 'Nobody there']);
  expect([summaryOf('receipt', 'missing'), summaryOf('receipt', 'not_cold')]).toEqual(['Missing', 'Not cold']);
  // Q-40: a report gives each line its own reason, and the row says each once.
  expect(summaryOf('receipt', 'damaged', [{ counted: 1, reason: 'damaged' }, { counted: 1, reason: 'missing' }, { counted: 2, reason: 'damaged' }])).toBe('Damaged, missing');
});

it('AC-16 out trucks sort open problems then watching then scheduled leave', () => {
  const base = { date: '2026-06-25', vehicleId: 'VEH035', tripNo: 1, detailRecorded: true, schedule: { leavesAt: at(276), backAt: at(370) } };
  const row = (tripId: string, status: object) => ({ ...base, tripId, outRow: { status } }) as OperationsTrip;
  const normal = row('normal', { kind: 'out' });
  const watch = row('watch', { kind: 'arrival_unreported', plannedAt: at(300) });
  const later = row('later', { kind: 'open_problem', raisedAt: at(400), issueId: 'b' });
  const first = row('first', { kind: 'open_problem', raisedAt: at(400), issueId: 'a' });
  expect([normal, later, watch, first].sort(compareOut).map(row => row.tripId)).toEqual(['first', 'later', 'watch', 'normal']);
});

it('AC-16 timeline expands at two hour ticks across midnight and hides another dates now line', () => {
  expect(timelineOf('2026-06-25', [at(30), at(1501)], at(600))).toMatchObject({ start: at(0), end: at(1560), now: at(600) });
  expect(timelineOf('2026-06-25', [], at(1500))).toEqual({ start: at(120), end: at(1320), now: null, ticks: Array.from({ length: 11 }, (_, n) => at(120 + 120 * n)) });
});

it('Q-24 words a trip past its leaving time by what the dock recorded: never loaded, still loading, or ready and not reported out', () => {
  // VEH004 leaves 03:30 with 437 cartons; the clock reads 03:31.
  const veh004 = (status: DriverTrip['status']) => ({ ...trip, vehicleId: 'VEH004', status, leavesAt: at(210), readyAt: status === 'ready' ? at(180) : null });
  expect(attentionOf(veh004('planned'), arrivals, at(211), { on: 0, units: 437 })).toEqual({
    kind: 'not_loaded', plannedAt: at(210), sentence: 'Not loaded · planned 03:30', word: 'still at the dock' });
  expect(attentionOf(veh004('loading'), arrivals, at(211), { on: 120, units: 437 })).toEqual({
    kind: 'still_loading', plannedAt: at(210), on: 120, units: 437, sentence: 'Still loading · 120 of 437 on · planned 03:30', word: 'still at the dock' });
  expect(attentionOf(veh004('ready'), arrivals, at(211), { on: 437, units: 437 })).toEqual({
    kind: 'departure_unreported', plannedAt: at(210), sentence: 'Departure not reported · planned 03:30', word: 'watching' });
  // Before its leaving time a trip at the dock needs nobody, whatever it has on.
  for (const status of ['planned', 'loading', 'ready'] as const) expect(attentionOf(veh004(status), arrivals, at(210), { on: 120, units: 437 })).toEqual({ kind: 'none' });
  // Thousands keep their separator, as every count on the dispatcher's pages does.
  expect(attentionOf(veh004('loading'), arrivals, at(211), { on: 1200, units: 4370 })).toMatchObject({ sentence: 'Still loading · 1,200 of 4,370 on · planned 03:30' });
});
