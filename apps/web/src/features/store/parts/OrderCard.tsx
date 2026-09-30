import type { StoreOrder, StoreOutlet } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { ENTRANCE, orderTitle, shortDay, windowShort } from '../words';
import { goodsIcon, ICON } from './icons';
import { Panel } from './Panel';
import { StatusChip } from './StatusChip';

type Look = 'today' | 'open' | 'past';

// The lines under the chip (spec 009, rule 6). A placed order says its day, window and entrance. A planned
// one has its day in the chip already. An order that waited says why.
function linesOf(order: StoreOrder, outlet: StoreOutlet): string[] {
  const where = `${windowShort(outlet)} · ${ENTRANCE[outlet.dockType].toLowerCase()}`;
  switch (order.status) {
    case 'placed': return [`${shortDay(order.deliveryDate)} · ${where}`];
    case 'planned': return [where];
    case 'deferred': return [...(order.deferralReason ? [order.deferralReason] : []), 'New time window is awaiting confirmation.', 'Need another date? Contact your depot.'];
    default: return [];
  }
}

// One card for an order wherever it shows. Today draws it with the goods' picture and the chip on the right,
// the open list with the chip under the title, the past list with the chip on the right and no picture. The
// pieces after this one add their own lines here: the expected time, the new date, what arrived.
export function OrderCard({ order, outlet, look }: { order: StoreOrder; outlet: StoreOutlet; look: Look }) {
  const today = look === 'today';
  const icon = today ? goodsIcon(outlet.brand, order.temp) : look === 'open' && order.status === 'deferred' ? ICON.waiting : null;
  const lines = linesOf(order, outlet);
  return (
    <Panel line={!today}>
      <div className={cn('flex', look === 'open' ? 'flex-col items-start gap-2.5' : 'flex-wrap items-center justify-between gap-x-3 gap-y-2')}>
        <div className={cn('flex items-center', today ? 'gap-2.5' : 'gap-2')}>
          {icon && <img src={icon} alt="" className={today ? 'size-8' : 'size-6'} />}
          <h3 className={today ? 'text-[17px] leading-[23px] font-bold' : 'font-sans text-[15px] leading-[18px] font-semibold'}>{orderTitle(outlet.brand, order)}</h3>
        </div>
        <StatusChip order={order} size={today ? 'default' : 'sm'} />
      </div>
      {lines.length > 0 && (
        <div className={cn('space-y-4 text-xs leading-[15px] text-muted-foreground', look === 'open' ? 'mt-[15px]' : 'mt-2')}>
          {lines.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
    </Panel>
  );
}
