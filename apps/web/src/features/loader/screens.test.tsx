import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClockState, FlagReason, LoadingDay, LoadingDecision, LoadingIssue, LoadingStop, LoadingTruck } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { clockKey } from '@/lib/clock';
import { flagCounts, wholeCount } from './count';
import { Counter, FlagPage } from './FlagPage';
import { loadingKey } from './loading';
import { LeaveUnsent, SendingFirst } from './parts/ui';
import { lastLoaded } from './stops';
import { TruckPage } from './TruckPage';
import { TrucksPage } from './TrucksPage';
import { asksBeforeLeaving } from './unsent';
import { allOnLine, answerSentence, countHint, countLine, countWhere, leftLine, loadFigure, outOnLine, outOnWords, readyLine, readyNote, stopOnShort, undoFirstWords, undoStopWords } from './words';

// The loader's screens as the live QA run found them (phase 3, Q-16 to Q-23). The pages are drawn as the server would
// draw them, from a loading day in the query and the app clock at Thu 25 Jun 02:35. These fixtures live in the test only.

// The tab's own stores (the ticks, a kept refusal, the plan's changes) are read the same way on the server.
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useSyncExternalStore: <T,>(subscribe: (change: () => void) => () => void, snapshot: () => T, serverSnapshot?: () => T) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot ?? snapshot) };
});

type Line = [lineId: string, quantity: number, temp?: 'chilled' | 'dry'];
// short: how many of a line stay behind, and wontFit the lines among them that would not fit on the truck (L-09).
interface StopSpec { seq: number; shop: string; lines: Line[]; loaded?: boolean; short?: Record<string, number>; wontFit?: string[] }

const TRIP = '0b000000-0000-4000-8000-000000000038';

function stopOf({ seq, shop, lines, loaded = false, short = {}, wontFit = [] }: StopSpec): LoadingStop {
  const out = lines.map(([lineId, quantity, temp = 'dry']) => {
    const going = quantity - (short[lineId] ?? 0);
    return { lineId, orderId: `order-${lineId}`, temp, productId: `fresh-${temp}-carton`, name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', quantity, going, short: quantity - going,
      wontFit: wontFit.includes(lineId) ? quantity - going : 0 };
  });
  const sum = (key: 'quantity' | 'going' | 'short' | 'wontFit') => out.reduce((total, line) => total + line[key], 0);
  return { id: `stop-${seq}`, seq, outletId: `OUT00${seq}`, shopName: shop, loaded, units: sum('quantity'), going: sum('going'), short: sum('short'), wontFit: sum('wontFit'), lines: out };
}

// VEH038, the dry van of Q-16: Fresh Wellawatte's 46 and 2 dry cartons on stop 3, Fresh Kotahena's 57 on stop 2 and
// Fresh Nugegoda's 3 on stop 1, 108 in all, listed last stop first. `loaded` names the stops on the truck.
function veh038(loaded: number[], changes: Partial<LoadingTruck> = {}, short: Record<string, number> = {}, wontFit: string[] = []): LoadingTruck {
  const stops = [
    stopOf({ seq: 3, shop: 'Fresh Wellawatte', lines: [['w-46', 46], ['w-2', 2]], loaded: loaded.includes(3), short, wontFit }),
    stopOf({ seq: 2, shop: 'Fresh Kotahena', lines: [['k-57', 57]], loaded: loaded.includes(2), short, wontFit }),
    stopOf({ seq: 1, shop: 'Fresh Nugegoda', lines: [['n-3', 3]], loaded: loaded.includes(1), short, wontFit }),
  ];
  const on = stops.filter((stop) => stop.loaded).reduce((total, stop) => total + stop.going, 0);
  return {
    tripId: TRIP, revision: 4, vehicleId: 'VEH038', vehicleType: 'van', vehicleTemp: 'ambient', tripNo: 1, brand: 'Fresh', district: 'Colombo',
    status: 'loading', leavesAt: '2026-06-24T23:06:00.000Z', readyAt: null, driver: 'Dilshan', weightCapKg: 1200, volumeCapM3: 9,
    units: 108, on: { units: on, kg: on * 7, m3: on * 0.04 }, short: stops.reduce((total, stop) => total + stop.short, 0),
    wontFit: stops.reduce((total, stop) => total + stop.wontFit, 0), stops, issues: [], outOn: null, ...changes,
  };
}

const dayOf = (...trucks: LoadingTruck[]): LoadingDay => ({
  depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: { id: '0c000000-0000-4000-8000-000000000001', revision: 3, publishedAt: '2026-06-24T10:36:00.000Z', publishedBy: 'Ruwan' }, trucks, left: [],
});

// Thu 25 Jun 02:35 at the depot.
const CLOCK: ClockState = { demo: true, now: '2026-06-24T21:05:00.000Z', part: 'loading', holdsAt: null, next: null, revision: 1, day: 1 };

// A loader page at an address, drawn with the day in the query.
function page(path: string, day: LoadingDay): string {
  const qc = new QueryClient();
  qc.setQueryData(loadingKey, day);
  qc.setQueryData(clockKey, { ...CLOCK, heldAt: performance.now() });
  const router = createMemoryRouter([
    { path: '/loader', element: <TrucksPage /> },
    { path: '/loader/trucks/:tripId', element: <TruckPage /> },
    { path: '/loader/trucks/:tripId/flag', element: <FlagPage /> },
  ], { initialEntries: [path] });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}
const truckPage = (truck: LoadingTruck) => page(`/loader/trucks/${truck.tripId}`, dayOf(truck));

// The labels of the stop rows that open a menu.
const menus = (html: string) => [...html.matchAll(/<button[^>]*aria-haspopup="menu"[^>]*>/g)].map(([tag]) => tag.match(/aria-label="([^"]*)"/)?.[1]);

describe('Q-16 a stop marked loaded by mistake, and a flag on a loaded stop', () => {
  it('can take off only the stop loaded last, the loaded one with the lowest number', () => {
    expect(lastLoaded(veh038([3, 2]))?.seq).toBe(2);
    expect(lastLoaded(veh038([3]))?.seq).toBe(3);
    expect(lastLoaded(veh038([3, 2, 1]))?.seq).toBe(1);
    expect(lastLoaded(veh038([]))).toBeNull();
  });

  it('opens a menu from each loaded stop while the truck loads, and from no stop still to load', () => {
    expect(menus(truckPage(veh038([3, 2])))).toEqual(['More for stop 3, Fresh Wellawatte', 'More for stop 2, Fresh Kotahena']);
    expect(menus(truckPage(veh038([3, 2, 1])))).toEqual(['More for stop 3, Fresh Wellawatte', 'More for stop 2, Fresh Kotahena', 'More for stop 1, Fresh Nugegoda']);
    expect(menus(truckPage(veh038([])))).toEqual([]);
  });

  it('opens no menu before the truck is started', () => {
    expect(menus(truckPage(veh038([], { status: 'planned' })))).toEqual([]);
  });

  it('names the undo after the stop button, and the stop to undo first on an earlier one', () => {
    expect(undoStopWords({ seq: 3 })).toBe('Undo stop 3 loaded');
    expect(undoFirstWords({ seq: 2 })).toBe('undo stop 2 first');
  });

  it('opens the flag form on a loaded stop, with its lines', () => {
    const html = page(`/loader/trucks/${TRIP}/flag?stop=stop-3`, dayOf(veh038([3, 2])));
    expect(html).toContain('Stop 3 · Fresh Wellawatte');
    expect(html).toContain('46 cartons dry');
    expect(html).toContain('Send to dispatcher');
  });
});

// Kotahena's 57 dry cartons on VEH038's stop 2, as the counter shows them.
const kotahena = () => veh038([3]).stops[1]!.lines[0]!;
const counter = (text?: string, value = 57, where = 'at the dock') => renderToStaticMarkup(<Counter line={kotahena()} kind="Dry" where={where} value={value} text={text} disabled={false} onStep={() => {}} onType={() => {}} onLeave={() => {}} />);
const stepButtons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);

describe('Q-17 the flag\'s count box', () => {
  it('takes a whole number from 0 to the line\'s count, and nothing else: no minus, fraction or more than the line', () => {
    expect([wholeCount('0', 57), wholeCount('3', 57), wholeCount('57', 57), wholeCount('05', 57), wholeCount(' 7 ', 57), wholeCount('', 57)]).toEqual([0, 3, 57, 5, 7, 0]);
    for (const text of ['60', '999', '-3', '-0', '1.5', '+3', '3e1', 'three', '5 6']) expect(wholeCount(text, 57)).toBeNull();
  });

  it('says so under the box in the shop\'s words, with the line\'s count', () => {
    expect(countLine(57)).toBe('Whole numbers from 0 to 57.');
    expect(countLine(9)).toBe('Whole numbers from 0 to 9.');
  });

  it('shows a typed -3 as it is, marked, with the line under it, and − and + wait until it is fixed', () => {
    const html = counter('-3');
    expect(html).toMatch(/<input[^>]*value="-3"/);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    const line = html.match(/<p[^>]*id="([^"]+)"[^>]*>([^<]*)<\/p>/);
    expect(line?.[2]).toBe('Whole numbers from 0 to 57.');
    expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="${line?.[1]}"`));
    expect(stepButtons(html).every((tag) => /\sdisabled=""/.test(tag))).toBe(true);
  });

  it('shows 60 and 999 whole over 57, never cut to the line\'s count', () => {
    expect(counter('60')).toMatch(/<input[^>]*value="60"/);
    expect(counter('999')).toMatch(/<input[^>]*value="999"/);
    expect(counter('999')).not.toMatch(/<input[^>]*maxlength/i);
    expect(counter('60')).toContain('Whole numbers from 0 to 57.');
  });

  it('shows the count the form holds with no line when the box is right, and stops − at 0 and + at the line\'s count', () => {
    for (const html of [counter(undefined, 54), counter('054', 54)]) {
      expect(html).not.toContain('Whole numbers');
      expect(html).not.toMatch(/aria-invalid="true"/);
    }
    expect(counter(undefined, 54)).toMatch(/<input[^>]*value="54"/);
    const [less] = stepButtons(counter(undefined, 0));
    expect(less).toMatch(/disabled=""/);
    const [, more] = stepButtons(counter(undefined, 57));
    expect(more).toMatch(/disabled=""/);
  });

  it('keeps Send off while a box holds a wrong number, even one whose line is no longer picked', () => {
    const lines = veh038([3]).stops[0]!.lines;
    const none = new Set<string>();
    expect(flagCounts(lines, none, { 'w-46': 44 }, {})).toMatchObject({ canSend: true, wrong: [] });
    expect(flagCounts(lines, none, { 'w-46': 44 }, { 'w-46': '044' }).canSend).toBe(true);
    const wrong = flagCounts(lines, none, { 'w-46': 44 }, { 'w-46': '-3' });
    expect(wrong.canSend).toBe(false);
    expect(wrong.wrong.map((line) => line.lineId)).toEqual(['w-46']);
    expect(flagCounts(lines, none, { 'w-46': 44 }, { 'w-2': '3' }).canSend).toBe(false);
    expect(flagCounts(lines, none, {}, {}).canSend).toBe(false);
  });

  it('lists a line whose box holds a wrong number with what was typed, in red', () => {
    expect(flagCounts(veh038([3]).stops[0]!.lines, new Set(), {}, { 'w-2': '-3' }).shownOf(veh038([3]).stops[0]!.lines[1]!)).toEqual({ count: '-3', wrong: true });
    expect(flagCounts(veh038([3]).stops[0]!.lines, new Set(), { 'w-2': 1 }, {}).shownOf(veh038([3]).stops[0]!.lines[1]!)).toEqual({ count: '1', wrong: false });
  });
});

// A flag on VEH038's stop 2, Kotahena's 57 dry cartons counted at 54, raised at 02:33: open, or answered at 02:35.
function flagOn(truck: LoadingTruck, reason: FlagReason, decision: LoadingDecision | null = null): LoadingIssue {
  const stop = truck.stops[1]!;
  const line = stop.lines[0]!;
  return {
    id: '7c000000-0000-4000-8000-000000000002', revision: 1, kind: 'loading', reason, status: decision ? 'decided' : 'open', raisedBy: 'Kasun', raisedAt: '2026-06-24T21:03:00.000Z',
    note: null, decision, decidedBy: decision ? 'Ruwan' : null, decidedAt: decision ? '2026-06-24T21:05:00.000Z' : null, hasPhoto: false, short: 3, cold: null, replacement: null,
    trip: { id: truck.tripId, vehicleId: truck.vehicleId, tripNo: 1, leavesAt: truck.leavesAt, status: 'loading', driver: 'Dilshan', stopsLeft: 3 },
    stop: { id: stop.id, seq: stop.seq, outletId: stop.outletId, shopName: stop.shopName, arrivedAt: null, doneAt: null, loadedAt: null, flaggedAtDock: true },
    lines: [{ lineId: line.lineId, orderId: line.orderId, temp: 'dry', productId: line.productId, name: line.name, unit: 'carton', quantity: 57, counted: 54, loaded: null, delivered: null, received: null }],
  };
}

describe('Q-20 a truck that cannot take it all', () => {
  it('offers "Won\'t fit" beside Short, Damaged and Wrong item', () => {
    const html = page(`/loader/trucks/${TRIP}/flag?stop=stop-2`, dayOf(veh038([3]))).replaceAll('&#x27;', '\'');
    const reasons = [...html.matchAll(/<button[^>]*role="radio"[^>]*>([^<]*)<\/button>/g)].map(([, words]) => words);
    expect(reasons).toEqual(['Short', 'Damaged', 'Wrong item', 'Won\'t fit']);
  });

  it('counts what fits on the truck where the others count what is at the dock', () => {
    expect(countWhere('wont_fit')).toBe('fit on the truck');
    for (const reason of ['short', 'damaged', 'wrong_item'] as const) expect(countWhere(reason)).toBe('at the dock');
    expect(countHint('wont_fit')).toBe('Tap the line that will not all fit, then count what fits on the truck.');
    expect(countHint('short')).toBe('Tap the line that is not right, then count what is at the dock.');
    const html = counter(undefined, 54, countWhere('wont_fit'));
    expect(html).toContain('>fit on the truck<');
    expect(html).toMatch(/<input[^>]*aria-label="Dry fit on the truck"/);
  });

  it('tells the loader the answer in words about room, not stock', () => {
    const truck = veh038([3]);
    expect(answerSentence(flagOn(truck, 'wont_fit', 'go_short'))).toBe('Go without the 3 dry cartons that won\'t fit for Fresh Kotahena.');
    expect(answerSentence(flagOn(truck, 'wont_fit', 'load_all'))).toBe('Load it all for Fresh Kotahena. Make room for the rest.');
    expect(answerSentence(flagOn(truck, 'short', 'go_short'))).toBe('Go with 3 dry cartons short for Fresh Kotahena.');
    expect(answerSentence(flagOn(truck, 'short', 'load_all'))).toBe('Load it all for Fresh Kotahena. The rest comes from stock.');
  });
});

// A truck's load over its limits, as the card writes it.
const figure = (weightCapKg: number, kg: number, m3 = 0, volumeCapM3 = 7) => loadFigure(veh038([], { weightCapKg, volumeCapM3, on: { units: 0, kg, m3 } }));

describe('Q-21 the load\'s weight never rounds up to look full', () => {
  it('writes a vehicle under 2 t in kilos, rounded down, so a van with room never reads full', () => {
    expect(figure(1040, 959, 5.1)).toBe('959 / 1,040 kg · 5.1 / 7.0 m³');
    expect(figure(1000, 919)).toBe('919 / 1,000 kg · 0.0 / 7.0 m³');
    expect(figure(1040, 1039.6)).toBe('1,039 / 1,040 kg · 0.0 / 7.0 m³');
    expect(figure(1040, 1040)).toBe('1,040 / 1,040 kg · 0.0 / 7.0 m³');
    expect(figure(1040, 0)).toBe('0 / 1,040 kg · 0.0 / 7.0 m³');
    // The walkthrough's VEH035 with 117 of its 118 cartons on.
    expect(figure(1040, 807.3, 4.329)).toBe('807 / 1,040 kg · 4.3 / 7.0 m³');
  });

  it('writes a truck in tonnes to one place, rounded down, and never as its limit while weight is free', () => {
    expect(figure(6800, 4530, 21, 33.4)).toBe('4.5 / 6.8 t · 21.0 / 33.4 m³');
    expect(figure(6800, 6790, 0, 33.4)).toBe('6.7 / 6.8 t · 0.0 / 33.4 m³');
    expect(figure(6800, 6800, 0, 33.4)).toBe('6.8 / 6.8 t · 0.0 / 33.4 m³');
    // A limit that its one place rounds down: 6,840 kg reads 6.8 t, so 6,810 kg on must read below it.
    expect(figure(6840, 6810, 0, 33.4)).toBe('6.7 / 6.8 t · 0.0 / 33.4 m³');
    expect(figure(6840, 6840, 0, 33.4)).toBe('6.8 / 6.8 t · 0.0 / 33.4 m³');
    expect(figure(3990, 3950, 0, 22)).toBe('3.9 / 4.0 t · 0.0 / 22.0 m³');
    expect(figure(2000, 1999.9, 0, 9)).toBe('1.9 / 2.0 t · 0.0 / 9.0 m³');
  });

  it('reads the limit\'s own figure once the vehicle is full or over it, and never while weight is free', () => {
    // VEH002's limit is 3,990 kg, which its one place writes 4.0 t.
    expect(figure(3990, 3990, 0, 22)).toBe('4.0 / 4.0 t · 0.0 / 22.0 m³');
    expect(figure(3990, 4100, 0, 22)).toBe('4.0 / 4.0 t · 0.0 / 22.0 m³');
    expect(figure(3990, 3989.9, 0, 22)).toBe('3.9 / 4.0 t · 0.0 / 22.0 m³');
    expect(figure(6840, 7000, 0, 33.4)).toBe('6.8 / 6.8 t · 0.0 / 33.4 m³');
    expect(figure(1040, 1040)).toBe('1,040 / 1,040 kg · 0.0 / 7.0 m³');
    expect(figure(1040, 1045.5)).toBe('1,040 / 1,040 kg · 0.0 / 7.0 m³');
    expect(figure(1040, 1039.9)).toBe('1,039 / 1,040 kg · 0.0 / 7.0 m³');
  });

  it('keeps the cubic metres to the nearest tenth, as the walkthrough reads them', () => {
    // The walkthrough's VEH035 with stop 2 on: 94 cartons, 648.6 kg and 3.478 m³.
    expect(figure(1040, 648.6, 3.478)).toBe('648 / 1,040 kg · 3.5 / 7.0 m³');
  });

  it('shows the figure on the truck\'s card', () => {
    expect(truckPage(veh038([3]))).toContain('336 / 1,200 kg · 1.9 / 9.0 m³');
  });
});

describe('Q-22 a flag that was not sent is never left behind without a word', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });
  const form = at(`/loader/trucks/${TRIP}/flag`, '?stop=stop-2');

  it('asks before the loader leaves the form while its flag is on its way or not sent, wherever they go', () => {
    for (const to of [at(`/loader/trucks/${TRIP}`), at('/loader'), at('/loader/changes'), at(`/loader/trucks/${TRIP}/flag`, '?stop=stop-1')]) {
      expect(asksBeforeLeaving(true, form, to)).toBe(true);
      expect(asksBeforeLeaving(false, form, to)).toBe(false);
    }
    expect(asksBeforeLeaving(true, form, form)).toBe(false);
  });

  it('says the flag is not sent, and offers to send it again or to leave without it', () => {
    const html = renderToStaticMarkup(<LeaveUnsent onRetry={() => {}} onLeave={() => {}} />);
    expect(html).toMatch(/role="alertdialog"/);
    expect(html).toContain('This flag is not sent. If you leave now, the dispatcher may never see it.');
    expect([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, words]) => words)).toEqual(['Try again', 'Leave without sending']);
  });

  it('asks the same way before signing out, with Sign out anyway', () => {
    const html = renderToStaticMarkup(<LeaveUnsent signingOut onRetry={() => {}} onLeave={() => {}} />);
    expect(html).toMatch(/role="alertdialog"/);
    expect(html).toContain('This flag is not sent. If you sign out now, the dispatcher may never see it.');
    expect([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, words]) => words)).toEqual(['Try again', 'Sign out anyway']);
  });

  it('holds the loader while the flag is still on its way, and says so', () => {
    expect(renderToStaticMarkup(<SendingFirst />)).toContain('Sending the flag. You can leave once it is sent.');
  });

  it('shows the flag form as before while nothing is waiting', () => {
    const html = page(`/loader/trucks/${TRIP}/flag?stop=stop-2`, dayOf(veh038([3])));
    expect(html).not.toContain('This flag is not sent');
    expect(html).toContain('Send to dispatcher');
  });
});

// The truck page split where "Load in this order" starts: the cards above it, and each stop's row in it.
function sections(html: string) {
  const at = html.indexOf('aria-labelledby="load-order"');
  const rows = html.slice(at).split('<li>').slice(1);
  return { cards: html.slice(0, at), row: (shop: string) => rows.find((row) => row.includes(shop)) ?? '' };
}
const WAITING = 'Waiting for the dispatcher · flagged 02:33';

describe('Q-23 "Waiting for the dispatcher" stays with the flagged stop', () => {
  it('shows it in the flagged stop\'s row once that stop is loaded, not under the next stop\'s lines', () => {
    const loaded = veh038([3, 2], {}, { 'k-57': 3 });
    const html = truckPage({ ...loaded, issues: [flagOn(loaded, 'damaged')] });
    const { cards, row } = sections(html);
    expect(cards).toContain('Now loading · stop 1');
    expect(cards).not.toContain('Waiting for the dispatcher');
    expect(row('Fresh Kotahena')).toContain(WAITING);
    expect(row('Fresh Nugegoda')).not.toContain('Waiting for the dispatcher');
  });

  it('shows it under the lines of the stop being loaded when that stop is the flagged one', () => {
    const loading = veh038([3], {}, { 'k-57': 3 });
    const html = truckPage({ ...loading, issues: [flagOn(loading, 'short')] });
    const { cards, row } = sections(html);
    expect(cards).toContain('Now loading · stop 2');
    expect(cards.indexOf(WAITING)).toBeGreaterThan(cards.indexOf('57 cartons dry'));
    expect(row('Fresh Kotahena')).not.toContain('Waiting for the dispatcher');
  });

  it('shows it in the flagged stop\'s row once every stop is loaded', () => {
    const all = veh038([3, 2, 1], {}, { 'k-57': 3 });
    const html = truckPage({ ...all, issues: [flagOn(all, 'short')] });
    const { cards, row } = sections(html);
    expect(cards).toContain('All stops loaded');
    expect(cards).not.toContain('Waiting for the dispatcher');
    expect(row('Fresh Kotahena')).toContain(WAITING);
  });
});

// VEH038's trip 2 while the van is still out on trip 1, due back at 06:38, and VEH035 ahead of it at the dock.
const secondTrip = (changes: Partial<LoadingTruck> = {}) => veh038([], { tripId: '0b000000-0000-4000-8000-000000000382', tripNo: 2, status: 'planned', leavesAt: '2026-06-25T01:38:00.000Z', outOn: { tripNo: 1, backBy: '2026-06-25T01:08:00.000Z', words: 'out on trip 1 · back by 06:38' }, ...changes });
const veh035 = () => veh038([], { tripId: '0b000000-0000-4000-8000-000000000035', vehicleId: 'VEH035', status: 'planned' });

describe('Q-26 a second trip whose vehicle is still out on its first', () => {
  it('names the trip it is out on and when it is back, from the API\'s figures, in the brand\'s units', () => {
    expect(outOnWords(secondTrip().outOn!)).toBe('out on trip 1 · back by 06:38');
    expect(outOnLine(secondTrip())).toBe('VEH038 is out on trip 1 · back by 06:38. Put the cartons ready on the dock; they go on when it is back.');
    expect(outOnLine(secondTrip({ brand: 'Style' }))).toBe('VEH038 is out on trip 1 · back by 06:38. Put the boxes ready on the dock; they go on when it is back.');
    expect(outOnLine(secondTrip({ brand: null }))).toBe('VEH038 is out on trip 1 · back by 06:38. Put the units ready on the dock; they go on when it is back.');
  });

  it('says when the first trip was due back once that time has passed, as the API words it', () => {
    const late = secondTrip({ outOn: { tripNo: 1, backBy: '2026-06-25T01:08:00.000Z', words: 'out on trip 1 · was due back 06:38' } });
    expect(outOnWords(late.outOn!)).toBe('out on trip 1 · was due back 06:38');
    expect(outOnLine(late)).toBe('VEH038 is out on trip 1 · was due back 06:38. Put the cartons ready on the dock; they go on when it is back.');
  });

  it('says so in its Today\'s trucks row in place of when it leaves', () => {
    const html = page('/loader', dayOf(veh035(), secondTrip()));
    const row = html.slice(html.indexOf('VEH038 trip 2'));
    expect(row).toContain('out on trip 1 · back by 06:38');
    expect(row).not.toContain('leaves 07:08');
  });

  it('says so on the Next out card when it is the next truck out', () => {
    expect(page('/loader', dayOf(secondTrip()))).toContain('out on trip 1 · back by 06:38');
  });

  it('says so at the top of its load page, and still lets it start', () => {
    const html = truckPage(secondTrip());
    expect(html).toContain('VEH038 is out on trip 1 · back by 06:38. Put the cartons ready on the dock; they go on when it is back.');
    expect(html.indexOf('VEH038 is out on trip 1')).toBeLessThan(html.indexOf('Load in this order'));
    const start = [...html.matchAll(/<button[^>]*>Start loading VEH038 trip 2<\/button>/g)].map(([tag]) => tag);
    expect(start.length).toBeGreaterThan(0);
    expect(start.every((tag) => !/\sdisabled=""/.test(tag))).toBe(true);
  });

  it('says nothing of it once the vehicle is back', () => {
    expect(truckPage(secondTrip({ outOn: null }))).not.toContain('is out on trip');
    expect(page('/loader', dayOf(veh035(), secondTrip({ outOn: null })))).not.toContain('out on trip');
  });
});

// VEH011 trip 1, which Asanka drove away at 04:11 while its ready screen was open.
const LEFT = { tripId: TRIP, vehicleId: 'VEH011', tripNo: 1, driver: 'Asanka', leftAt: '2026-06-24T22:41:00.000Z' };
const PLAN_CHANGED = 'This truck is not on the list any more. The plan may have changed.';

describe('Q-34 a truck that has left the dock', () => {
  it('says who drove it away and when, with Back to trucks, in place of "The plan may have changed"', () => {
    const html = page(`/loader/trucks/${TRIP}`, { ...dayOf(), left: [LEFT] });
    expect(html).toContain('VEH011 left with Asanka at 04:11.');
    expect(html).toMatch(/<button[^>]*>Back to trucks<\/button>/);
    expect(html).not.toContain('The plan may have changed');
  });

  it('says the same on the flag form of a truck that has left', () => {
    const html = page(`/loader/trucks/${TRIP}/flag?stop=stop-2`, { ...dayOf(), left: [LEFT] });
    expect(html).toContain('VEH011 left with Asanka at 04:11.');
    expect(html).not.toContain('The plan may have changed');
  });

  it('keeps "The plan may have changed" for a truck the plan took away', () => {
    expect(page(`/loader/trucks/${TRIP}`, dayOf())).toContain(PLAN_CHANGED);
    expect(page(`/loader/trucks/${TRIP}`, { ...dayOf(), left: [{ ...LEFT, tripId: '0b000000-0000-4000-8000-000000000999' }] })).toContain(PLAN_CHANGED);
  });

  it('names a second trip, and leaves out a driver or a time the day does not have', () => {
    expect(leftLine({ ...LEFT, tripNo: 2 })).toBe('VEH011 trip 2 left with Asanka at 04:11.');
    expect(leftLine({ ...LEFT, driver: null })).toBe('VEH011 left at 04:11.');
    expect(leftLine({ ...LEFT, leftAt: null })).toBe('VEH011 left with Asanka.');
  });
});

describe('L-09 a line flagged won\'t fit', () => {
  // Fresh Nugegoda's 3 dry cartons with 1 that would not fit, and Kotahena's 57 with 2 short of stock.
  const truck = veh038([3, 2, 1], { status: 'ready' }, { 'n-3': 1, 'k-57': 2 }, ['n-3']);
  const nugegoda = truck.stops.find((stop) => stop.seq === 1)!;
  const kotahena = truck.stops.find((stop) => stop.seq === 2)!;

  it('reads "won\'t fit", not short, on the stop, the truck and the ready screen', () => {
    expect(stopOnShort(nugegoda)).toBe('2 on · 1 won\'t fit');
    expect(stopOnShort(kotahena)).toBe('55 on · 2 short');
    expect(allOnLine(truck)).toBe('105 of 108 on, 2 short, 1 won\'t fit');
    expect(readyLine(truck)).toMatch(/^105 of 108 on · 2 short · 1 won't fit · leaves /);
    expect(readyNote(truck)).toBe('Dilshan sees the short cartons and those that won\'t fit on stops 1 and 2 before driving.');
    const onlyWontFit = veh038([3, 2, 1], { status: 'ready' }, { 'n-3': 1 }, ['n-3']);
    expect(readyNote(onlyWontFit)).toBe('Dilshan sees the carton that won\'t fit on stop 1 before driving.');
  });

  it('tags the flagged line "3 won\'t fit" on the truck\'s page', () => {
    const flagged = veh038([3], {}, { 'k-57': 3 }, ['k-57']);
    const html = truckPage({ ...flagged, issues: [flagOn(flagged, 'wont_fit', 'go_short')] });
    expect(html).toContain('3 won&#x27;t fit');
    expect(html).not.toContain('3 short');
  });
});
