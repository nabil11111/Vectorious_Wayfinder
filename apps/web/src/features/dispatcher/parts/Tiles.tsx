import type { ReactNode } from 'react';
import type { IssueList, OperationsDay } from '@wayfinder/contracts';
import { ICON } from '@/features/live/parts/icons';
import { Bar, CARD } from '@/features/live/parts/ui';
import { FUEL_UNAVAILABLE, NO_NEXT_DAY, NO_QUOTA, deliveredNote, fuelLitres, ratio } from '@/features/live/words';
import { weekday } from '@/features/store/words';
import { clockTime, whole } from '@/features/loader/words';
import { inDepot } from '@/lib/clock';
import { cn } from '@/lib/utils';

// The dashboard's six tiles (Dispatcher · Dashboard 53:11540, spec 016 rule 3): who needs the dispatcher, stops
// delivered, trucks out, the next run's orders, the week's fuel and the plan's deferrals. Each figure is the read's,
// and each bar draws its own tile's numerator and denominator. Need you is the open problems the bell counts.
export function Tiles({ day, issues }: { day: OperationsDay; issues: { data: IssueList | undefined; isError: boolean } }) {
  const c = day.counts;
  const planOut = day.plan !== null;
  const open = issues.data && !issues.isError ? issues.data.issues.length : null;
  const fuel = day.fuel;
  const next = day.nextRun;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Tile icon={ICON.alert} value={open === null ? '–' : whole(open)} label="need you now" tone={open ? 'bad' : undefined} />
      <Tile icon={ICON.delivered} value={ratio(c.stopsDelivered, c.stopsTotal)} label={deliveredNote(c, planOut)}
        bar={<Bar progress={c.deliveryProgress} label="Stops delivered" />} />
      <Tile icon={ICON.trucks} value={ratio(c.vehiclesOut, c.vehiclesTotal)} label="trucks out now" bar={<Bar progress={c.truckProgress} label="Trucks out now" />} />
      <Tile icon={ICON.nextRun} value={next ? whole(next.orders) : '–'}
        label={next ? `orders for ${weekday(next.date)} · closes ${inDepot(Date.parse(next.cutoffAt)).weekday} ${clockTime(next.cutoffAt)}` : NO_NEXT_DAY} />
      <Tile icon={ICON.fuel} value={!fuel || fuel.percent === null ? '–' : `${fuel.percent}%`}
        label={!fuel ? FUEL_UNAVAILABLE : fuel.percent === null ? NO_QUOTA : `fuel · ${fuelLitres(fuel)} this week`}
        bar={fuel && <Bar tone="quiet" progress={{ numerator: fuel.percent === null ? null : fuel.litres, denominator: fuel.quotaLitres, percent: fuel.percent }} label="Fuel recorded and committed this week" />} />
      <Tile icon={ICON.deferred} value={whole(c.deferredOrders)} label={planOut ? 'deferred on this plan' : 'deferred · no plan out'} />
    </div>
  );
}

// A tile as the frame draws it: the figure, its words under it, the design's picture at the right and, where the
// tile has one, its bar at the foot. A tile without a bar holds its figure in the middle.
function Tile({ icon, value, label, bar, tone }: { icon: string; value: string; label: ReactNode; bar?: ReactNode; tone?: 'bad' }) {
  return (
    <div className={cn(CARD, 'relative flex min-h-[88px] flex-col px-3.5 py-[13px]', !bar && 'justify-center', tone === 'bad' && 'bg-bad-tint shadow-none')}>
      <img src={icon} alt="" className={cn('absolute right-4 size-7 object-contain', bar ? 'top-[15px]' : 'top-1/2 -translate-y-1/2')} />
      <p className={cn('pr-10 font-heading text-[26px] leading-8 font-bold whitespace-nowrap', tone === 'bad' && 'text-bad')}>{value}</p>
      <p className={cn('text-xs leading-4 text-muted-foreground', !bar && 'pr-10')}>{label}</p>
      {bar && <div className="mt-auto pt-2">{bar}</div>}
    </div>
  );
}
