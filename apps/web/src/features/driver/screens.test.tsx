import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dayFigures, tripFigures, type ClockState, type DriverDay, type DriverLine, type DriverStop, type DriverTrip } from '@wayfinder/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { clockKey } from '@/lib/clock';
import { Counter } from './parts/Counter';
import { NO_PAIR, readBox, refusalPair, tallyFor } from './tally';
import { DayDone, HandBackCard, TripDone } from './DonePage';
import { NextStopPage } from './NextStopPage';
import { TodaysTrip } from './TripPage';
import { UnloadPage } from './UnloadPage';
import { tripsOf, type DriverView } from './view';
import { backByLine, backOnlineLines, handBack, headBackLine, lineName, loadedLine, loaderShortLine, overLoadedLine, placeLine, refusedLine, tripRows, wholeCountsLine } from './words';

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

// wontFit: of what the loader went short on, the units the truck could not take (L-09).
interface LineSpec { n: number; quantity: number; loaded?: number | null; wontFit?: number; delivered?: number | null; temp?: 'chilled' | 'dry'; name?: string; unit?: string }
function lineOf({ n, quantity, loaded = quantity, wontFit = 0, delivered = null, temp = 'chilled', name, unit = 'carton' }: LineSpec): DriverLine {
  return { lineId: id(3, n), orderId: id(4, n), temp, productId: `p-${n}`, name: name ?? (temp === 'chilled' ? 'Chilled carton' : 'Dry carton'), unit, quantity, loaded, wontFit, delivered };
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
    status: 'out', leavesAt: '2026-06-24T23:14:00.000Z', backBy: '2026-06-25T01:08:00.000Z', backByWords: 'back by 06:38', readyAt: '2026-06-24T21:40:00.000Z',
    leftAt: '2026-06-24T22:15:00.000Z', backAt: null, stops: [], problems: [], ...more,
  };
}

const dayOf = (...trips: DriverTrip[]): DriverDay => ({
  depot: 'Kandy', driver: 'Asitha', driverId: id(5, 54), day: '2026-06-25', planSent: true, appliedWriteIds: [], trips,
});

// What the phone shows for a day with nothing waiting, its trips picked as the phone picks them.
const viewOf = (day: DriverDay, waitingRecords = 0): DriverView => ({ ready: true, day, waiting: [], refused: [], waitingRecords, refusedRecords: 0, ...tripsOf(day) });

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
    tripNo: 2, status, leavesAt: at('07:08'), backBy: at('07:56'), backByWords: 'back by 07:56', readyAt: status === 'planned' || status === 'loading' ? null : at('03:59'),
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

describe('spec 013 the planned return once it has passed', () => {
  it('says the server\'s words, "was due back" once the time is gone, never a promise', () => {
    const late = tripOf(1, { backByWords: 'was due back 06:38' });
    expect(placeLine(late)).toBe('Fresh · Kandy · was due back 06:38');
    expect(backByLine(late)).toBe('was due back 06:38');
    expect(headBackLine(dayOf(late), late)).toBe('Head back to Kandy · was due back 06:38');
    expect(placeLine(tripOf(1))).toBe('Fresh · Kandy · back by 06:38');
  });
});

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
    const bar = barOf(tripDone({ backOnline: { names: ['Ampitiya', 'Mulgampola', 'Katukele'], belongsTo: [veh057trip1().tripId] } }));
    expect(textOf(bar)).toContain('Back online · 3 stops sent Ampitiya, Mulgampola and Katukele reached the depot');
    expect(bar).not.toMatch(/truncate|text-ellipsis|whitespace-nowrap/);
    // The band grows with its lines, rather than holding them to one fixed height.
    expect(bar).not.toMatch(/class="(?:[^"]*\s)?h-\[54px\]/);
  });
});

// ── Q-30 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Trip 2's first stop, Fresh Watapuluwa, with trip 1 checked in, under a green bar the sync loop holds.
const tripTwoFirstStop = (sync: Record<string, unknown>) => {
  hooks.sync = sync;
  const trip = veh057trip2('out');
  const day = dayOf(veh057trip1(), trip);
  const html = draw(<NextStopPage view={viewOf(day)} day={day} trip={trip} figures={tripFigures(trip)} stop={trip.stops[0]!} />);
  hooks.sync = {};
  return html;
};

describe('Q-30 the green bar belongs to its trip', () => {
  it('leaves trip 1\'s bar off trip 2\'s first stop', () => {
    const html = tripTwoFirstStop({ backOnline: { names: ['Ampitiya', 'Mulgampola', 'Katukele'], belongsTo: [veh057trip1().tripId] } });
    expect(barOf(html)).toBe('');
    expect(textOf(html)).toContain('Stop 1 of 1');
    expect(textOf(html)).toContain('Fresh Watapuluwa');
  });

  it('shows a bar whose records are this trip\'s', () => {
    const html = tripTwoFirstStop({ backOnline: { names: ['the start of the trip'], belongsTo: [veh057trip2().tripId] } });
    expect(textOf(barOf(html))).toContain('Back online · 1 record sent The start of the trip reached the depot');
  });
});

// ── Q-29 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Trip 2's Today's trip, with trip 1 checked in at 03:56.
const tripTwoToday = (trip2: DriverTrip, waitingRecords = 0) => {
  const view = viewOf(dayOf(veh057trip1(), trip2), waitingRecords);
  return textOf(draw(<TodaysTrip view={view} trip={view.trip!} figures={view.figures!} />));
};

describe('Q-29 checking in trip 1 when trip 2 is to come', () => {
  it('opens trip 2\'s Today\'s trip with trip 1\'s close on top and trip 1\'s hand-back card under it', () => {
    const text = tripTwoToday(veh057trip2());
    expect(text).toContain('Trip 1 closed · 4 of 4 stops · all records sent · checked in 03:56');
    expect(text).toContain('Still on the truck 39 cartons for Mulgampola, nobody at the shop. Hand them in; they go on the next run. The 4 chilled cartons for Mahaiyawa never left the depot.');
    expect(text.indexOf('Trip 1 closed')).toBeLessThan(text.indexOf('Still on the truck'));
    expect(text.indexOf('Still on the truck')).toBeLessThan(text.indexOf('Thu 25 Jun · trip 2'));
    expect(text).toContain('Not loaded yet');
  });

  it('says so while trip 1\'s records still wait to send', () => {
    expect(tripTwoToday(veh057trip2(), 1)).toContain('Trip 1 closed · 1 waiting to send · checked in 03:56');
  });

  it('keeps trip 1\'s close and hand-back while trip 2 is loaded and ready, and lets them go once trip 2 starts', () => {
    expect(tripTwoToday(veh057trip2('ready'))).toMatch(/Trip 1 closed[\s\S]*Still on the truck[\s\S]*Loaded · 122 of 122/);
    expect(tripsOf(dayOf(veh057trip1(), veh057trip2('loading'))).closed?.trip.tripNo).toBe(1);
    expect(tripsOf(dayOf(veh057trip1(), veh057trip2('out'))).closed).toBeNull();
  });

  it('shows no close before a day\'s first trip, or while trip 1 is still out', () => {
    expect(tripsOf(dayOf(veh057trip2())).closed).toBeNull();
    expect(tripsOf(dayOf(veh057trip1('out'), veh057trip2())).closed).toBeNull();
    const first = viewOf(dayOf(veh057trip2('planned', { tripNo: 1 })));
    expect(textOf(draw(<TodaysTrip view={first} trip={first.trip!} figures={first.figures!} />))).not.toMatch(/closed|Still on the truck|Nothing to hand back/);
  });
});

// ── Q-31 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Day done, every trip of the day checked in.
const dayDone = (...trips: DriverTrip[]) => {
  const view = viewOf(dayOf(...trips));
  return textOf(draw(<DayDone view={view} day={view.day!} trip={view.trip!} figures={view.figures!} />));
};

// VEH011 at Peliyagoda, Asanka's: trip 1 Fresh Colombo, 433 cartons, then trip 2 Style Colombo, 155 boxes.
const veh011 = () => [
  tripOf(11, { vehicleId: 'VEH011', status: 'done', backAt: at('04:15'), stops: [stopOf(11, 1, 'Fresh Borella', [{ n: 11, quantity: 433, temp: 'dry', delivered: 433 }], { doneAt: at('04:14'), outcome: 'delivered' })] }),
  tripOf(12, { vehicleId: 'VEH011', tripNo: 2, brand: 'Style', status: 'done', backAt: at('04:19'), stops: [
    stopOf(12, 1, 'Style Liberty Plaza', [{ n: 12, quantity: 155, temp: 'dry', name: 'Folded clothing', unit: 'box', delivered: 155 }], { doneAt: at('04:18'), outcome: 'delivered' }),
  ] }),
];

describe('Q-31 Day done after two trips', () => {
  it('adds the day up in the contracts, each trip once, beside each trip\'s own figures', () => {
    const day = dayFigures([veh057trip1(), veh057trip2('done')]);
    expect(day).toMatchObject({ trips: 2, stops: 5, stopsDone: 5, ordered: 270, loaded: 266, delivered: 227, refused: 0, notDelivered: 39, short: 4, onTruck: 39 });
    expect(day.byTrip.map(({ tripNo, figures }) => [tripNo, figures.stopsDone, figures.delivered, figures.loaded, figures.onTruck])).toEqual([[1, 4, 105, 144, 39], [2, 1, 122, 122, 0]]);
  });

  it('shows the whole day: a line per trip, the day\'s totals, then "Trip 3 · none today" and Sign out', () => {
    const text = dayDone(veh057trip1(), veh057trip2('done'));
    expect(text).toContain('Trip 2 closed · 1 of 1 stop · all records sent');
    expect(text).toContain('Back at Kandy Checked in at the depot 04:01');
    expect(text).toContain('Trip 1 4 of 4 stops · 105 of 144 cartons delivered · 39 handed back');
    expect(text).toContain('Trip 2 1 of 1 stop · 122 of 122 cartons delivered · nothing handed back');
    expect(text).toContain('Total 5 of 5 stops · 227 of 266 cartons delivered · 39 handed back');
    expect(text).toMatch(/Trip 1 [\s\S]*Trip 2 [\s\S]*Total [\s\S]*Trip 3 none today[\s\S]*Sign out/);
  });

  it('counts a day of two brands in units, each trip in its own', () => {
    const text = dayDone(...veh011());
    expect(text).toContain('Trip 1 1 of 1 stop · 433 of 433 cartons delivered · nothing handed back');
    expect(text).toContain('Trip 2 1 of 1 stop · 155 of 155 boxes delivered · nothing handed back');
    expect(text).toContain('Total 2 of 2 stops · 588 of 588 units delivered · nothing handed back');
    expect(text).toContain('Trip 3 none today');
  });

  it('keeps a one-trip Day done as the design draws it', () => {
    const text = dayDone(veh057trip1());
    expect(text).toContain('Trip closed · 4 of 4 stops · all records sent');
    expect(text).toContain('Stops 4 of 4 Cartons delivered 105 of 148');
    expect(text).toContain('Still on the truck');
    expect(text).toContain('Trip 2 none today');
    expect(text).not.toContain('Total');
  });
});

// ── Q-32 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Lakshan's VEH045 at Tech Kandy City Centre, and Asanka's VEH011 trip 2 at Style Liberty Plaza, both arrived.
function arrivedWith(n: number, brand: 'Style' | 'Tech', shop: string, lines: LineSpec[]) {
  const stop = stopOf(n, 1, shop, lines, { arrivedAt: at('04:02') });
  return { trip: tripOf(n, { brand, vehicleId: brand === 'Tech' ? 'VEH045' : 'VEH011', stops: [stop] }), stop };
}
const techCityCentre = () => arrivedWith(300, 'Tech', 'Tech Kandy City Centre', [
  { n: 301, quantity: 2, temp: 'dry', name: 'Refrigerators', unit: 'crate of 2' },
  { n: 302, quantity: 1, temp: 'dry', name: 'Refrigerators', unit: 'crate of 2' },
  { n: 303, quantity: 2, temp: 'dry', name: 'Small appliances', unit: 'pallet' },
  { n: 304, quantity: 2, temp: 'dry', name: 'Washing machines', unit: 'crate of 3' },
]);
const styleLibertyPlaza = () => arrivedWith(310, 'Style', 'Style Liberty Plaza', [
  { n: 311, quantity: 50, temp: 'dry', name: 'Folded clothing', unit: 'box' },
  { n: 312, quantity: 45, temp: 'dry', name: 'Hanging garments', unit: 'rail box' },
  { n: 313, quantity: 25, temp: 'dry', name: 'Shoes', unit: 'carton' },
]);
// The element that names a line on its card, by its words.
const nameOf = (html: string, words: string) => html.match(new RegExp(`<span[^>]*>${words}</span>`))?.[0] ?? '';

describe('Q-32 each line on Unload names its item in full', () => {
  it('names a Style or Tech line by its unit as the loader\'s list words it and the item, and a Fresh line by its temperature', () => {
    const tech = techCityCentre().stop.lines;
    expect(tech.map((line) => lineName(line, 'Tech'))).toEqual([
      'crates of 2 · Refrigerators', 'crate of 2 · Refrigerators', 'pallets · Small appliances', 'crates of 3 · Washing machines',
    ]);
    expect(styleLibertyPlaza().stop.lines.map((line) => lineName(line, 'Style'))).toEqual(['boxes · Folded clothing', 'rail boxes · Hanging garments', 'cartons · Shoes']);
    const fresh = arrivedAt().stop.lines;
    expect(fresh.map((line) => lineName(line, 'Fresh'))).toEqual(['Chilled', 'Dry']);
  });

  it('wraps a long name to a second line, with the count under it when the card is narrow, rather than cutting it', () => {
    for (const [at, words] of [[techCityCentre(), 'crates of 3 · Washing machines'], [styleLibertyPlaza(), 'rail boxes · Hanging garments']] as const) {
      const html = unload(at);
      const name = nameOf(html, words);
      expect(name).not.toBe('');
      expect(name).not.toMatch(/truncate|text-ellipsis|whitespace-nowrap|line-clamp/);
      // The card's row lets the counter go under the name, so the name keeps the card's width.
      expect(html.slice(html.lastIndexOf('<div', html.indexOf(name)), html.indexOf(name))).toMatch(/flex-wrap/);
    }
  });

  it('keeps a Fresh line as it was: its temperature beside the counter on one row', () => {
    const html = unload(arrivedAt());
    expect(nameOf(html, 'Chilled')).toMatch(/truncate/);
    expect(html.slice(html.lastIndexOf('<div', html.indexOf(nameOf(html, 'Chilled'))), html.indexOf(nameOf(html, 'Chilled')))).not.toMatch(/flex-wrap/);
  });
});

// ── The hand-back card's one and many ─────────────────────────────────────────────────────────────────────────────

// Wasantha's VEH035 in the landing recheck: Kotahena refused 1 chilled carton, and "Still on the truck" said "Hand them
// to the depot check." One carton is "it", more are "them", in every hand-back sentence.
describe('the hand-back card says it for one carton and them for more', () => {
  const problem = (stop: DriverStop, kind: 'refused' | 'closed', counted: number, decision: 'bring_back' | null) => ({
    id: id(6, stop.seq), kind, stopId: stop.id, reason: kind === 'refused' ? 'damaged' as const : 'nobody_there' as const, note: null, raisedAt: at('03:50'), hasPhoto: false,
    lines: [{ lineId: stop.lines[0]!.lineId, counted }], decision, decidedBy: decision ? 'Ruwan' : null, decidedAt: decision ? at('03:55') : null,
  });
  const card = (n: number) => {
    const done = (outcome: 'refused' | 'closed') => ({ arrivedAt: at('03:48'), doneAt: at('03:48'), outcome });
    const stops = [
      stopOf(11, 1, 'Fresh Kotahena', [{ n: 11, quantity: 53, delivered: 53 - n }], done('refused')),
      stopOf(12, 2, 'Fresh Wellawatte', [{ n: 12, quantity: n }], done('closed')),
      stopOf(13, 3, 'Fresh Dehiwala', [{ n: 13, quantity: n }], done('closed')),
    ];
    const trip = tripOf(35, { status: 'done', stops, problems: [problem(stops[0]!, 'refused', n, 'bring_back'), problem(stops[1]!, 'closed', n, 'bring_back'), problem(stops[2]!, 'closed', n, null)] });
    return handBack(trip, tripFigures(trip)).text;
  };

  it('says it for one', () => {
    expect(card(1)).toBe('1 chilled carton refused at Kotahena. Hand it to the depot check. '
      + '1 carton for Wellawatte, nobody at the shop. Hand it in; it goes on the next run. '
      + '1 carton for Dehiwala, nobody at the shop. The depot decides what happens to it.');
  });

  it('says them for more', () => {
    expect(card(2)).toBe('2 chilled cartons refused at Kotahena. Hand them to the depot check. '
      + '2 cartons for Wellawatte, nobody at the shop. Hand them in; they go on the next run. '
      + '2 cartons for Dehiwala, nobody at the shop. The depot decides what happens to them.');
  });
});

describe('L-09 a line the loader found would not fit', () => {
  // Fresh Nugegoda: 12 chilled cartons with 8 loaded and 4 that would not fit, and 4 dry with 3 loaded, 1 short of stock.
  const trip = tripOf(900, { stops: [stopOf(901, 1, 'Fresh Nugegoda', [{ n: 902, quantity: 12, loaded: 8, wontFit: 4 }, { n: 903, quantity: 4, loaded: 3, temp: 'dry' }])] });
  const figures = tripFigures(trip);
  const [chilled, dry] = trip.stops[0]!.lines as [DriverLine, DriverLine];

  it('reads "won\'t fit" on the loaded line, the count and Trip done, and "short" only for the short ones', () => {
    expect(loadedLine(trip, figures)).toBe('Loaded · 11 of 16 · 4 chilled won\'t fit for Nugegoda · 1 dry short for Nugegoda');
    expect(loaderShortLine(chilled, figures.byStop[0]!.byLine[0]!)).toBe('Loader flagged 4 cartons that won\'t fit on the truck');
    expect(loaderShortLine(dry, figures.byStop[0]!.byLine[1]!)).toBe('Loader flagged 1 carton short at the depot');
    expect(tripRows(trip, figures)).toEqual(expect.arrayContaining([
      { label: 'Short from the depot', value: '1 dry · Nugegoda' },
      { label: 'Won\'t fit on the truck', value: '4 chilled · Nugegoda' },
    ]));
    // L-20: what did not fit is never said under "Still on the truck", but under a heading of its own.
    expect(handBack(trip, figures)).toEqual({
      title: 'Nothing to hand back', text: 'The dry carton for Nugegoda never left the depot.',
      wontFit: { title: 'Didn\'t fit on the truck', text: 'The 4 chilled cartons for Nugegoda stayed at the depot.' },
    });
    const refused = { ...trip.stops[0]!, outcome: 'refused' as const };
    expect(refusedLine(refused, tripFigures({ ...trip, stops: [refused] }).byStop[0]!)).toBe('Stop 1 · 0 delivered · 11 refused · 1 short · 4 won\'t fit');
  });

  it('L-20 puts the cartons that did not fit under "Didn\'t fit on the truck" on Trip done, and keeps "Still on the truck" for what is on it', () => {
    // Wellawatte was closed and its 48 came back; Nugegoda's 4 never went on.
    const closed = stopOf(904, 2, 'Fresh Wellawatte', [{ n: 905, quantity: 48 }], { arrivedAt: at('03:40'), doneAt: at('03:40'), outcome: 'closed' });
    const nugegoda = { ...trip.stops[0]!, lines: [trip.stops[0]!.lines[0]!], arrivedAt: at('03:30'), doneAt: at('03:31'), outcome: 'delivered' as const };
    const done = { ...trip, status: 'done' as const, backAt: at('03:45'), stops: [{ ...nugegoda, lines: [{ ...nugegoda.lines[0]!, delivered: 8 }] }, closed] };
    const back = handBack(done, tripFigures(done));
    expect(back).toEqual({
      title: 'Still on the truck', text: '48 cartons for Wellawatte, nobody at the shop. The depot decides what happens to them.',
      wontFit: { title: 'Didn\'t fit on the truck', text: 'The 4 chilled cartons for Nugegoda stayed at the depot.' },
    });
    const text = textOf(draw(<HandBackCard trip={done} figures={tripFigures(done)} />));
    expect(text).toBe('Still on the truck 48 cartons for Wellawatte, nobody at the shop. The depot decides what happens to them. Didn\'t fit on the truck The 4 chilled cartons for Nugegoda stayed at the depot.');
  });

  it('L-19 counts the line against the 8 loaded, not the 12 ordered, and a stock-short line still against what was ordered', () => {
    expect(figures.byStop[0]!.byLine.map((line) => line.countTo)).toEqual([8, 4]);
    const stop = { ...trip.stops[0]!, arrivedAt: '2026-06-24T22:17:00.000Z' };
    const html = unload({ trip: { ...trip, stops: [stop] }, stop });
    const card = (label: string) => textOf(html.match(new RegExp(`aria-label="${label}"[\\s\\S]*?One more: ${label}`))?.[0] ?? '');
    expect(card('Chilled')).toContain('/8');
    expect(card('Dry')).toContain('/4');
  });
});

// ── Spec 025 ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('spec 025 AC-3b the trip\'s top line after the dispatcher answers', () => {
  it('keeps only the answer\'s picture and short form, never the full sentence', async () => {
    const { ANSWER_ICON } = await import('@/features/notifications/icons');
    const html = tripDone({});
    // Mulgampola was closed and Ruwan answered Bring them back: 39 chilled cartons.
    expect(textOf(html)).toContain('Stop 3 · not delivered · nobody there');
    expect(textOf(html)).toContain('Bring back · 39 chilled');
    expect(html).toContain(`src="${ANSWER_ICON.bring_back}"`);
    expect(textOf(html)).not.toContain('Bring the 39 cartons back');
  });
});

// D2: an unread queue and refused records cannot be described as sent.
it('D2 the waiting sheet distinguishes unread, queued, refused and acknowledged records', async () => {
  const { waitingSheetTitle } = await import('./words');
  expect(waitingSheetTitle(false, 0, 0)).toBe('Records on this phone have not been read.');
  expect(waitingSheetTitle(true, 2, 0)).toBe('Waiting to send · 2');
  expect(waitingSheetTitle(true, 0, 1)).toBe('1 record not accepted');
  expect(waitingSheetTitle(true, 0, 2)).toBe('2 records not accepted');
  expect(waitingSheetTitle(true, 0, 0)).toBe('Everything is sent.');
});

it('B3 explains the app-clock reload time and keeps Start trip disabled until it passes', () => {
  const trip = { ...veh057trip2('ready'), startAfter: at('04:26'), startBlocked: null };
  const view = viewOf(dayOf(trip));
  const html = draw(<TodaysTrip view={view} trip={trip} figures={view.figures!} />);
  expect(textOf(html)).toContain('Reload until 04:26');
  expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Start trip/);
});

it('B3 shows the server loading action for old premature readiness instead of enabling departure', () => {
  const trip = { ...veh057trip2('ready'), startAfter: null, startBlocked: 'Ask the loader to reload trip 2 after trip 1 returns.' };
  const view = viewOf(dayOf(trip));
  const html = draw(<TodaysTrip view={view} trip={trip} figures={view.figures!} />);
  expect(textOf(html)).toContain(trip.startBlocked);
  expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Start trip/);
});

it('B3 keeps first-trip early departure available and allows a confirmed second trip after reload', () => {
  for (const trip of [veh057trip2('ready', { tripNo: 1 }), { ...veh057trip2('ready'), startAfter: at('03:46'), startBlocked: null }]) {
    const view = viewOf(dayOf(trip));
    const html = draw(<TodaysTrip view={view} trip={trip} figures={view.figures!} />);
    expect(html).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Start trip/);
  }
});
