import type { ReceivingList, ReceivingStatus } from '@wayfinder/contracts';
export type ReceivingRow = ReceivingList['states'][number];
export type ReceivingFilter = ReceivingStatus | 'all';
export const receivingCounts = (rows: readonly ReceivingRow[]) => {
  const counts = { ready: 0, unavailable: 0, unconfirmed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
};
const rank = { unavailable: 0, ready: 1, unconfirmed: 2 };
export function receivingMatches(rows: readonly ReceivingRow[], filter: ReceivingFilter, search: string): ReceivingRow[] {
  const needle = search.trim().toLocaleLowerCase('en');
  return rows.filter(row => (filter === 'all' || row.status === filter) && row.shopName.toLocaleLowerCase('en').includes(needle))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.shopName.localeCompare(b.shopName, 'en', { sensitivity: 'base' }) || a.outletId.localeCompare(b.outletId));
}
