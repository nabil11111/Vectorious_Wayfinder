import { Skeleton } from '@/components/ui/skeleton';
import { CARD } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';

// What stands in place of a dispatcher page while a depot switch is on its way (spec 020, Switching): the page's
// header and a card in grey blocks, as the pages' own loading states are, with no words and no spinner. The top bar
// stays real and shows the depot pressed.
export function SwitchingSkeleton({ depot }: { depot: string }) {
  return (
    <div role="status" aria-label={`Switching to ${depot}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-6 w-44" />
        <Skeleton soft className="h-2.5 w-28 rounded-full" />
      </div>
      <div className={cn(CARD, 'mt-4 px-5 pt-5 pb-4')}>
        <div className="flex items-center gap-3">
          <Skeleton soft className="size-8 rounded-md" />
          <Skeleton className="h-3.5 w-48 rounded-full" />
        </div>
        <div className="mt-4 space-y-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-6">
              <Skeleton className="h-3 w-24 rounded-full" />
              <Skeleton soft className="h-2 w-32 rounded-full max-sm:hidden" />
              <Skeleton className="h-3 flex-1 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
