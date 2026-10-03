import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import type { Issue, IssueList, OperationsDay, OperationsTrip, TripAttention } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { PELIYAGODA_DAY, RUWAN, listOf, uuid } from '@/features/dispatcher/both-days.test-data';
import { IssueCard } from '@/features/live/IssueCard';
import type { Answering } from '@/features/live/issues';
import { NeedsYouCard } from './NeedsYouCard';

// The dashboard's Needs you as the QA run read it (phase 4 and 5): its rows drawn from one depot's read and its open
// problems, as the queries hold them. The trips carry only what a row reads; these fixtures live in the test only.

vi.mock('@/features/auth/api', async (original) => ({ ...await original<typeof import('@/features/auth/api')>(), useMe: () => ({ data: RUWAN }) }));

// Thu 25 Jun 03:30 at the depot.
const LEAVES = '2026-06-24T22:00:00.000Z';
function watched(n: number, vehicleId: string, district: string, driver: string, attention: TripAttention) {
  return {
    tripId: uuid(n), detailRecorded: true, vehicleId, tripNo: 1, district, driver: { id: uuid(n + 50), name: driver }, openIssueIds: [], attention, lastReportAt: null,
  } as unknown as OperationsTrip;
}
function needsYou(issues: IssueList, trips: OperationsTrip[] = []) {
  return rowsOf(needsYouHtml(issues, trips));
}
// Each row of a list, as its text.
const rowsOf = (html: string) => [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, row]) => row!.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ').trim());
function needsYouHtml(issues: IssueList, trips: OperationsTrip[] = []) {
  const day: OperationsDay = { ...PELIYAGODA_DAY(), groups: [{ brand: 'Fresh', district: 'Galle', tripsTotal: trips.length, vehiclesTotal: trips.length, stopsTotal: 0, stopsDone: 0, trips }] };
  const part = { depot: 'Peliyagoda', day, issues: { data: issues, isError: false, isFetching: false } as UseQueryResult<IssueList> };
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter><NeedsYouCard parts={[part]} both={false} /></MemoryRouter></QueryClientProvider>,
  );
}

describe('Q-24 the trucks past their leaving time on the dashboard', () => {
  it('bounds watching separately from actionable problems and exposes the remaining trips', () => {
    const trips = Array.from({ length: 9 }, (_, i) => watched(i + 1, `VEH00${i + 1}`, 'Galle', 'Driver', { kind: 'not_loaded', plannedAt: LEAVES, sentence: 'Not loaded · planned 03:30', word: 'still at the dock' }));
    const html = needsYouHtml(listOf([]), trips);
    expect(rowsOf(html)).toHaveLength(3);
    expect(html).toContain('Needs you · 0');
    expect(html).toContain('Watching · 9');
    expect(html).toContain('Show all 9 watching trips');
  });
  it('says which are still at the dock, not loaded or still loading, apart from a ready truck not reported out', () => {
    const rows = needsYou(listOf([]), [
      watched(1, 'VEH006', 'Galle', 'Sanjeewa', { kind: 'not_loaded', plannedAt: LEAVES, sentence: 'Not loaded · planned 03:30', word: 'still at the dock' }),
      watched(2, 'VEH014', 'Galle', 'Nuwan', { kind: 'still_loading', plannedAt: LEAVES, on: 120, units: 437, sentence: 'Still loading · 120 of 437 on · planned 03:30', word: 'still at the dock' }),
      watched(3, 'VEH004', 'Matara', 'Madushan', { kind: 'departure_unreported', plannedAt: LEAVES, sentence: 'Departure not reported · planned 03:30', word: 'watching' }),
    ]);
    expect(rows).toEqual([
      'Watching · VEH006 · Galle · Not loaded · planned 03:30 Sanjeewa · still at the dock · no report yet Open trip',
      'Watching · VEH014 · Galle · Still loading · 120 of 437 on · planned 03:30 Nuwan · still at the dock · no report yet Open trip',
      'Watching · VEH004 · Matara · Departure not reported · planned 03:30 Madushan · no report yet Open trip',
    ]);
  });
});

// ── Q-39 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// Phase 5's open problems at Kandy and Peliyagoda, one of each kind and every reason a shop reports.
const KOTAHENA_REFUSAL: Issue = {
  id: uuid(61), revision: 0, kind: 'refused', reason: 'expired', status: 'open', raisedBy: 'Dilshan', raisedAt: '2026-06-24T22:07:00.000Z', note: null,
  decision: null, decidedBy: null, decidedAt: null, hasPhoto: true, short: 3, cold: null, replacement: null,
  trip: { id: uuid(161), vehicleId: 'VEH035', tripNo: 1, leavesAt: '2026-06-24T23:06:00.000Z', status: 'out', driver: 'Dilshan', stopsLeft: 1 },
  stop: { id: uuid(261), seq: 2, outletId: 'OUT005', shopName: 'Fresh Kotahena', arrivedAt: '2026-06-24T22:06:00.000Z', doneAt: '2026-06-24T22:07:00.000Z', loadedAt: '2026-06-24T21:16:00.000Z', flaggedAtDock: false },
  lines: [{ lineId: uuid(361), orderId: uuid(461), temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 53, counted: 3, loaded: 53, delivered: 50, received: null }],
};
const issue = (n: number, more: Partial<Issue>, shopName: string, line: Partial<Issue['lines'][number]> = {}): Issue => ({
  ...KOTAHENA_REFUSAL, id: uuid(n), ...more, stop: { ...KOTAHENA_REFUSAL.stop, id: uuid(n + 100), shopName },
  lines: [{ ...KOTAHENA_REFUSAL.lines[0]!, lineId: uuid(n + 200), ...line }],
});
const PROBLEMS: [string, Issue][] = [
  ['Fresh Nugegoda · 1 dry carton short', issue(62, { kind: 'loading', reason: 'short', raisedBy: 'Kasun', short: 1 }, 'Fresh Nugegoda',
    { temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', quantity: 4, counted: 3, loaded: null, delivered: null })],
  ['Fresh Kotahena · 3 chilled cartons refused', KOTAHENA_REFUSAL],
  ['Nobody at Fresh Mulgampola', issue(63, { kind: 'closed', reason: 'nobody_there', raisedBy: 'Asitha', short: 39 }, 'Fresh Mulgampola', { quantity: 39, counted: 39, loaded: 39, delivered: null })],
  ['Fresh Peradeniya · 1 chilled carton damaged', issue(64, { kind: 'receipt', reason: 'damaged', raisedBy: 'Gimhani', short: 1 }, 'Fresh Peradeniya', { quantity: 47, counted: 1, loaded: 47, delivered: 47, received: 46 })],
  ['Fresh Katukele · 2 chilled cartons missing', issue(65, { kind: 'receipt', reason: 'missing', raisedBy: 'Chamari', short: 2 }, 'Fresh Katukele', { quantity: 50, counted: 2, loaded: 50, delivered: 50, received: 48 })],
  ['Fresh Ampitiya · Chilled goods not cold', issue(66, { kind: 'receipt', reason: 'not_cold', raisedBy: 'Ruvini', short: 0, cold: false }, 'Fresh Ampitiya', { quantity: 42, counted: 0, loaded: 42, delivered: 42, received: 42 })],
  ['Tech Kandy City Centre · 1 crate of 2 damaged', issue(67, { kind: 'receipt', reason: 'damaged', raisedBy: 'Malinda', short: 1 }, 'Tech Kandy City Centre',
    { temp: 'dry', productId: 'tech-refrigerators', name: 'Refrigerators', unit: 'crate of 2', quantity: 2, counted: 1, loaded: 2, delivered: 2, received: 1 })],
];
const ANSWERING: Answering = { sending: null, failed: null, refused: null, sent: null, decide: () => {} };
// The title Live day's card gives a problem.
const cardTitle = (problem: Issue) =>
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><IssueCard issue={problem} depot="Kandy" answering={ANSWERING} time /></MemoryRouter></QueryClientProvider>).match(/<article aria-label="([^"]*)"/)?.[1]?.replaceAll('&#x27;', '\'');

describe('Q-39 the dashboard names each problem as Live day\'s card does', () => {
  it('bounds the initial problems and keeps every problem reachable through Show all or Live day', () => {
    const html = needsYouHtml(listOf(PROBLEMS.map(([, problem]) => problem)));
    expect(rowsOf(html)).toHaveLength(3);
    expect(html).toContain('Needs you · 7');
    expect(html).toContain('Show all 7 problems');
    expect(html).toContain('View all in Live day');
  });
  it.each(PROBLEMS)('titles "%s" by what it is, in the card\'s own words', (title, problem) => {
    const [row] = needsYou(listOf([problem]));
    expect(row).toMatch(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${problem.raisedBy} · `));
    expect(title.endsWith(cardTitle(problem)!)).toBe(true);
  });

  it('never calls a shop\'s report a closed shop, nor draws the closed shop\'s picture for it', () => {
    const reports = PROBLEMS.map(([, problem]) => problem).filter((problem) => problem.kind === 'receipt');
    const html = needsYouHtml(listOf(reports));
    expect(rowsOf(html).filter((row) => row.includes('Nobody at'))).toEqual([]);
    expect(html).not.toMatch(/icon-shop-(fresh|style|tech)/);
  });
});
