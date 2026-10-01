import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { StoreOrder, StoreOutlet } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import {
  deliveredLine, ENTRANCE, lateLine, lessLine, nobodyLine, orderTitle, receivedAtLine, receivedWords, replacementForLine, shortDay,
  shortLine, windowShort,
} from '../words';
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

// What happened from the order's latest stop on a sent plan on (spec 015, rule 11): the day a replacement replaces,
// nobody at the shop, the handover and what came short of the order, or what the shop received, and a line per problem
// of that stop that counts the order. A received card on Today says how many in its line and when in its chip; in
// Orders the other way round, or that the truck came after the window.
function factsOf(order: StoreOrder, look: Look): string[] {
  const { delivery, receipt } = order;
  const facts: string[] = [];
  if (order.replacementFor) facts.push(replacementForLine(order.replacementFor));
  if (delivery?.outcome === 'closed') facts.push(nobodyLine(delivery));
  else if (order.status === 'received' && receipt) {
    facts.push(look === 'today' ? receivedWords(receipt) : delivery?.late ? lateLine(delivery) : receivedAtLine(receipt));
    const short = delivery && shortLine(delivery);
    if (short) facts.push(short);
  } else if (order.status === 'delivered' && delivery) {
    facts.push(deliveredLine(delivery));
    const less = lessLine(order, delivery);
    if (less) facts.push(less);
  }
  // Each problem's line as the server words it, naming the cartons it is about (Q-36).
  for (const problem of order.problems) facts.push(problem.line);
  return facts;
}

// One card for an order wherever it shows. Today draws it with the goods' picture and the chip on the right,
// the open list with the chip under the title, the past list with the chip on the right and no picture. A card whose
// receipt reported something opens that receipt (spec 015, rule 11).
export function OrderCard({ order, outlet, look }: { order: StoreOrder; outlet: StoreOutlet; look: Look }) {
  const today = look === 'today';
  const icon = today ? goodsIcon(outlet.brand, order.temp) : look === 'open' && order.status === 'deferred' ? ICON.waiting : null;
  const lines = linesOf(order, outlet);
  const facts = factsOf(order, look);
  const reported = order.delivery && order.problems.some((problem) => problem.kind === 'receipt') ? order.delivery.stopId : null;
  const card = (
    <Panel line={!today} className={cn(reported && 'transition-colors group-hover:border-foreground/25')}>
      <div className={cn('flex', look === 'open' ? 'flex-col items-start gap-2.5' : 'flex-wrap items-center justify-between gap-x-3 gap-y-2')}>
        <div className={cn('flex items-center', today ? 'gap-2.5' : 'gap-2')}>
          {icon && <img src={icon} alt="" className={today ? 'size-8' : 'size-6'} />}
          <h3 className={today ? 'text-[17px] leading-[23px] font-bold' : 'font-sans text-[15px] leading-[18px] font-semibold'}>{orderTitle(outlet.brand, order)}</h3>
        </div>
        <StatusChip order={order} size={today ? 'default' : 'sm'} today={today} />
      </div>
      {lines.length > 0 && (
        <div className={cn('space-y-4 text-xs leading-[15px] text-muted-foreground', look === 'open' ? 'mt-[15px]' : 'mt-2')}>
          {lines.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
      {facts.length > 0 && (
        // The past list's line sits close under its chip, as Shop · Orders · Past draws it.
        <div className={cn('space-y-1.5 text-xs leading-[15px] text-muted-foreground', lines.length > 0 ? 'mt-1.5' : look === 'open' ? 'mt-[15px]' : look === 'past' ? 'mt-1' : 'mt-2')}>
          {facts.map((fact, i) => <p key={`${i}:${fact}`}>{fact}</p>)}
        </div>
      )}
    </Panel>
  );
  return reported ? <Opens to={`/store/deliveries/${reported}`}>{card}</Opens> : card;
}

// The whole card as the way to its receipt, as the design's "View shortage report" is.
function Opens({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="group block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{children}</Link>;
}
