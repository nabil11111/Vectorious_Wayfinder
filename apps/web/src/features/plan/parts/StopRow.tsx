import type { ReactNode } from 'react';
import type { BoardOrder, BoardShop, StopTime } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { deferredOn, entranceAndWindow, hhmm, orderAmount, partLine } from '../words';
import { MenuGroup, MenuItem, MenuLabel, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger, Tag } from './ui';

// One stop of the open trip (Edit plan, "Stops in order"): its number, when the checker says it arrives, the
// shop, its entrance and window, the wait, the unloading and when it leaves, and "⋮" with what can be done: move
// it, and for each of its orders take it off, split it, defer it or join a split order back.
export function StopRow({ seq, shop, orders, time, longWait, first, last, onMove, onTakeOff, onSplit, onDefer, onJoin, children }: {
  seq: number;
  shop: BoardShop;
  orders: BoardOrder[];
  // The checker's times, or null while the trip on screen is not the one it timed.
  time: StopTime | null;
  longWait: boolean;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onTakeOff: (order: BoardOrder) => void;
  onSplit: (order: BoardOrder) => void;
  onDefer: (order: BoardOrder) => void;
  onJoin: (order: BoardOrder) => void;
  children?: ReactNode;
}) {
  const late = time?.late ?? false;
  const carried = orders.find((order) => order.carriedOver);
  const parts = orders.filter((order) => order.splitFrom !== null);
  const doing = [time && time.waitMin > 0 && `waits ${time.waitMin}`, `unload ${shop.unloadMin}`, time && `off ${hhmm(time.leaveAt)}`].filter(Boolean).join(' · ');
  return (
    <li className="border-t">
      <div className="flex items-center gap-2.5 py-[9px]">
        <span className={cn('flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold', late ? 'bg-bad text-white' : 'bg-secondary text-secondary-foreground')}>{seq}</span>
        <span className={cn('w-10 shrink-0 font-mono text-xs', late && 'text-bad')}>{time ? hhmm(time.arriveAt) : '--:--'}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[13px] leading-4 font-semibold">{shop.name}</span>
          {carried && <Tag tone="warn">{deferredOn(carried)}</Tag>}
          {parts.map((part) => <Tag key={part.id}>{partLine(part)}</Tag>)}
          <span className="text-[11px] leading-[14px] text-muted-foreground">{entranceAndWindow(shop, time?.windowOpen ?? shop.windowOpen, time?.windowClose ?? shop.windowClose)}</span>
          <span className={cn('font-mono text-[11px] leading-[14px]', longWait ? 'text-warn-ink' : 'text-muted-foreground')}>{doing}</span>
        </div>
        {late && <Tag tone="bad" className="text-[10px]">late</Tag>}
        <MenuRoot>
          <MenuTrigger aria-label={`More for stop ${seq}, ${shop.name}`} className="flex h-[22px] w-6 shrink-0 items-center justify-center rounded-md text-sm font-bold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted">⋮</MenuTrigger>
          <MenuPopup>
            <MenuItem disabled={first} onClick={() => onMove(-1)}>Move up</MenuItem>
            <MenuItem disabled={last} onClick={() => onMove(1)}>Move down</MenuItem>
            {orders.map((order) => (
              <MenuGroup key={order.id}>
                <MenuSeparator />
                <MenuLabel>{orderAmount(shop.brand, order)}</MenuLabel>
                <MenuItem onClick={() => onTakeOff(order)}>Take off</MenuItem>
                {order.splitFrom === null
                  ? <MenuItem onClick={() => onSplit(order)}>Split</MenuItem>
                  : <MenuItem onClick={() => onJoin(order)}>Join back</MenuItem>}
                <MenuItem onClick={() => onDefer(order)}>Defer</MenuItem>
              </MenuGroup>
            ))}
          </MenuPopup>
        </MenuRoot>
      </div>
      {children}
    </li>
  );
}
