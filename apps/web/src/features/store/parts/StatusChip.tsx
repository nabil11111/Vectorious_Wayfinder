import type { StoreOrder } from '@wayfinder/contracts';
import { Chip } from '@/components/ui/chip';
import { receivedChip, statusChip } from '../words';

// An order's chip (spec 009, rule 6). A received order with its counts says when on Today, and how many in Orders
// (spec 015, rule 11).
export function StatusChip({ order, size, today = false }: {
  order: Pick<StoreOrder, 'status' | 'deliveryDate' | 'scheduledDate' | 'receipt'>; size?: 'default' | 'sm'; today?: boolean;
}) {
  const { label, tone } = order.status === 'received' && order.receipt ? receivedChip(order.receipt, today) : statusChip(order);
  return <Chip tone={tone} size={size}>{label}</Chip>;
}
