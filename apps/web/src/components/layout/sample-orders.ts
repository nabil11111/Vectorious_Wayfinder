import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SampleOrdersDepot, SampleOrdersPreview, SampleOrdersRequest, SampleOrdersResult } from '@wayfinder/contracts';
import { api } from '@/lib/api';
import { inDepot } from '@/lib/clock';

// The demo control's "Add sample shop orders" (spec 028, D-103): the press, the shops counted and the words of its
// answer. The panel is SampleOrders.tsx.

export type Choice = SampleOrdersRequest['shops'];
export const SAMPLE_CHOICES: { value: Choice; label: string }[] = [
  { value: 10, label: '10 shops' },
  { value: 25, label: '25 shops' },
  { value: 'all', label: "Every shop that hasn't ordered" },
];

// The query key starts with the orders topic, so a shop's order heard on the live stream counts the shops again.
const previewKey = ['orders', 'sample-shops'] as const;

export function useSampleOrdersPreview() {
  return useQuery({ queryKey: previewKey, queryFn: ({ signal }) => api<SampleOrdersPreview>('/demo/sample-orders', { signal }) });
}

// The press, as options a test can run without a screen.
export const addSampleOrdersMutation = (qc: QueryClient) => ({
  mutationKey: ['demo', 'sample-orders'],
  networkMode: 'always' as const,
  mutationFn: (shops: Choice) => api<SampleOrdersResult>('/demo/sample-orders', { method: 'POST', json: { shops } satisfies SampleOrdersRequest }),
  // The live stream tells every screen too. This tab's own lists follow at once.
  onSuccess: () => {
    for (const topic of ['orders', 'lookup', 'operations', 'plans']) void qc.invalidateQueries({ queryKey: [topic] });
  },
});

export function useAddSampleOrders() {
  const qc = useQueryClient();
  return useMutation(addSampleOrdersMutation(qc));
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
// "Thu 25 Jun" for a delivery date.
export const dayWords = (date: string) => inDepot(Date.parse(`${date}T12:00:00+05:30`)).day;

// How many of a depot's shops may still order: "10 of Peliyagoda's 75 shops have not ordered yet."
export function canOrderLine(depot: SampleOrdersPreview['depots'][number]): string {
  if (!depot.canOrder) return `Every shop at ${depot.depotId} has ordered already.`;
  return `${depot.canOrder} of ${depot.depotId}'s ${count(depot.shops, 'shop')} ${depot.canOrder === 1 ? 'has' : 'have'} not ordered yet.`;
}

// What a press did at one depot: "Placed 10 orders from 10 shops at Peliyagoda. 65 shops already had an order or a
// draft.", or with top-ups "Placed 25 orders at Peliyagoda: 10 from shops that hadn't ordered, 15 top-ups."
export function sampleAnswer(depot: SampleOrdersDepot, deliveryDate: string): string {
  if (depot.topUpIds.length) {
    return `Placed ${count(depot.orders, 'order')} at ${depot.depotId}: ${depot.newOrders} from shops that hadn't ordered, ${count(depot.topUpIds.length, 'top-up')}.`;
  }
  const had = `${count(depot.alreadyHad, 'shop')} already had an order or a draft`;
  const cannot = depot.cannotOrder ? `. ${count(depot.cannotOrder, 'shop')} had no account or nothing to order` : '';
  if (!depot.orders) {
    return depot.cannotOrder
      ? `Nothing was placed at ${depot.depotId}: ${had}${cannot}.`
      : `Every shop at ${depot.depotId} already has an order or a draft for ${dayWords(deliveryDate)}. Nothing was placed.`;
  }
  return `Placed ${count(depot.orders, 'order')} from ${count(depot.outletIds.length, 'shop')} at ${depot.depotId}${depot.alreadyHad ? `. ${had}` : ''}${cannot}.`;
}
