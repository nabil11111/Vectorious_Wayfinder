import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Issue } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { issueTitle, reportTitle, sentLine } from '@/features/loader/words';
import { reasonWords } from '@/features/lookup/words';
import { IssueCard } from './IssueCard';
import type { Answering } from './issues';
import { needsYouTitle, problemLine, problemWord } from './words';

// Q-20: a truck that cannot take it all is flagged "won't fit", and the dispatcher reads it as no room on the truck,
// not as missing stock. These fixtures live in the test only.

// Sarath's flag on VEH057 at Thu 03:08: 4 of Fresh Mahaiyawa's 9 chilled cartons will not go in the full van.
const WONT_FIT: Issue = {
  id: '7c000000-0000-4000-8000-000000000020', revision: 0, kind: 'loading', reason: 'wont_fit', status: 'open',
  raisedBy: 'Sarath', raisedAt: '2026-06-24T21:38:00.000Z', note: 'The cold space is packed', decision: null, decidedBy: null, decidedAt: null,
  hasPhoto: false, short: 4, cold: null, replacement: null,
  trip: { id: '0b000000-0000-4000-8000-000000000057', vehicleId: 'VEH057', tripNo: 1, leavesAt: '2026-06-24T23:00:00.000Z', status: 'loading', driver: 'Nuwan', stopsLeft: 1 },
  stop: { id: '0d000000-0000-4000-8000-000000000001', seq: 1, outletId: 'OUT077', shopName: 'Fresh Mahaiyawa', arrivedAt: null, doneAt: null, loadedAt: null, flaggedAtDock: true },
  lines: [{ lineId: 'l-9', orderId: 'o-9', temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 9, counted: 5, loaded: null, delivered: null, received: null }],
};
// Kasun's walkthrough flag: 3 of Fresh Nugegoda's 4 dry cartons at the dock.
const SHORT: Issue = {
  ...WONT_FIT, id: '7c000000-0000-4000-8000-000000000012', reason: 'short', raisedBy: 'Kasun', short: 1,
  trip: { ...WONT_FIT.trip, vehicleId: 'VEH035' }, stop: { ...WONT_FIT.stop, shopName: 'Fresh Nugegoda' },
  lines: [{ ...WONT_FIT.lines[0]!, temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', quantity: 4, counted: 3 }],
};

const ANSWERING: Answering = { sending: null, failed: null, refused: null, sent: null, decide: () => {} };
const card = (issue: Issue, depot: string) => renderToStaticMarkup(<IssueCard issue={issue} depot={depot} answering={ANSWERING} time />).replaceAll('&#x27;', '\'');

describe('Q-20 the dispatcher reads a won\'t fit flag as no room on the truck', () => {
  it('titles it "won\'t fit" on Live day\'s card, the dashboard\'s row and a truck\'s row', () => {
    expect(issueTitle(WONT_FIT)).toBe('4 chilled cartons won\'t fit');
    expect(problemLine(WONT_FIT)).toBe('Fresh Mahaiyawa · 4 chilled cartons won\'t fit');
    expect(problemWord('loading', WONT_FIT)).toBe('4 won\'t fit');
    expect(reasonWords('wont_fit')).toBe('won\'t fit');
  });

  it('shows the count that fits and the same two answers, in words about room and not about stock', () => {
    const html = card(WONT_FIT, 'Kandy');
    expect(html).toContain('4 chilled cartons won\'t fit');
    expect(html).toMatch(/Fits<\/dt><dd[^>]*>5 of 9 chilled cartons</);
    expect(html).toContain('Go short');
    expect(html).toContain('The truck leaves with what fits.');
    expect(html).toContain('Load it all');
    expect(html).toContain('Make room on the truck for the rest.');
    expect(html).not.toContain('short</h3>');
    expect(html).not.toContain('At the dock');
    expect(html).not.toContain('comes from stock');
    expect(html).not.toContain('what is at the dock');
  });

  it('keeps a short flag\'s words as they were', () => {
    const html = card(SHORT, 'Peliyagoda');
    expect(html).toContain('1 dry carton short');
    expect(html).toMatch(/At the dock<\/dt><dd[^>]*>3 of 4 dry cartons</);
    expect(html).toContain('The truck leaves with what is at the dock.');
    expect(html).toContain('The rest comes from stock and goes on.');
  });

  it('says what was sent in the green line', () => {
    expect(sentLine({ ...WONT_FIT, status: 'decided', decision: 'go_short' })).toBe('VEH057 goes without the 4 chilled cartons that won\'t fit, Sarath told');
    expect(sentLine({ ...WONT_FIT, status: 'decided', decision: 'load_all' })).toBe('VEH057 loads it all, Sarath told');
    expect(sentLine({ ...SHORT, status: 'decided', decision: 'go_short' })).toBe('VEH035 goes 1 dry carton short, Kasun told');
  });
});

// Q-40: Malinda's report at Tech Kandy City Centre, 08:56: one refrigerator crate came damaged and one pallet of small
// appliances never came, with a note. Each line keeps its own reason, and the note goes with the report.
const TECH_REPORT: Issue = {
  ...WONT_FIT, id: '7c000000-0000-4000-8000-000000000040', kind: 'receipt', reason: 'damaged', raisedBy: 'Malinda', raisedAt: '2026-06-25T03:26:00.000Z',
  note: 'The crate door is dented', short: 2, cold: null,
  trip: { ...WONT_FIT.trip, vehicleId: 'VEH045', status: 'out', driver: 'Saman' },
  stop: { ...WONT_FIT.stop, outletId: 'OUT094', shopName: 'Tech Kandy City Centre', arrivedAt: '2026-06-24T23:10:00.000Z', doneAt: '2026-06-24T23:20:00.000Z', flaggedAtDock: false },
  lines: [
    { lineId: 'l-1', orderId: 'o-1', temp: 'dry', productId: 'tech-fridge', name: 'Refrigerators', unit: 'crate of 2', quantity: 2, counted: 1, loaded: 2, delivered: 2, received: 1, reason: 'damaged' },
    { lineId: 'l-2', orderId: 'o-1', temp: 'dry', productId: 'tech-small', name: 'Small appliances', unit: 'pallet', quantity: 2, counted: 1, loaded: 2, delivered: 2, received: 1, reason: 'missing' },
  ],
};

describe('Q-40 a shop\'s report gives each line its own reason, and its note', () => {
  it('titles the report by each line\'s reason on Live day, the Dashboard and a truck\'s row', () => {
    expect(reportTitle(TECH_REPORT)).toBe('1 crate of 2 damaged, 1 pallet missing');
    expect(problemLine(TECH_REPORT)).toBe('Tech Kandy City Centre · 1 crate of 2 damaged, 1 pallet missing');
    expect(needsYouTitle(TECH_REPORT)).toBe('Tech Kandy City Centre · 1 crate of 2 damaged, 1 pallet missing');
    // A report kept before lines had reasons reads as it did.
    const kept = { ...TECH_REPORT, reason: 'missing' as const, lines: TECH_REPORT.lines.map(({ reason: _gone, ...line }) => line) };
    expect(reportTitle(kept)).toBe('2 items missing');
  });

  it('shows each line received with its reason, and the note, on Live day\'s card', () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><IssueCard issue={TECH_REPORT} depot="Kandy" answering={ANSWERING} time /></QueryClientProvider>);
    expect(html).toContain('<h3 class="text-[15px] leading-5 font-bold">1 crate of 2 damaged, 1 pallet missing</h3>');
    expect(html).toMatch(/Received<\/dt><dd[^>]*>1 of 2 crates of 2 · Refrigerators, 1 damaged; 1 of 2 pallets · Small appliances, 1 missing</);
    expect(html).toMatch(/Note<\/dt><dd[^>]*>The crate door is dented</);
  });
});
