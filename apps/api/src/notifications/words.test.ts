import { randomUUID } from 'node:crypto';
import { driverAnswerSentence, driverAnswerShort, tripFigures, type DriverTrip } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { goodsWords, reportAnsweredLine, reportWords, truckCalled } from './words';

// Spec 025's words on plain facts: the goods, the trucks by their drivers, a report's answer, and the driver's answer
// with its short form, which the phone and the bell share (AC-3b).

it('words goods by temperature for Fresh and by the brand\'s unit otherwise', () => {
  expect(goodsWords('Fresh', { chilled: 8, dry: 0 })).toBe('8 chilled cartons');
  expect(goodsWords('Fresh', { chilled: 0, dry: 1 })).toBe('1 dry carton');
  expect(goodsWords('Fresh', { chilled: 20, dry: 3 })).toBe('20 chilled and 3 dry cartons');
  expect(goodsWords('Style', { chilled: 0, dry: 1 })).toBe('1 box');
  expect(goodsWords('Tech', { chilled: 0, dry: 3 })).toBe('3 items');
});

it('names a truck by its driver, its second trip by number, and one with no driver by its kind and number', () => {
  const van = { vehicleId: 'VEH035', type: 'van', temp: 'reefer', tripNo: 1, driver: 'Wasantha' } as const;
  expect(truckCalled(van)).toBe('Wasantha\'s reefer van');
  expect(truckCalled({ ...van, tripNo: 2 })).toBe('the second trip of Wasantha\'s reefer van');
  expect(truckCalled({ ...van, driver: null })).toBe('the reefer van VEH035');
});

it('words a report and the depot\'s answer to it', () => {
  const report = reportWords('Fresh', [{ temp: 'chilled', units: 1, reason: 'missing' }, { temp: 'dry', units: 2, reason: 'damaged' }], false);
  expect(report).toBe('1 chilled carton missing, 2 dry cartons damaged');
  expect(reportWords('Fresh', [{ temp: 'chilled', units: 0, reason: null }], true)).toBe('chilled goods not cold');
  expect(reportAnsweredLine('1 chilled carton missing', 'send_replacements', { day: '2026-06-26', units: 1 }))
    .toBe('The depot answered your report, 1 chilled carton missing: a replacement comes on Fri 26 Jun');
  expect(reportAnsweredLine(report, 'send_replacements', { day: '2026-06-26', units: 3 })).toMatch(/: 3 replacements come on Fri 26 Jun$/);
  expect(reportAnsweredLine(report, 'no_replacement', null)).toMatch(/: no replacement$/);
});

// A trip with one stop of 48 chilled and 46 dry cartons on the truck, ended as asked.
function tripWith(outcome: 'refused' | 'closed', shopName = 'Fresh Wellawatte', brand: DriverTrip['brand'] = 'Fresh'): DriverTrip {
  const line = (temp: 'chilled' | 'dry', quantity: number, delivered: number | null) => ({ lineId: randomUUID(), orderId: randomUUID(), temp, productId: `fresh-${temp}-carton`,
    name: temp, unit: 'carton', quantity, loaded: quantity, wontFit: 0, delivered });
  return {
    tripId: randomUUID(), revision: 0, vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1, brand, district: 'Colombo', status: 'out',
    leavesAt: '2026-06-24T23:06:00.000Z', backBy: '2026-06-25T00:40:00.000Z', backByWords: 'back by 06:10', readyAt: null, leftAt: null, backAt: null, problems: [],
    stops: [{ id: randomUUID(), seq: 1, revision: 0, retriedAt: null, outletId: 'OUT002', shopName, district: 'Colombo', dockType: 'street', windowOpen: '05:30', windowClose: '08:00',
      note: null, arrivedAt: '2026-06-24T22:15:00.000Z', doneAt: '2026-06-24T22:18:00.000Z', outcome,
      lines: outcome === 'refused' ? [line('chilled', 48, 46), line('dry', 46, 46)] : [line('chilled', 48, null), line('dry', 46, null)] }],
  };
}

it('AC-3b words the driver\'s answer and its short form from the same figures as the phone', () => {
  const refused = tripWith('refused');
  const counts = tripFigures(refused).byStop[0]!;
  const stop = refused.stops[0]!;
  expect(driverAnswerShort({ kind: 'refused', decision: 'bring_back' }, stop, 'Fresh', counts)).toBe('Bring back · 2 chilled');
  expect(driverAnswerSentence({ kind: 'refused', decision: 'bring_back' }, stop, 'Fresh', counts, 'Peliyagoda')).toBe('Bring the 2 chilled cartons back to Peliyagoda.');
  // Replacements are the shop's news: the driver still brings the cartons back.
  expect(driverAnswerShort({ kind: 'refused', decision: 'send_replacements' }, stop, 'Fresh', counts)).toBe('Bring back · 2 chilled');
  expect(driverAnswerSentence({ kind: 'refused', decision: 'send_replacements' }, stop, 'Fresh', counts, 'Peliyagoda'))
    .toBe('Bring the 2 chilled cartons back to Peliyagoda. The shop gets 2 replacements on the next run.');
  const closed = tripWith('closed');
  const left = tripFigures(closed).byStop[0]!;
  expect(driverAnswerShort({ kind: 'closed', decision: 'bring_back' }, closed.stops[0]!, 'Fresh', left)).toBe('Bring back · 94 cartons');
  expect(driverAnswerShort({ kind: 'closed', decision: 'try_again' }, closed.stops[0]!, 'Fresh', left)).toBe('Try again · Fresh Wellawatte');
  expect(driverAnswerShort({ kind: 'closed', decision: 'bring_back' }, closed.stops[0]!, 'Style', left)).toBe('Bring back · 94 boxes');
  // Nothing to say while the problem is open.
  expect(driverAnswerShort({ kind: 'closed', decision: null }, closed.stops[0]!, 'Fresh', left)).toBe('');
});
