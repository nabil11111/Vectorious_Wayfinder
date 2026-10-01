import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BoardOrder, BoardShop, StopTime } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { deferredOn, entranceAndWindow, hhmm, orderAmount, partLine } from '../words';
import { draggedOf, keysOf, landingLook, pressOf } from './dragging';
import type { Dragged, DragData, DropData, Landing } from './drops';
import { MenuGroup, MenuItem, MenuLabel, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger, Tag } from './ui';
import { Why, type WhyReason } from './Why';

// A stop as drag and drop knows it (spec 023): its id in the sortable list, what it is when dragged, the place it is
// for something dropped on it, that place's name, and whether anything can move now.
export interface StopDrag { id: string; dragged: Dragged; landing: Landing; name: string; movable: boolean }

// One stop of the open trip (Edit plan, "Stops in order"): its number, when the checker says it arrives, the
// shop, its entrance and window, the wait, the unloading and when it leaves, "why?" with the planner's reason for
// its orders (spec 014), and "⋮" with what can be done: move it, and for each of its orders take it off, split it,
// defer it or join a split order back. It can be dragged up and down, off its trip or onto another trip's card, by
// the pointer from anywhere on it and by the keyboard from its number. An order dropped on it lands before it.
export function StopRow({ seq, shop, orders, time, longWait, why, first, last, drag, onMove, onTakeOff, onSplit, onDefer, onJoin, children }: {
  seq: number;
  shop: BoardShop;
  orders: BoardOrder[];
  // The checker's times, or null while the trip on screen is not the one it timed.
  time: StopTime | null;
  longWait: boolean;
  // The planner's reason for each of the stop's orders it planned. Empty when it planned none of them.
  why: WhyReason[];
  first: boolean;
  last: boolean;
  drag: StopDrag;
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
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id: drag.id, data: { dragged: drag.dragged, landing: drag.landing, name: drag.name } satisfies DragData & DropData, disabled: !drag.movable,
  });
  // An order dragged over the stop lands before it, so the stop fills with its tint (the list is outlined as a whole).
  // Stops dragged along the list move aside instead.
  const dragging = draggedOf(active);
  const look = dragging?.kind === 'orders' && isOver ? landingLook(dragging, drag.landing, true) : '';
  const number = cn('flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold', late ? 'bg-bad text-white' : 'bg-secondary text-secondary-foreground');
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} onPointerDown={pressOf(listeners)} className={cn('border-t', isDragging && 'opacity-40', look)}>
      <div className="flex items-center gap-2.5 py-[9px]">
        {drag.movable
          ? (
            <button type="button" ref={setActivatorNodeRef} {...attributes} onKeyDown={keysOf(listeners)} aria-label={`Move stop ${seq}, ${shop.name}`} className={cn(number, 'cursor-grab outline-none focus-visible:ring-3 focus-visible:ring-ring/50')}>
              {seq}
            </button>
          )
          : <span className={number}>{seq}</span>}
        <span className={cn('w-10 shrink-0 font-mono text-xs', late && 'text-bad')}>{time ? hhmm(time.arriveAt) : '--:--'}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[13px] leading-4 font-semibold">{shop.name}</span>
          {carried && <Tag tone="warn">{deferredOn(carried)}</Tag>}
          {parts.map((part) => <Tag key={part.id}>{partLine(part)}</Tag>)}
          <span className="text-[11px] leading-[14px] text-muted-foreground">{entranceAndWindow(shop, time?.windowOpen ?? shop.windowOpen, time?.windowClose ?? shop.windowClose)}</span>
          <span className={cn('font-mono text-[11px] leading-[14px]', longWait ? 'text-warn-ink' : 'text-muted-foreground')}>{doing}</span>
        </div>
        {late && <Tag tone="bad" className="text-[10px]">late</Tag>}
        {why.length > 0 && <Why title={shop.name} reasons={why} />}
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
