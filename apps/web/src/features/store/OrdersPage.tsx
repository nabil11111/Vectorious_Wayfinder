import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { StoreOrder } from '@wayfinder/contracts';
import { Segmented, SegmentedItem, SegmentedList, SegmentedPanel } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useOpenOrders, usePastOrders } from './orders';
import { plainLink } from './parts/actions';
import { LoadError, StaleNotice } from './parts/LoadError';
import { OrderCard } from './parts/OrderCard';
import { PageHeader } from './parts/PageHeader';
import { Panel } from './parts/Panel';
import { dayOf, reasonOf, shortDay } from './words';

type OpenOrders = ReturnType<typeof useOpenOrders>;
type PastOrders = ReturnType<typeof usePastOrders>;

// The two lists sit side by side from this width, as in Shop · Orders · desktop.
const WIDE = '(min-width: 1024px)';
const watchWide = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

const heading = 'mb-3 text-lg leading-[25px] font-bold';

// Orders (Shop · Orders, Shop · Orders · Past and the desktop frame): the shop's open orders and its past
// ones. A phone shows one list at a time behind the Open and Past switch, and opens on Past from ?list=past, as a
// receipt's "View past orders" asks (spec 015). A desktop shows both and no switch.
export function OrdersPage() {
  const wide = useSyncExternalStore(watchWide, () => window.matchMedia(WIDE).matches);
  const [params, setParams] = useSearchParams();
  const list = params.get('list') === 'past' ? 'past' : 'open';
  const setList = (next: 'open' | 'past') => setParams(next === 'past' ? { list: 'past' } : {}, { replace: true });
  const open = useOpenOrders();
  // The past list is only read once it is on the screen.
  const past = usePastOrders(wide || list === 'past');
  const showingPast = !wide && list === 'past';
  const newestPast = past.data?.pages[0]?.orders[0];

  return (
    <div className="lg:pt-2.5">
      {open.isError && open.data && <div className="mb-2.5"><StaleNotice busy={open.isFetching} onRetry={() => { void open.refetch(); }} /></div>}

      <PageHeader
        title="Orders"
        className="mt-[5px]"
        action={<Link to="/store/orders/new" className={plainLink('-mt-1 h-9 shrink-0 px-[15px] text-sm lg:mt-0')}>+ New order</Link>}
      >
        {showingPast
          ? (newestPast ? <p>{shortDay(dayOf(newestPast))} and earlier · newest first</p> : past.isPending && <Skeleton className="h-3.5 w-48" />)
          : (open.data ? <p>{openCount(open.data.openCount)}</p> : open.isPending && <Skeleton className="h-3.5 w-24 lg:h-4 lg:w-28" />)}
      </PageHeader>

      {wide ? (
        <div className="mt-6 grid grid-cols-[minmax(0,728fr)_minmax(0,440fr)] items-start gap-x-8">
          <section>
            <h2 className={heading}>Open orders</h2>
            <OpenList open={open} />
          </section>
          <section>
            <h2 className={heading}>Past orders</h2>
            <PastList past={past} />
          </section>
        </div>
      ) : (
        <Segmented value={list} onValueChange={(value) => setList(value === 'past' ? 'past' : 'open')}>
          <SegmentedList className="mt-3.5" aria-label="Which orders">
            <SegmentedItem value="open">Open</SegmentedItem>
            <SegmentedItem value="past">Past</SegmentedItem>
          </SegmentedList>
          <SegmentedPanel value="open" className="mt-4"><OpenList open={open} /></SegmentedPanel>
          <SegmentedPanel value="past" className="mt-4"><PastList past={past} /></SegmentedPanel>
        </Segmented>
      )}
    </div>
  );
}

const openCount = (count: number) => (count === 0 ? 'No open orders' : count === 1 ? '1 open order' : `${count} open orders`);

// The open orders, earliest day first and chilled before dry, in the order the API sent them.
function OpenList({ open }: { open: OpenOrders }) {
  if (!open.data) {
    return open.isError
      ? <LoadError line what="your open orders" error={open.error} busy={open.isFetching} onRetry={() => { void open.refetch(); }} />
      : <ListSkeleton label="Loading your open orders" />;
  }
  const { orders, outlet } = open.data;
  if (orders.length === 0) return <p className="text-xs leading-[15px] text-muted-foreground">No open orders. Place one with + New order.</p>;
  return (
    <div className="space-y-3 lg:space-y-3.5">
      {orders.map((order) => <OrderCard key={order.id} order={order} outlet={outlet} look="open" />)}
    </div>
  );
}

// The past orders under a heading per day, newest first. More load as the end of the list comes into view.
function PastList({ past }: { past: PastOrders }) {
  if (!past.data) {
    return past.isError
      ? <LoadError line what="your past orders" error={past.error} busy={past.isFetching} onRetry={() => { void past.refetch(); }} />
      : <ListSkeleton label="Loading your past orders" />;
  }
  const outlet = past.data.pages[0]?.outlet;
  const days: { day: string; orders: StoreOrder[] }[] = [];
  for (const order of past.data.pages.flatMap((page) => page.orders)) {
    const day = dayOf(order);
    const last = days.at(-1);
    if (last?.day === day) last.orders.push(order);
    else days.push({ day, orders: [order] });
  }
  // A refresh that failed leaves the list as it was, which may be out of date. A next page that failed says so at
  // the foot instead.
  const stale = past.isRefetchError && <StaleNotice busy={past.isFetching} onRetry={() => { void past.refetch(); }} />;
  if (!outlet || days.length === 0) {
    return <div className="space-y-2.5">{stale}<p className="text-xs leading-[15px] text-muted-foreground">No past orders yet.</p></div>;
  }
  return (
    <div className="space-y-4">
      {stale}
      {days.map(({ day, orders }) => (
        <section key={day}>
          <h3 className="mb-[7px] font-sans text-xs leading-[17px] font-semibold text-muted-foreground">{shortDay(day)}</h3>
          <div className="space-y-2">
            {orders.map((order) => <OrderCard key={order.id} order={order} outlet={outlet} look="past" />)}
          </div>
        </section>
      ))}
      <OlderOrders past={past} />
    </div>
  );
}

// The foot of the past list. It asks for the next page when it scrolls into view, and says so when that fails.
function OlderOrders({ past }: { past: PastOrders }) {
  const foot = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = past;

  useEffect(() => {
    const el = foot.current;
    if (!el || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (!hasNextPage) return null;
  return (
    <div ref={foot} className="pt-2 pb-1 text-center text-xs leading-[15px] text-muted-foreground">
      {isFetchNextPageError ? (
        <p role="alert">
          Could not load older orders. {reasonOf(past.error)}{' '}
          <button type="button" className="font-semibold text-foreground underline underline-offset-2" onClick={() => { void fetchNextPage(); }}>Try again</button>
        </p>
      ) : (
        <p>{isFetchingNextPage ? 'Loading older orders…' : 'Older orders load as you scroll'}</p>
      )}
    </div>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {[0, 1].map((row) => (
        <Panel key={row} line className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton soft className="h-[22px] w-40 rounded-full" />
          <Skeleton className="h-3 w-44" />
        </Panel>
      ))}
    </div>
  );
}
