import { ARTWORK_DISTRICTS, ARTWORK_SIZE } from '@/lib/map/login-artwork-shapes';
import { cn } from '@/lib/utils';

// The sign-in page's Sri Lanka (frames 53:6373 and 53:6276): every district in slate, the districts with our shops in
// teal, borders in the panel's ink. Decoration only, with no shops, trucks or routes on it, so screen readers skip it.
export function DistrictArtwork({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${ARTWORK_SIZE.width} ${ARTWORK_SIZE.height}`} aria-hidden="true" focusable="false" className={cn('block', className)}>
      {ARTWORK_DISTRICTS.map((district) => (
        <path key={district.name} d={district.d} strokeWidth={1.15} strokeLinejoin="round" className={cn('stroke-foreground', district.served ? 'fill-art-served' : 'fill-art-land')} />
      ))}
    </svg>
  );
}
