import type { OperationsTrip, TripAttention } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { needsAttention, rowFacts } from './rows';

// A trip row's facts on Live day past a truck's leaving time (spec 016, rule 4, Q-24). The server words the trip at the
// dock; the row lays its sentence and its short word out. The trip carries only what the row reads.
const LEAVES = '2026-06-24T22:00:00.000Z';
const atDock = (status: OperationsTrip['status'], attention: TripAttention) => ({
  tripId: '00000000-0000-4000-8000-000000000004', detailRecorded: true, status, openIssueIds: [], outRow: null, attention, tripNo: 1,
  schedule: { leavesAt: LEAVES, backAt: LEAVES }, trip: { readyAt: null }, onSoFar: null, figures: { loaded: null, ordered: 437 },
}) as unknown as OperationsTrip;

describe('Q-24 Live day past a truck\'s leaving time', () => {
  it('says a truck never loaded is not loaded and still at the dock, in the server\'s words', () => {
    const trip = atDock('planned', { kind: 'not_loaded', plannedAt: LEAVES, sentence: 'Not loaded · planned 03:30', word: 'still at the dock' });
    expect(rowFacts(trip, [])).toMatchObject({ sentence: 'Not loaded · planned 03:30', word: 'still at the dock', tone: 'warn', tint: 'warn' });
    expect(needsAttention(trip)).toBe(true);
  });

  it('says a truck still loading how much is on, and that it is still at the dock', () => {
    const trip = atDock('loading', { kind: 'still_loading', plannedAt: LEAVES, on: 120, units: 437, sentence: 'Still loading · 120 of 437 on · planned 03:30', word: 'still at the dock' });
    expect(rowFacts(trip, [])).toMatchObject({ sentence: 'Still loading · 120 of 437 on · planned 03:30', word: 'still at the dock', tone: 'warn', tint: 'warn' });
    expect(needsAttention(trip)).toBe(true);
  });

  it('keeps "Departure not reported", watching, for a ready truck not out', () => {
    const trip = atDock('ready', { kind: 'departure_unreported', plannedAt: LEAVES, sentence: 'Departure not reported · planned 03:30', word: 'watching' });
    expect(rowFacts(trip, [])).toMatchObject({ sentence: 'Departure not reported · planned 03:30', word: 'watching', tone: 'warn', tint: 'warn' });
    expect(needsAttention(trip)).toBe(true);
  });

  it('says nothing is missing before the leaving time', () => {
    const trip = atDock('planned', { kind: 'none' });
    expect(rowFacts(trip, [])).toMatchObject({ sentence: 'Not loaded yet · leaves 03:30', word: 'not left', tone: 'plain', tint: null });
    expect(needsAttention(trip)).toBe(false);
  });
});

describe('spec 016 a returning truck\'s planned return', () => {
  it('says the server\'s words, which say when it was due once that time has passed', () => {
    const returning = (sentence: string) => ({
      ...atDock('out', { kind: 'none' }), outRow: { status: { kind: 'returning', sentence }, plannedReturn: LEAVES, nextStop: null },
    }) as unknown as OperationsTrip;
    expect(rowFacts(returning('Returning · planned back 06:38'), [])).toMatchObject({ sentence: 'Returning · planned back 06:38', word: 'returning' });
    expect(rowFacts(returning('Returning · was due back 06:38'), [])).toMatchObject({ sentence: 'Returning · was due back 06:38', word: 'returning' });
  });
});
