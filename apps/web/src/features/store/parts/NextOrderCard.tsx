import { Link } from 'react-router';
import type { StoreNextOrder } from '@wayfinder/contracts';
import { Chip } from '@/components/ui/chip';
import { cutoffTime, mixOf, shortDay, weekday } from '../words';
import { orangeLink, plainLink } from './actions';
import { ICON } from './icons';
import { Panel } from './Panel';

// No later operating day has an open cut-off, so there is nothing to order for (spec 009, AC-5).
export function NoOpenDay({ line = false }: { line?: boolean }) {
  return (
    <Panel line={line}>
      <h3 className="font-sans text-[15px] leading-[18px] font-semibold">No delivery day is open</h3>
      <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">Orders cannot be placed right now. Contact your depot.</p>
    </Panel>
  );
}

// "Your next order" on Today: the draft waiting to be placed, or the start of a new one.
export function NextOrderCard({ next }: { next: StoreNextOrder }) {
  if (!next.deliveryDate || !next.cutoffAt) return <NoOpenDay />;
  const { draft } = next;
  const what = draft ? mixOf(next.outlet.brand, draft.lines, draft.summary.units, next.products) : 'Nothing ordered yet';
  return (
    <Panel className="pt-[18px]">
      <div className="flex items-center gap-2.5">
        <img src={ICON.orders} alt="" className="size-8" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-[23px] font-bold">For {shortDay(next.deliveryDate)}</h3>
          <p className="mt-0.5 text-xs leading-[15px] text-muted-foreground">{what} · closes {cutoffTime(next.cutoffAt, next.cutoffIsToday)}</p>
        </div>
        {draft && <Chip tone="plain">Draft</Chip>}
      </div>
      <Link to="/store/orders/new" className={orangeLink('mt-2.5 h-[52px] w-full text-base')}>{draft ? 'Continue draft' : 'Start order'}</Link>
    </Panel>
  );
}

// What Today shows once orders are placed for the open day: what was placed and the way back to the
// confirmation. It is the orange action only while no new draft is asking to be continued.
export function PlacedCard({ next, orange }: { next: StoreNextOrder; orange: boolean }) {
  const { placed, deliveryDate } = next;
  if (!placed || !deliveryDate) return null;
  const waiting = placed.orders.every((order) => order.status === 'placed');
  return (
    <Panel>
      <div className="flex items-center gap-2">
        <img src={ICON.placed} alt="" className="size-6" />
        <h3 className="font-sans text-sm leading-[17px] font-semibold">
          {weekday(deliveryDate)}’s {placed.orders.length === 1 ? 'order is' : 'orders are'} placed
        </h3>
      </div>
      <p className="mt-3 text-xs leading-[15px] text-muted-foreground">
        {mixOf(next.outlet.brand, placed.lines, placed.summary.units, next.products)}{waiting && ' · waiting for the plan'}
      </p>
      <Link to="/store/orders/placed" className={(orange ? orangeLink : plainLink)('mt-[13px] h-[46px] w-full text-sm')}>View confirmation</Link>
    </Panel>
  );
}
