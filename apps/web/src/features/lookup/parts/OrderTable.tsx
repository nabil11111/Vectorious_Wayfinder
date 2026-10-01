import type { LookupOrderRow, OrderStatus } from '@wayfinder/contracts';
import { CARD, Chip } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';
import type { OrderGroup } from '../filters';
import {
  STATUS_WORDS, clockTime, dayOfMonth, loadWords, timesShort, truckStop, whole, windowWords,
} from '../words';
import { brandIcon, shopIcon } from './icons';

// The Orders table (Dispatcher · Orders 102:76375): a card per brand with its districts, one row per order of the
// delivery day, and the frame's columns. The truck, stop and planned arrival are the listed day's own sent plan; the
// status is the order's current one, a separate fact. Last 4 weeks names each listed day beside its truck.

const COLUMNS = {
  day: 'grid-cols-[20px_68px_minmax(150px,1fr)_48px_140px_50px_84px_96px_44px_minmax(84px,0.5fr)_40px]',
  four_weeks: 'grid-cols-[20px_68px_minmax(150px,1fr)_48px_140px_50px_84px_132px_44px_minmax(84px,0.5fr)_40px]',
} as const;
// The narrowest each table may draw before its box scrolls: its columns, gaps and padding.
const MIN_WIDTH = { day: 'min-w-[952px]', four_weeks: 'min-w-[988px]' } as const;
const HEADS = ['Order', 'Shop', 'Wanted', 'Load', 'Temp', 'Window', 'Truck · stop', 'Arrive', 'Status', 'Deferred'];
export type Range = keyof typeof COLUMNS;

const STATUS_TONE: Partial<Record<OrderStatus, string>> = { deferred: 'text-warn-ink font-semibold', delivered: 'text-good', received: 'text-good' };

const orderAnchor = (orderId: string) => `order-${orderId}`;
const deferredOnListedDay = (row: LookupOrderRow) => row.days.some((day) => day.deferral !== null);

export function OrderTable({ groups, range, selectedId, onSelect }: {
  groups: OrderGroup[]; range: Range; selectedId: string | null; onSelect: (orderId: string) => void;
}) {
  return (
    <div className={cn('space-y-2.5', MIN_WIDTH[range])}>
      <div aria-hidden="true" className={cn('grid gap-x-2 px-6 text-[10px] leading-3 font-semibold text-muted-foreground', COLUMNS[range])}>
        <span />
        {HEADS.map((head) => <span key={head}>{head}</span>)}
      </div>
      {groups.map((group) => (
        <section key={group.brand} aria-labelledby={`orders-${group.brand}`} className={cn(CARD, 'px-4 pt-3 pb-2')}>
          <div className="flex items-center gap-2.5">
            <img src={brandIcon(group.brand)} alt="" className="size-[26px] object-contain" />
            <h2 id={`orders-${group.brand}`} className="text-[15px] leading-5 font-bold">{group.brand}</h2>
            <span className="text-[11px] leading-[14px] text-muted-foreground">{whole(group.rows.length)} {group.rows.length === 1 ? 'order' : 'orders'}</span>
          </div>
          {group.districts.map(({ district, rows }) => (
            <div key={district} className="mt-2">
              <h3 className="px-2.5 font-sans text-[11px] leading-[14px] font-semibold">{district}</h3>
              <div role="table" aria-label={`${group.brand} · ${district}`} className="mt-1">
                <div role="rowgroup" className="sr-only">
                  <div role="row">
                    <span role="columnheader">Shop picture</span>
                    {HEADS.map((head) => <span key={head} role="columnheader">{head}</span>)}
                  </div>
                </div>
                <div role="rowgroup">
                  {rows.map((row) => <OrderRow key={row.id} row={row} range={range} selected={row.id === selectedId} onSelect={onSelect} />)}
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function OrderRow({ row, range, selected, onSelect }: { row: LookupOrderRow; range: Range; selected: boolean; onSelect: (orderId: string) => void }) {
  const assigned = row.days.filter((day) => day.assignment !== null);
  const carried = row.days.some((day) => day.carriedOver);
  const tint = deferredOnListedDay(row) ? 'bg-warn-tint' : selected ? 'bg-selected' : null;
  return (
    <div
      role="row"
      id={orderAnchor(row.id)}
      onClick={() => onSelect(row.id)}
      className={cn(
        'grid min-h-8 cursor-pointer scroll-mt-28 items-center gap-x-2 rounded-[10px] px-2 py-1 text-[11px] leading-[14px] hover:bg-muted/70',
        COLUMNS[range], tint, selected && 'ring-[1.5px] ring-foreground ring-inset',
      )}
    >
      <span role="cell"><img src={shopIcon(row.outlet.brand)} alt="" className="size-5 object-contain" /></span>
      <span role="cell" title={row.id} className="truncate font-mono text-muted-foreground">{row.id.slice(0, 8)}</span>
      <span role="cell" className="min-w-0">
        <button
          type="button"
          data-order={row.id}
          aria-expanded={selected}
          aria-controls={selected ? 'order-detail' : undefined}
          onClick={(event) => { event.stopPropagation(); onSelect(row.id); }}
          className="max-w-full truncate rounded-md text-left text-xs leading-4 font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {row.outlet.name}
        </button>
      </span>
      <span role="cell" className={cn(carried && 'font-semibold text-warn-ink')}>{dayOfMonth(row.wantedDate)}</span>
      <span role="cell" className="truncate">{loadWords(row.outlet.brand, row.load)}</span>
      <span role="cell">{row.temp}</span>
      <span role="cell" className="font-mono">{windowWords(row.outlet)}</span>
      <span role="cell">
        {assigned.length > 0
          ? assigned.map((day) => (
            <span key={day.date} className="block whitespace-nowrap">
              {range === 'four_weeks' && <span className="mr-1">{dayOfMonth(day.date)} ·</span>}
              <span className="font-mono font-bold">{truckStop(day.assignment!)}</span>
            </span>
          ))
          : deferredOnListedDay(row)
            ? <span className="font-semibold text-warn-ink">deferred</span>
            : <Dash words={row.days.every((day) => day.publication === null) ? 'no sent plan' : 'on no trip'} />}
      </span>
      <span role="cell" className="font-mono">
        {assigned.length > 0 ? assigned.map((day) => <span key={day.date} className="block">{clockTime(day.assignment!.plannedArrival)}</span>) : <Dash words="no planned arrival" />}
      </span>
      <span role="cell" className={cn('truncate', STATUS_TONE[row.status])}>{STATUS_WORDS[row.status]}</span>
      <span role="cell">
        {row.timesDeferred > 0
          ? <Chip tone={row.timesDeferred > 1 ? 'bad' : 'warn'}><span className="sr-only">deferred </span>{timesShort(row.timesDeferred)}</Chip>
          : <Dash words="never deferred" />}
      </span>
    </div>
  );
}

// The frame's dash for an empty cell, said in words to a screen reader.
function Dash({ words }: { words: string }) {
  return <span className="text-muted-foreground"><span aria-hidden="true">–</span><span className="sr-only">{words}</span></span>;
}
