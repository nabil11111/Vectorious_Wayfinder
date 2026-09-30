import type { StoreOrder } from '@wayfinder/contracts';
import { Chip } from '@/components/ui/chip';
import { statusChip } from '../words';

export function StatusChip({ order, size }: { order: Pick<StoreOrder, 'status' | 'deliveryDate' | 'scheduledDate'>; size?: 'default' | 'sm' }) {
  const { label, tone } = statusChip(order);
  return <Chip tone={tone} size={size}>{label}</Chip>;
}
