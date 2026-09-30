import type { StoreNextOrder } from '@wayfinder/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useNextOrder } from './next-order';
import { useTodayOrders } from './orders';
import { LoadError, StaleNotice } from './parts/LoadError';
import { NextOrderCard, PlacedCard } from './parts/NextOrderCard';
import { OrderCard } from './parts/OrderCard';
import { Panel } from './parts/Panel';
import { clockTime, cutoffDay, shortDay, weekday } from './words';

const heading = 'mb-[9px] text-[17px] leading-[23px] font-bold lg:mb-3 lg:text-lg lg:leading-[25px]';

// Today (Shop · Today and Shop · Today · orders submitted): what is due today and the next order. On a phone
// it is one column, and from 1024 px the next order moves to a column of its own on the right.
export function TodayPage() {
  const next = useNextOrder();
  const today = useTodayOrders();
  const busy = next.isFetching || today.isFetching;
  const retry = () => { void next.refetch(); void today.refetch(); };

  if (!next.data && !today.data && next.isError && today.isError) {
    return <LoadError what="today" error={today.error} busy={busy} onRetry={retry} />;
  }

  const outlet = today.data?.outlet ?? next.data?.outlet;
  const placed = next.data?.placed ? next.data : null;
  // With the order placed and no new draft open, the placed card leads the phone screen, as in the frame.
  const placedOnTop = placed !== null && !placed.draft;

  return (
    <div className="lg:pt-2.5">
      {((next.isError && next.data) || (today.isError && today.data)) && <div className="mb-2.5"><StaleNotice busy={busy} onRetry={retry} /></div>}

      <header className="text-xs leading-[15px] font-semibold text-muted-foreground lg:flex lg:items-baseline lg:gap-3.5">
        {today.data
          ? <h1 className="inline font-sans lg:font-heading lg:text-[26px] lg:leading-8 lg:font-bold lg:text-foreground">{shortDay(today.data.today)}</h1>
          : today.isPending && <Skeleton className="inline-block h-3.5 w-[68px] align-middle lg:h-7 lg:w-36" />}
        {outlet
          ? <p className="inline lg:text-[15px] lg:font-normal">{today.data && <span className="lg:hidden"> · </span>}{outlet.name}</p>
          : <Skeleton className="ml-2 inline-block h-3.5 w-24 align-middle lg:ml-0 lg:h-4 lg:w-32" />}
      </header>

      <div className="mt-2.5 grid gap-y-3 lg:mt-6 lg:grid-cols-[minmax(0,728fr)_minmax(0,440fr)] lg:gap-x-8">
        <section>
          <h2 className={cn(heading, placedOnTop ? 'pt-[7px] lg:pt-0' : 'hidden lg:block')}>Coming today</h2>
          {today.data ? (
            today.data.orders.length > 0 ? (
              <div className="space-y-2.5 lg:space-y-3.5">
                {today.data.orders.map((order) => <OrderCard key={order.id} order={order} outlet={today.data.outlet} look="today" />)}
              </div>
            ) : <p className="text-xs leading-[15px] text-muted-foreground">Nothing is due today.</p>
          ) : today.isError ? (
            <LoadError what="today’s deliveries" error={today.error} busy={today.isFetching} onRetry={() => { void today.refetch(); }} />
          ) : (
            <div role="status" aria-label="Loading today’s deliveries" className="space-y-2.5 lg:space-y-3.5">
              <OrderCardSkeleton />
              <OrderCardSkeleton />
            </div>
          )}
        </section>

        <section className={cn(placedOnTop && 'order-first lg:order-none')}>
          <h2 className={cn(heading, placedOnTop && 'hidden lg:block')}>Your next order</h2>
          {next.data ? (
            <div className="space-y-2.5 lg:space-y-3.5">
              {!placedOnTop && <NextOrderCard next={next.data} />}
              {placed && <PlacedCard next={placed} orange={placedOnTop} />}
              {placedOnTop && <ClosesLine next={placed} className="hidden lg:block" />}
            </div>
          ) : next.isError ? (
            <LoadError what="your next order" error={next.error} busy={next.isFetching} onRetry={() => { void next.refetch(); }} />
          ) : (
            <NextOrderSkeleton />
          )}
        </section>
      </div>

      {placedOnTop && <ClosesLine next={placed} className="mt-4 lg:hidden" />}
    </div>
  );
}

// "Thursday orders close today at 16:00." The shop can place another order for the day until then. A phone
// has it at the foot of the screen, as in the frame, and a desktop under the placed card.
function ClosesLine({ next, className }: { next: StoreNextOrder; className: string }) {
  if (!next.deliveryDate || !next.cutoffAt) return null;
  return (
    <p className={cn('text-xs leading-[15px] text-muted-foreground', className)}>
      {weekday(next.deliveryDate)} orders close {cutoffDay(next.cutoffAt, next.cutoffIsToday)} at {clockTime(next.cutoffAt)}.
    </p>
  );
}

// The first load, in the style guide's grey blocks: a block for each text, a lighter one for a chip or button.
function OrderCardSkeleton() {
  return (
    <Panel className="flex items-center gap-2.5">
      <Skeleton className="size-8" />
      <Skeleton className="h-4 w-36" />
      <Skeleton soft className="ml-auto h-[25px] w-24 rounded-full" />
    </Panel>
  );
}

function NextOrderSkeleton() {
  return (
    <Panel role="status" aria-label="Loading your next order" className="pt-[18px]">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>
      <Skeleton soft className="mt-2.5 h-[52px] rounded-[10px]" />
    </Panel>
  );
}
