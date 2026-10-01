import { Chip } from '@/components/ui/chip';

// The depot a row belongs to, on a page that shows both depots together (spec 021): the style guide's chip, quiet,
// small enough to sit in the row's own line.
export function DepotTag({ depot, className }: { depot: string; className?: string }) {
  return <Chip tone="quiet" size="sm" className={['px-2 py-0.5 text-[10px] leading-3', className].filter(Boolean).join(' ')}>{depot}</Chip>;
}
