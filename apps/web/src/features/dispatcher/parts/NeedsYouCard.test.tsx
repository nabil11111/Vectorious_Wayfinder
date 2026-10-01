import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import type { IssueList, OperationsDay, OperationsTrip, TripAttention } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { PELIYAGODA_DAY, RUWAN, listOf, uuid } from '@/features/dispatcher/both-days.test-data';
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
  const day: OperationsDay = { ...PELIYAGODA_DAY(), groups: [{ brand: 'Fresh', district: 'Galle', tripsTotal: trips.length, vehiclesTotal: trips.length, stopsTotal: 0, stopsDone: 0, trips }] };
  const part = { depot: 'Peliyagoda', day, issues: { data: issues, isError: false, isFetching: false } as UseQueryResult<IssueList> };
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter><NeedsYouCard parts={[part]} both={false} /></MemoryRouter></QueryClientProvider>,
  );
  // Each row of the list, as its text.
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, row]) => row!.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ').trim());
}

describe('Q-24 the trucks past their leaving time on the dashboard', () => {
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
