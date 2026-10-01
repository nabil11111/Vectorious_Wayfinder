import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tripFigures, type ClockState, type DriverDay, type DriverLine, type DriverStop, type DriverTrip } from '@wayfinder/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { clockKey } from '@/lib/clock';
import { Counter } from './parts/Counter';
import { NO_PAIR, readBox, refusalPair, tallyFor } from './tally';
import { TripDone } from './DonePage';
import { UnloadPage } from './UnloadPage';
import type { DriverView } from './view';
import { backOnlineLines, overLoadedLine, wholeCountsLine } from './words';

// The driver's screens as the live QA run found them (phase 4, Q-25 to Q-32). The pages are drawn as the phone would
// draw them, from a day as the server sends it and the app clock on Thu 25 Jun. These fixtures live in the test only.

// The tab's own stores (the tally, the sync state) are read the same way on the server.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useSyncExternalStore: <T,>(subscribe: (change: () => void) => () => void, snapshot: () => T, serverSnapshot?: () => T) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot ?? snapshot) };
});

// The phone's signal and its sync loop's state, as each test sets them: a signal, and nothing waiting by default.
const hooks = vi.hoisted(() => ({ signal: true, sync: {} as Record<string, unknown> }));
vi.mock('@/lib/phone/signal', async (original) => ({ ...await original<typeof import('@/lib/phone/signal')>(), useSignal: () => hooks.signal, hasSignal: () => hooks.signal }));
vi.mock('./queue', async (original) => {
  const queue = await original<typeof import('./queue')>();
  return { ...queue, useSync: () => ({ signedOut: false, fetched: true, failure: null, backOnline: null, notSaved: false, unanswered: [], ...hooks.sync }) };
});

// ── The day ───────────────────────────────────────────────────────────────────────────────────────────────────────

const id = (kind: number, n: number) => `0${kind}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface LineSpec { n: number; quantity: number; loaded?: number | null; delivered?: number | null; temp?: 'chilled' | 'dry'; name?: string; unit?: string }
function lineOf({ n, quantity, loaded = quantity, delivered = null, temp = 'chilled', name, unit = 'carton' }: LineSpec): DriverLine {
  return { lineId: id(3, n), orderId: id(4, n), temp, productId: `p-${n}`, name: name ?? (temp === 'chilled' ? 'Chilled carton' : 'Dry carton'), unit, quantity, loaded, delivered };
}

function stopOf(n: number, seq: number, shopName: string, lines: LineSpec[], more: Partial<DriverStop> = {}): DriverStop {
  return {
    id: id(2, n), seq, revision: 0, retriedAt: null, outletId: `OUT${String(n).padStart(3, '0')}`, shopName, district: 'Kandy', dockType: 'street',
    windowOpen: '03:00', windowClose: '08:00', note: null, arrivedAt: null, doneAt: null, outcome: null, lines: lines.map(lineOf), ...more,
  };
}

function tripOf(n: number, more: Partial<DriverTrip> = {}): DriverTrip {
  return {
    tripId: id(1, n), revision: 3, vehicleId: 'VEH057', vehicleType: 'van', vehicleTemp: 'reefer', tripNo: 1, brand: 'Fresh', district: 'Kandy',
    status: 'out', leavesAt: '2026-06-24T23:14:00.000Z', backBy: '2026-06-25T01:08:00.000Z', readyAt: '2026-06-24T21:40:00.000Z',
    leftAt: '2026-06-24T22:15:00.000Z', backAt: null, stops: [], problems: [], ...more,
  };
}

const dayOf = (...trips: DriverTrip[]): DriverDay => ({
  depot: 'Kandy', driver: 'Asitha', driverId: id(5, 54), day: '2026-06-25', planSent: true, appliedWriteIds: [], trips,
});

// What the phone shows for a day with nothing waiting: the first trip that is not done, or the last once all are.
function viewOf(day: DriverDay): DriverView {
  const open = day.trips.find((trip) => trip.status !== 'done') ?? null;
  const trip = open ?? day.trips.at(-1) ?? null;
  return {
    ready: true, day, waiting: [], refused: [], waitingRecords: 0, refusedRecords: 0,
    trip, figures: trip ? tripFigures(trip) : null, allDone: open === null && trip !== null,
  };
}

// Thu 25 Jun at the depot, "03:47" as an instant.
const at = (time: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 5, 24, 18, 30) + (h * 60 + m) * 60_000).toISOString();
};

// VEH057 trip 1 at Kandy, Asitha's, as the QA run drove it: Fresh Mahaiyawa took 5 of its 9 chilled cartons (the loader
// went 4 short), Ampitiya 42, Mulgampola was closed and its 39 cartons were brought back, and Katukele took 58. 105 of
// 148 delivered. `status` is where the trip is; with 'done' it was checked in at 03:56.
const MULGAMPOLA_PROBLEM = id(6, 1);
function veh057trip1(status: 'out' | 'done' = 'done'): DriverTrip {
  const done = (time: string, outcome: 'delivered' | 'closed') => ({ arrivedAt: at(time), doneAt: at(time), outcome });
  const stops = [
    stopOf(1, 1, 'Fresh Mahaiyawa', [{ n: 1, quantity: 9, loaded: 5, delivered: 5 }], done('03:48', 'delivered')),
    stopOf(2, 2, 'Fresh Ampitiya', [{ n: 2, quantity: 42, delivered: 42 }], done('03:48', 'delivered')),
    stopOf(3, 3, 'Fresh Mulgampola', [{ n: 3, quantity: 39 }], done('03:50', 'closed')),
    stopOf(4, 4, 'Fresh Katukele', [{ n: 4, quantity: 50, delivered: 50 }, { n: 5, quantity: 8, delivered: 8 }], done('03:51', 'delivered')),
  ];
  return tripOf(57, {
    status, leftAt: at('03:45'), backAt: status === 'done' ? at('03:56') : null, stops,
    problems: [{
      id: MULGAMPOLA_PROBLEM, kind: 'closed', stopId: stops[2]!.id, reason: 'nobody_there', note: 'Gate locked, lights off.', raisedAt: at('03:50'), hasPhoto: true,
      lines: [{ lineId: stops[2]!.lines[0]!.lineId, counted: 39 }], decision: 'bring_back', decidedBy: 'Ruwan', decidedAt: at('03:55'),
    }],
  });
}

// VEH057 trip 2: Fresh Watapuluwa's 57 chilled and 65 dry cartons, leaving 07:08. Planned until the loader starts it.
function veh057trip2(status: DriverTrip['status'] = 'planned', more: Partial<DriverTrip> = {}): DriverTrip {
  // Nothing is loaded before the trip is ready, and all of it is delivered once it is done.
  const loaded = status === 'planned' || status === 'loading' ? null : undefined;
  const delivered = (n: number) => (status === 'done' ? n : null);
  const stop = stopOf(9, 1, 'Fresh Watapuluwa', [
    { n: 9, quantity: 57, loaded, delivered: delivered(57) }, { n: 10, quantity: 65, temp: 'dry', loaded, delivered: delivered(65) },
  ], status === 'done' ? { arrivedAt: at('04:00'), doneAt: at('04:01'), outcome: 'delivered' } : {});
  return tripOf(58, {
    tripNo: 2, status, leavesAt: at('07:08'), backBy: at('07:56'), readyAt: status === 'planned' || status === 'loading' ? null : at('03:59'),
    leftAt: status === 'out' || status === 'done' ? at('03:59') : null, backAt: status === 'done' ? at('04:01') : null, stops: [stop], ...more,
  });
}

// Thu 25 Jun 03:47 at the depot.
const CLOCK: ClockState ={ demo: true, now: '2026-06-24T22:17:00.000Z', part: 'on_the_road', holdsAt: null, next: null, revision: 1, day: 1 };

// A driver screen, drawn with the app clock in the query.
function draw(element: ReactNode): string {
  const qc = new QueryClient();
  qc.setQueryData(clockKey, { ...CLOCK, heldAt: performance.now() });
  const router = createMemoryRouter([{ path: '/driver', element }], { initialEntries: ['/driver'] });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

// The text of a page, its tags taken out.
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const buttonsOf = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
// The opening tag of the button whose words include the name.
const buttonNamed = (html: string, name: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>)[\\s\\S])*?${name}`))?.[0].match(/^<button[^>]*>/)?.[0] ?? '';
const doneUnloading = (html: string) => buttonNamed(html, 'Done unloading');

// ── Q-25 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Fresh Mahaiyawa as stop 1 of VEH057, arrived: 12 chilled loaded of 12, and 10 chilled of 10. One stop of its own per
// test, so the tally of one test never reaches another's.
let stops = 0;
function arrivedAt() {
  stops += 1;
  const stop = stopOf(100 + stops, 1, 'Fresh Mahaiyawa', [{ n: 100 + stops * 2, quantity: 12 }, { n: 101 + stops * 2, quantity: 10, temp: 'dry' }], { arrivedAt: '2026-06-24T22:17:00.000Z' });
  const trip = tripOf(100 + stops, { stops: [stop] });
  return { trip, stop, tally: tallyFor(stop.id), chilled: stop.lines[0]!, dry: stop.lines[1]! };
}
const unload = ({ trip, stop }: { trip: DriverTrip; stop: DriverStop }) => draw(<UnloadPage view={viewOf(dayOf(trip))} trip={trip} figures={tripFigures(trip)} stop={stop} />);
const boxOf = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

describe('Q-25 the driver\'s unload count', () => {
  it('reads a box as a count from 0 to what was loaded, a whole number over it, or something that is not a count', () => {
    expect(['0', '12', '012', ' 7 ', ''].map((text) => readBox(text, 12))).toEqual([
      { kind: 'count', count: 0 }, { kind: 'count', count: 12 }, { kind: 'count', count: 12 }, { kind: 'count', count: 7 }, { kind: 'count', count: 0 },
    ]);
    expect(readBox('15', 12)).toEqual({ kind: 'over', count: 15 });
    expect(readBox('99', 44)).toEqual({ kind: 'over', count: 99 });
    for (const text of ['-3', '-5', '-0', '1.5', '+3', '3e1', 'three', '5 6']) expect(readBox(text, 12)).toEqual({ kind: 'not_whole' });
  });

  it('says what is wrong in plain words, with the count loaded', () => {
    expect(wholeCountsLine(12)).toBe('Counts are whole numbers from 0 to the 12 loaded.');
    expect(overLoadedLine(15, 12, 'Fresh')).toBe('15 is more than the 12 loaded. Check the stack for another shop\'s cartons.');
    expect(overLoadedLine(3, 2, 'Tech')).toBe('3 is more than the 2 loaded. Check the stack for another shop\'s items.');
  });

  it('keeps 15 typed over the 12 loaded as it is, in red, says so, and keeps Done unloading off', () => {
    const at = arrivedAt();
    at.tally.step(at.dry.lineId, 10);
    at.tally.type(at.chilled.lineId, '15', 12);
    const html = unload(at);
    expect(boxOf(html, 'Chilled')).toMatch(/value="15"/);
    expect(boxOf(html, 'Chilled')).toMatch(/aria-invalid="true"/);
    expect(textOf(html)).toContain('15 is more than the 12 loaded. Check the stack for another shop\'s cartons.');
    expect(doneUnloading(html)).toMatch(/disabled=""/);
    // Leaving the box changes nothing: the number stays as typed, and is never turned into 12.
    at.tally.leave(at.chilled.lineId, 12);
    expect(boxOf(unload(at), 'Chilled')).toMatch(/value="15"/);
    expect(at.tally.countOf(at.chilled.lineId)).not.toBe(12);
  });

  it('keeps a typed minus or fraction as it is, says counts are whole numbers to the load, and keeps Done unloading off', () => {
    for (const text of ['-3', '1.5']) {
      const at = arrivedAt();
      at.tally.step(at.chilled.lineId, 12);
      at.tally.type(at.dry.lineId, text, 10);
      const html = unload(at);
      expect(boxOf(html, 'Dry')).toMatch(new RegExp(`value="${text}"`));
      expect(boxOf(html, 'Dry')).toMatch(/aria-invalid="true"/);
      expect(textOf(html)).toContain('Counts are whole numbers from 0 to the 10 loaded.');
      expect(doneUnloading(html)).toMatch(/disabled=""/);
    }
  });

  it('keeps Done unloading off while one box is wrong, though every count it holds matches the load', () => {
    const at = arrivedAt();
    at.tally.step(at.chilled.lineId, 12);
    at.tally.step(at.dry.lineId, 10);
    expect(doneUnloading(unload(at))).not.toMatch(/disabled=""/);
    at.tally.type(at.chilled.lineId, '12-', 12);
    expect(at.tally.countOf(at.chilled.lineId)).toBe(12);
    expect(doneUnloading(unload(at))).toMatch(/disabled=""/);
  });

  it('takes a typed count from 0 to the load, shows "012" as 12 once the box is left, and lights Done unloading', () => {
    const at = arrivedAt();
    at.tally.type(at.chilled.lineId, '012', 12);
    at.tally.type(at.dry.lineId, '10', 10);
    expect(at.tally.countOf(at.chilled.lineId)).toBe(12);
    const typing = unload(at);
    expect(boxOf(typing, 'Chilled')).toMatch(/value="012"/);
    expect(boxOf(typing, 'Chilled')).not.toMatch(/aria-invalid/);
    at.tally.leave(at.chilled.lineId, 12);
    const left = unload(at);
    expect(boxOf(left, 'Chilled')).toMatch(/value="12"/);
    expect(textOf(left)).not.toMatch(/Counts are|more than the/);
    expect(doneUnloading(left)).not.toMatch(/disabled=""/);
  });

  it('keeps a typed minus in a refusal\'s box as it is, with the pair\'s last count, and a count from either box sets both', () => {
    // Wellawatte's 48 chilled cartons: 2 refused by stepping, then -3 typed in Refused.
    let pair = refusalPair.step(NO_PAIR, 'w', 'refused', 2, 48);
    expect([refusalPair.refusedOf(pair, 'w'), refusalPair.textOf(pair, 'w', 'accepted')]).toEqual([2, undefined]);
    pair = refusalPair.type(pair, 'w', 'refused', '-3', 48);
    expect(refusalPair.textOf(pair, 'w', 'refused')).toBe('-3');
    expect(refusalPair.refusedOf(pair, 'w')).toBe(2);
    expect(refusalPair.isWrong(pair, 'w', 'refused', 48)).toBe(true);
    // Leaving the box keeps the minus; more than was loaded is no count either.
    expect(refusalPair.textOf(refusalPair.leave(pair, 'w', 'refused', 48), 'w', 'refused')).toBe('-3');
    expect(refusalPair.isWrong(refusalPair.type(pair, 'w', 'accepted', '50', 48), 'w', 'accepted', 48)).toBe(true);
    // 45 typed in Accepted is 3 refused, and the minus in Refused gives way to it.
    pair = refusalPair.type(pair, 'w', 'accepted', '45', 48);
    expect(refusalPair.refusedOf(pair, 'w')).toBe(3);
    expect([refusalPair.textOf(pair, 'w', 'refused'), refusalPair.isWrong(pair, 'w', 'refused', 48)]).toEqual([undefined, false]);
    expect(refusalPair.textOf(refusalPair.leave(pair, 'w', 'accepted', 48), 'w', 'accepted')).toBeUndefined();
    // A line no longer picked takes its boxes with it.
    expect(refusalPair.isWrong(refusalPair.drop(refusalPair.type(pair, 'w', 'refused', '1.5', 48), 'w'), 'w', 'refused', 48)).toBe(false);
  });

  it('greys − and + while the box holds something that is not a count, as the loader\'s and the shop\'s boxes do', () => {
    const html = renderToStaticMarkup(<Counter label="Chilled" value={3} text="-3" max={12} of={12} invalid="fix" onStep={() => {}} onType={() => {}} onLeave={() => {}} />);
    expect(html).toMatch(/<input[^>]*value="-3"/);
    expect(html).toMatch(/<input[^>]*aria-describedby="fix"/);
    expect(html).not.toMatch(/<input[^>]*maxlength/i);
    expect(buttonsOf(html).every((tag) => /\sdisabled=""/.test(tag))).toBe(true);
    const fine = renderToStaticMarkup(<Counter label="Chilled" value={3} max={12} of={12} onStep={() => {}} onType={() => {}} onLeave={() => {}} />);
    expect(fine).toMatch(/<input[^>]*value="3"/);
    expect(buttonsOf(fine).some((tag) => /\sdisabled=""/.test(tag))).toBe(false);
  });
});

// ── Q-27 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Trip done on VEH057 trip 1 at 03:52, its last stops saved with no signal and just sent.
const tripDone = (sync: Record<string, unknown>) => {
  hooks.sync = sync;
  const trip = veh057trip1('out');
  const day = dayOf(trip, veh057trip2());
  const html = draw(<TripDone view={viewOf(day)} day={day} trip={trip} figures={tripFigures(trip)} />);
  hooks.sync = {};
  return html;
};
// The green bar: from its green band to its closing tick, or '' when there is none.
function barOf(html: string) {
  const words = html.indexOf('Back online');
  if (words === -1) return '';
  const band = html.lastIndexOf('<div', html.lastIndexOf('bg-good-tint', words));
  return html.slice(band, html.indexOf('</button>', words) + '</button>'.length);
}

describe('Q-27 "Back online" names the stops that reached the depot', () => {
  it('names every stop up to three, and three and the count of the rest beyond', () => {
    expect(backOnlineLines(['Ampitiya', 'Mulgampola', 'Katukele'])).toEqual({
      title: 'Back online · 3 stops sent', line: 'Ampitiya, Mulgampola and Katukele reached the depot',
    });
    expect(backOnlineLines(['Ampitiya', 'Mulgampola', 'Katukele', 'Watapuluwa', 'Mahaiyawa'])).toEqual({
      title: 'Back online · 5 stops sent', line: 'Ampitiya, Mulgampola, Katukele and 2 more reached the depot',
    });
    expect(backOnlineLines(['Ampitiya', 'Mulgampola', 'Katukele', 'the end of the trip']).line).toBe('Ampitiya, Mulgampola, Katukele and 1 more reached the depot');
    expect(backOnlineLines(['Wellawatte']).line).toBe('Wellawatte reached the depot');
  });

  it('wraps its lines at the phone\'s width rather than cutting them', () => {
    const bar = barOf(tripDone({ backOnline: ['Ampitiya', 'Mulgampola', 'Katukele'] }));
    expect(textOf(bar)).toContain('Back online · 3 stops sent Ampitiya, Mulgampola and Katukele reached the depot');
    expect(bar).not.toMatch(/truncate|text-ellipsis|whitespace-nowrap/);
    // The band grows with its lines, rather than holding them to one fixed height.
    expect(bar).not.toMatch(/class="(?:[^"]*\s)?h-\[54px\]/);
  });
});
