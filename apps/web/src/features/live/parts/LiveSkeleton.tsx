import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ROW } from './axis';
import { CARD } from './ui';

// Live day's first load (Dispatcher · Live day · loading 85:72127): the counts, the axis and the brand cards with their
// rows in grey blocks, never sample counts or a spinner. The top bar and the tabs stay real.
export function CountsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {[80, 72, 56].map((w, i) => (
        <span key={i} className="flex items-center gap-2"><Skeleton className="h-3 rounded-full" style={{ width: w }} /><Skeleton soft className="h-2.5 w-12 rounded-full" /></span>
      ))}
    </div>
  );
}

export function TripsSkeleton() {
  return (
    <div role="status" aria-label="Loading the trucks">
      <div aria-hidden="true" className={cn(ROW, 'hidden h-[22px] px-6 lg:grid')}>
        <div className="col-start-3 flex justify-between xl:col-start-4">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-2 w-7 rounded-full" />)}
        </div>
      </div>
      <div aria-hidden="true" className="mt-1 space-y-2.5">
        {[4, 3, 2].map((rows, card) => (
          <div key={card} className={cn(CARD, 'px-4 pt-3 pb-2.5')}>
            <div className="flex items-center gap-2.5">
              <Skeleton soft className="size-[26px] rounded-md" />
              <Skeleton className="h-3 w-12 rounded-full" />
              <Skeleton className="h-2.5 w-56 rounded-full" />
            </div>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i}>
                {i % 2 === 0 && <Skeleton className="mt-3 h-2.5 w-28 rounded-full" />}
                <div className={cn(ROW, 'mt-2 min-h-[30px] px-2 max-lg:flex max-lg:gap-3')}>
                  <Skeleton soft className="size-6 rounded-md" />
                  <div className="flex items-center gap-2"><Skeleton className="h-3 w-14 rounded-full" /><Skeleton className="h-3 w-12 rounded-full" /></div>
                  <Skeleton className="hidden h-2.5 w-40 rounded-full xl:block" />
                  <div className="relative hidden h-2 lg:block"><Skeleton soft className="absolute inset-y-0 rounded-full" style={{ left: `${10 + i * 6}%`, width: `${30 + (i % 3) * 10}%` }} /></div>
                  <Skeleton className="hidden h-2.5 w-12 rounded-full xl:block" />
                  <Skeleton soft className="ml-auto h-6 w-[76px] rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
