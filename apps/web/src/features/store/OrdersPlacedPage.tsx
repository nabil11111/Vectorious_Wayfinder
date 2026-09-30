import { Link, Navigate } from 'react-router';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useNextOrder } from './next-order';
import { orangeLink } from './parts/actions';
import { BottomBar } from './parts/BottomBar';
import { ICON } from './parts/icons';
import { LoadError, StaleNotice } from './parts/LoadError';
import { Panel } from './parts/Panel';
import { clockTime, cutoffDay, lineWords, longDay, statusChip, weekday } from './words';

// Orders placed (Shop · Orders placed): what was placed and for which day. It reads what the API holds as
// placed for the open day, so a reload or "View confirmation" on Today shows the same screen.
export function OrdersPlacedPage() {
  const next = useNextOrder();

  if (!next.data) {
    return next.isError
      ? <LoadError line what="your confirmation" error={next.error} busy={next.isFetching} onRetry={() => { void next.refetch(); }} />
      : <PlacedSkeleton />;
  }
  const { placed, deliveryDate, cutoffAt, outlet, products } = next.data;
  // With nothing placed for the open day there is nothing to confirm.
  if (!placed || !deliveryDate) return <Navigate to="/store/orders" replace />;

  const count = placed.orders.length;
  // One chip for each state the placed orders are in. Straight after placing that is one: waiting for the plan.
  const chips = [...new Map(placed.orders.map((order) => statusChip(order)).map((chip) => [chip.label, chip])).values()];
  const back = <Link to="/store" className={orangeLink('h-[46px] w-full text-sm')}>Back to Today</Link>;
  const stamp = <p className="mt-2.5 text-center text-[11px] leading-[13px] text-muted-foreground">Submission confirmation · {clockTime(placed.lastPlacedAt)}</p>;

  return (
    <div className="max-w-xl lg:pt-2.5">
      {next.isError && <StaleNotice busy={next.isFetching} onRetry={() => { void next.refetch(); }} />}

      <div className="px-2">
        <img src={ICON.placed} alt="" className="mt-[18px] size-[47px]" />
        <h1 className="mt-[19px] font-sans text-[23px] leading-8 font-bold">{count === 1 ? 'Your order is placed' : `Your ${count} orders are placed`}</h1>
        <p className="mt-[5px] text-[13px] leading-[18px] text-muted-foreground">Requested for {longDay(deliveryDate)}.</p>
      </div>

      <Panel line className="mt-[27px] py-0">
        {/* One grid for all rows, so the amounts start at the same place however long the longest is. */}
        <ul className="grid grid-cols-[minmax(0,1fr)_minmax(77px,auto)] gap-x-3">
          {placed.lines.map((line) => {
            const words = lineWords(outlet.brand, line, products);
            return (
              <li key={line.productId} className="col-span-2 grid grid-cols-subgrid items-center border-b py-4 text-sm leading-[17px]">
                <span className="font-semibold">{words.name}</span>
                <span className="text-[13px]">{words.amount}</span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2 pt-[19px] pb-[18px]">
          {chips.map((chip) => <Chip key={chip.label} tone={chip.tone} size="sm">{chip.label}</Chip>)}
        </div>
      </Panel>

      <div className="px-2">
        <p className="mt-[23px] text-[13px] leading-[19px] text-muted-foreground">
          The depot has received {count === 1 ? 'your request' : count === 2 ? 'both requests' : `all ${count} requests`}. We’ll let you know
          when {count === 1 ? 'the delivery date and time' : 'delivery dates and times'} are confirmed.
        </p>
        {cutoffAt && (
          // A placed order cannot be edited, so the frame's "Edits close" is said this way (spec 009, departure 1).
          <p className="mt-[38px] text-[13px] leading-[18px] font-semibold">
            Orders for {weekday(deliveryDate)} close at {clockTime(cutoffAt)} {cutoffDay(cutoffAt, next.data.cutoffIsToday)}.
          </p>
        )}
      </div>

      <div className="mt-8 hidden lg:block">{back}{stamp}</div>
      <BottomBar className="bg-background px-4 pt-2 pb-[11px] md:px-6">{back}{stamp}</BottomBar>
    </div>
  );
}

function PlacedSkeleton() {
  return (
    <div role="status" aria-label="Loading your confirmation" className="max-w-xl lg:pt-2.5">
      <div className="px-2">
        <Skeleton className="mt-[18px] size-12" />
        <Skeleton className="mt-6 h-6 w-64" />
        <Skeleton className="mt-3 h-3.5 w-52" />
      </div>
      <Panel line className="mt-[27px] space-y-7 py-5">
        <div className="flex justify-between"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-20" /></div>
        <div className="flex justify-between"><Skeleton className="h-4 w-12" /><Skeleton className="h-4 w-20" /></div>
        <Skeleton soft className="h-[22px] w-44 rounded-full" />
      </Panel>
    </div>
  );
}
