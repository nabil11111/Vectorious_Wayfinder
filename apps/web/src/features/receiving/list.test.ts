import type { ReceivingList } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { receivingCounts, receivingMatches } from './list';
type Row = ReceivingList['states'][number];
const row = (outletId: string, shopName: string, status: Row['status']): Row => ({ outletId, shopName, status, date: '2026-06-25', note: null, updatedAt: null, revision: 0 });
const rows = [row('OUT003', 'Zulu', 'unconfirmed'), row('OUT001', 'beta', 'unavailable'), row('OUT005', 'Alpha', 'ready'), row('OUT004', 'Alpha', 'unavailable'), row('OUT002', 'Alpha', 'unconfirmed')];
it('counts all three declarations without equating unconfirmed with unavailable', () => {
  expect(receivingCounts(rows)).toEqual({ ready: 1, unavailable: 2, unconfirmed: 2 });
  expect(receivingCounts([row('OUT001', 'Only shop', 'unconfirmed')])).toEqual({ ready: 0, unavailable: 0, unconfirmed: 1 });
});
it('sorts unavailable first, then ready, then unconfirmed with stable names and IDs, without mutating the read', () => {
  const original = rows.slice();
  expect(receivingMatches(rows, 'all', '').map(r => r.outletId)).toEqual(['OUT004', 'OUT001', 'OUT005', 'OUT002', 'OUT003']);
  expect(rows).toEqual(original);
  expect(receivingMatches([row('OUT002', 'Alpha', 'ready'), row('OUT001', 'alpha', 'ready')], 'all', '').map(r => r.outletId)).toEqual(['OUT001', 'OUT002']);
});
it('combines trimmed case-insensitive shop search with an explicit status filter', () => {
  expect(receivingMatches(rows, 'unavailable', '  ALPHA  ').map(r => r.outletId)).toEqual(['OUT004']);
  expect(receivingMatches(rows, 'all', 'alpha')).toHaveLength(3);
  expect(receivingMatches(rows, 'ready', 'beta')).toEqual([]);
  expect(receivingCounts(rows).unavailable).toBe(2);
});
