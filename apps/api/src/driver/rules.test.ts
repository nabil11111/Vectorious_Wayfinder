import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyDriverWrite, DriverWrite, nextStop, phoneView, tripFigures, type DriverDay, type DriverTrip } from '@wayfinder/contracts';

const at = '2026-06-24T22:01:00.000Z';
function day(): DriverDay {
  const line = (quantity: number, loaded: number, temp: 'chilled' | 'dry') => ({ lineId: randomUUID(), orderId: randomUUID(), temp, productId: temp, name: temp, unit: 'carton', quantity, loaded, delivered: null });
  const stop = (seq: number, lines: ReturnType<typeof line>[]) => ({ id: randomUUID(), seq, revision: 0, retriedAt: null, outletId: `OUT00${seq}`, shopName: seq === 1 ? 'Fresh Nugegoda' : 'Fresh Wellawatte', district: 'Colombo', dockType: 'street' as const, windowOpen: '05:00', windowClose: '08:00', note: null, arrivedAt: null, doneAt: null, outcome: null, lines });
  return { depot: 'Peliyagoda', driver: 'Dilshan', day: '2026-06-25', planSent: true, appliedWriteIds: [], trips: [{ tripId: randomUUID(), revision: 5, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1, brand: 'Fresh', district: 'Colombo', status: 'ready', leavesAt: at, backBy: at, readyAt: at, leftAt: null, backAt: null, stops: [stop(1, [line(12, 12, 'chilled'), line(8, 8, 'chilled'), line(4, 3, 'dry')]), stop(2, [line(48, 48, 'chilled'), line(46, 46, 'dry')])], problems: [] }] };
}
const base = (trip: DriverTrip) => ({ writeId: randomUUID(), tripId: trip.tripId, revision: trip.revision, at });
const atStop = (trip: DriverTrip, index: number) => ({ ...base(trip), stopId: trip.stops[index]!.id, revision: trip.stops[index]!.revision });
function write(day: DriverDay, action: DriverWrite) { return applyDriverWrite(day, action); }

it('AC-9 applies start, arrive, deliver and finish immutably, raising only the named record and listing the write id', () => {
  const initial = day();
  let current = write(initial, { ...base(initial.trips[0]!), kind: 'start' });
  expect(initial.trips[0]!.status).toBe('ready');
  expect(current.trips[0]).toMatchObject({ status: 'out', revision: 6, leftAt: at });
  for (const index of [0, 1]) {
    const arrival = { ...atStop(current.trips[0]!, index), kind: 'arrive' as const };
    current = write(current, arrival);
    expect(current.trips[0]!.stops[index]).toMatchObject({ revision: 1, arrivedAt: at });
    const delivery = { ...atStop(current.trips[0]!, index), kind: 'deliver' as const, photo: 'data:image/jpeg;base64,/9j/2Q==' };
    current = write(current, delivery);
    expect(current.trips[0]!.stops[index]).toMatchObject({ revision: 2, doneAt: at, outcome: 'delivered' });
    expect(current.trips[0]!.stops[index]!.lines.map(l => l.delivered)).toEqual(index === 0 ? [12, 8, 3] : [48, 46]);
  }
  current = write(current, { ...base(current.trips[0]!), kind: 'finish' });
  expect(current.trips[0]).toMatchObject({ status: 'done', revision: 7, backAt: at });
  expect(current.appliedWriteIds).toHaveLength(6);
  expect(tripFigures(current.trips[0]!)).toMatchObject({ stops: 2, stopsDone: 2, ordered: 118, loaded: 117, delivered: 117, refused: 0, notDelivered: 0, short: 1, onTruck: 0, next: null });
});

it.each(['refuse', 'closed'] as const)('AC-9 applies %s and gives the problem its write id with the attempt counts', (kind) => {
  let current = day();
  current = write(current, { ...atStop(current.trips[0]!, 0), kind: 'deliver', photo: 'data:image/jpeg;base64,/9j/2Q==' });
  const trip = current.trips[0]!;
  const action: DriverWrite = kind === 'refuse'
    ? { ...atStop(trip, 1), kind, reason: 'damaged', lines: [{ lineId: trip.stops[1]!.lines[0]!.lineId, refused: 2 }], note: '2 crushed' }
    : { ...atStop(trip, 1), kind, note: '' };
  const result = write(current, action);
  expect(result.trips[0]!.problems[0]).toMatchObject({ id: action.writeId, kind: kind === 'refuse' ? 'refused' : 'closed', reason: kind === 'refuse' ? 'damaged' : 'nobody_there', note: kind === 'refuse' ? '2 crushed' : null, hasPhoto: false, raisedAt: at, decision: null });
  expect(result.trips[0]!.problems[0]!.lines.map(l => l.counted)).toEqual(kind === 'refuse' ? [2] : [48, 46]);
  expect(tripFigures(result.trips[0]!)).toMatchObject({ ordered: 118, loaded: 117, delivered: kind === 'refuse' ? 115 : 23, refused: kind === 'refuse' ? 2 : 0, notDelivered: kind === 'refuse' ? 0 : 94, short: 1, onTruck: kind === 'refuse' ? 2 : 94, next: null });
});

it('AC-9 follows plan order then retry time, and leaves no goods from a retried closed attempt on the truck twice', () => {
  const trip = day().trips[0]!;
  const [first, second] = trip.stops;
  first!.retriedAt = at;
  expect(nextStop(trip)?.id).toBe(second!.id);
  second!.retriedAt = '2026-06-24T22:02:00.000Z';
  expect(nextStop(trip)?.id).toBe(first!.id);
  first!.retriedAt = '2026-06-24T22:03:00.000Z';
  expect(nextStop(trip)?.id).toBe(second!.id);
  trip.problems.push({ id: randomUUID(), kind: 'closed', stopId: first!.id, reason: 'nobody_there', note: null, raisedAt: at, hasPhoto: false, lines: first!.lines.map(l => ({ lineId: l.lineId, counted: l.loaded! })), decision: 'try_again', decidedAt: at, decidedBy: 'Ruwan' });
  expect(tripFigures(trip).onTruck).toBe(0);
  first!.retriedAt = second!.retriedAt;
  expect(nextStop(trip)?.id).toBe(first!.id);
});

it('AC-9 drops listed writes before applying the waiting ones, without mutating the day or queue', () => {
  const initial = day();
  const start: DriverWrite = { ...base(initial.trips[0]!), kind: 'start' };
  const arrived: DriverWrite = { ...atStop(initial.trips[0]!, 0), kind: 'arrive' };
  const server = write(initial, start);
  const result = phoneView(server, [start, arrived]);
  expect(result.writes).toEqual([arrived]);
  expect(result.day).toEqual(write(server, arrived));
  expect(server.trips[0]!.stops[0]!.revision).toBe(0);
});

it('AC-9 does nothing for an absent trip or stop and does not count an applied id twice', () => {
  const initial = day();
  expect(write(initial, { ...base(initial.trips[0]!), tripId: randomUUID(), kind: 'start' })).toEqual(initial);
  expect(write(initial, { ...atStop(initial.trips[0]!, 0), stopId: randomUUID(), kind: 'arrive' })).toEqual(initial);
  const start: DriverWrite = { ...base(initial.trips[0]!), kind: 'start' };
  const applied = write(initial, start);
  expect(write(applied, start)).toEqual(applied);
});

describe('driver request shapes', () => {
  it('rejects duplicate lines, zero refused, wrong reasons, missing proof and long notes', () => {
    const initial = day().trips[0]!;
    const valid = { ...atStop(initial, 0), kind: 'refuse', reason: 'damaged', note: '', lines: [{ lineId: initial.stops[0]!.lines[0]!.lineId, refused: 1 }] };
    expect(DriverWrite.safeParse(valid).success).toBe(true);
    for (const change of [{ lines: [...valid.lines, ...valid.lines] }, { lines: [{ ...valid.lines[0], refused: 0 }] }, { reason: 'lost' }, { note: 'x'.repeat(201) }, { kind: 'deliver' }]) expect(DriverWrite.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

it('AC-9 supplies per-temperature counts so screens only format chilled, dry and hand-back totals', () => {
  const initial = day();
  const trip = initial.trips[0]!;
  expect(tripFigures(trip).byStop[0]!.byTemp).toEqual({
    chilled: { ordered: 20, loaded: 20, delivered: 0, refused: 0, notDelivered: 0, short: 0, onTruck: 0 },
    dry: { ordered: 4, loaded: 3, delivered: 0, refused: 0, notDelivered: 0, short: 1, onTruck: 0 },
  });
  const result = write(initial, { ...atStop(trip, 1), kind: 'refuse', reason: 'damaged', note: '', lines: [{ lineId: trip.stops[1]!.lines[0]!.lineId, refused: 2 }] });
  expect(tripFigures(result.trips[0]!).byTemp.chilled).toMatchObject({ ordered: 68, loaded: 68, delivered: 46, refused: 2, onTruck: 2 });
});
