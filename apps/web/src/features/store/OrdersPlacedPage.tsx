import { Link, Navigate, useLocation } from 'react-router';
import type { StoreNextOrder, StoreOrder } from '@wayfinder/contracts';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { PlacedNow } from './draft-form';
import { useNextOrder } from './next-order';
import { orangeLink } from './parts/actions';
import { BottomBar } from './parts/BottomBar';
import { ICON } from './parts/icons';
import { LoadError, StaleNotice } from './parts/LoadError';
import { Panel } from './parts/Panel';
import { clockTime, cutoffDay, inListOrder, lineWords, longDay, statusChip, weekday } from './words';

// Orders placed (Shop · Orders placed): what was placed and for which day. It reads what the API holds as
// placed for the open day, so a reload or "View confirmation" on Today shows the same screen. The form opens it
// with the orders its place answered with, which it shows when the open day does not list them (see confirmed).
export function OrdersPlacedPage() {
  const next = useNextOrder();
  const handed = PlacedNow.safeParse(useLocation().state);

  if (!next.data) {
    return next.isError
      ? <LoadError line what="your confirmation" error={next.error} busy={next.isFetching} onRetry={() => { void next.refetch(); }} />
      : <PlacedSkeleton />;
  }
  const { deliveryDate, cutoffAt, outlet, products } = next.data;
  const shown = confirmed(next.data, handed.success ? handed.data.placedOrders : null);
  // With nothing placed for the open day and nothing handed over for another, there is nothing to confirm.
  if (!shown) return <Navigate to="/store/orders" replace />;
  const { orders, lines, day, placedAt } = shown;

  const count = orders.length;
  // One chip for each state the placed orders are in. Straight after placing that is one: waiting for the plan.
  const chips = [...new Map(orders.map((order) => statusChip(order)).map((chip) => [chip.label, chip])).values()];
  const back = <Link to="/store" className={orangeLink('h-[46px] w-full text-sm')}>Back to Today</Link>;
  const stamp = placedAt && <p className="mt-2.5 text-center text-[11px] leading-[13px] text-muted-foreground">Submission confirmation · {clockTime(placedAt)}</p>;

  return (
    <div className="max-w-xl lg:pt-2.5">
      {next.isError && <StaleNotice busy={next.isFetching} onRetry={() => { void next.refetch(); }} />}

      <div className="px-2">
        <img src={ICON.placed} alt="" className="mt-[18px] size-[47px]" />
        <h1 className="mt-[19px] font-sans text-[23px] leading-8 font-bold">{count === 1 ? 'Your order is placed' : `Your ${count} orders are placed`}</h1>
        <p className="mt-[5px] text-[13px] leading-[18px] text-muted-foreground">Requested for {longDay(day)}.</p>
      </div>

      <Panel line className="mt-[27px] py-0">
        {/* One grid for all rows, so the amounts start at the same place however long the longest is. */}
        <ul className="grid grid-cols-[minmax(0,1fr)_minmax(77px,auto)] gap-x-3">
          {inListOrder(lines, products).map((line, i) => {
            const words = lineWords(outlet.brand, line, products);
            return (
              <li key={`${line.productId}-${i}`} className="col-span-2 grid grid-cols-subgrid items-center border-b py-4 text-sm leading-[17px]">
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
        {cutoffAt && day === deliveryDate && (
          // A placed order cannot be edited, so the frame's "Edits close" is said this way (spec 009, departure 1).
          // It is said only while the orders' day is the open one.
          <p className="mt-[38px] text-[13px] leading-[18px] font-semibold">
            Orders for {weekday(day)} close at {clockTime(cutoffAt)} {cutoffDay(cutoffAt, next.data.cutoffIsToday)}.
          </p>
        )}
      </div>

      <div className="mt-8 hidden lg:block">{back}{stamp}</div>
      <BottomBar className="bg-background px-4 pt-2 pb-[11px] md:px-6">{back}{stamp}</BottomBar>
    </div>
  );
}

// What the screen confirms: the orders, their lines, the day they were requested for and when they were placed.
// That is everything placed for the open day, unless the form handed over orders for another day: a place
// made at 15:59 whose answer only came to its retry at 16:01, when Friday is open and Thursday no longer
// listed. One place is for one day, stamps its orders with one moment and makes one order per temperature,
// so its lines are its orders' lines.
function confirmed(next: StoreNextOrder, placedNow: StoreOrder[] | null) {
  const first = placedNow?.[0];
  if (placedNow && first && first.deliveryDate !== next.deliveryDate) {
    return { orders: placedNow, lines: placedNow.flatMap((order) => order.lines), day: first.deliveryDate, placedAt: first.placedAt };
  }
  if (!next.placed || !next.deliveryDate) return null;
  return { orders: next.placed.orders, lines: next.placed.lines, day: next.deliveryDate, placedAt: next.placed.lastPlacedAt };
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
