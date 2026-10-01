import { Skeleton } from '@/components/ui/skeleton';
import { CARD } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';

// The dashboard's first load (Loading · skeleton 85:72065): the same layout in grey blocks, the tiles, Needs you and
// the trucks' rows, with no sample counts and no spinner. The top bar and the tabs stay real.
export function TilesSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={cn(CARD, 'relative flex min-h-[88px] flex-col px-3.5 pt-4 pb-3.5')}>
          <Skeleton soft className="absolute top-[17px] right-3.5 size-9 rounded-lg" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="mt-2 h-2.5 w-24 rounded-full" />
          {i > 0 && i < 5 && <Skeleton soft className="mt-auto h-1.5 w-full rounded-full" />}
        </div>
      ))}
    </div>
  );
}

// The district map's first load: one grey block the card's size. From 640 wide that is the frame's 520 by 407 at the
// column's width, at most one and a half times; below, the stacked card is 450 px of words and key plus its map.
export function MapSkeleton() {
  return (
    <div role="status" aria-label="Loading the district map" className="@container">
      <Skeleton className="h-[calc(450px+100cqw*280/340)] w-full rounded-[14px] sm:h-[min(100cqw*407/520,610.5px)]" />
    </div>
  );
}

export function TrucksSkeleton() {
  return (
    <div role="status" aria-label="Loading the trucks out" className={cn(CARD, 'px-4 pt-5 pb-4 lg:px-6')}>
      <div className="flex items-center gap-3">
        <Skeleton soft className="size-8 rounded-md" />
        <Skeleton className="h-3.5 w-40 rounded-full" />
      </div>
      <div className="mt-4 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-6">
            <Skeleton className="h-3 w-14 rounded-full" />
            <Skeleton className="h-3 w-16 rounded-full max-sm:hidden" />
            <Skeleton className="h-3 w-24 rounded-full max-lg:hidden" />
            <Skeleton soft className="h-2 w-32 rounded-full" />
            <Skeleton className="h-3 flex-1 rounded-full" />
            <Skeleton soft className="h-[30px] w-[110px] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
