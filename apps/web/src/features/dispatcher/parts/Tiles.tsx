import type { ReactNode } from 'react';
import type { IssueList, OperationsCounts, OperationsDay } from '@wayfinder/contracts';
import { ICON } from '@/features/live/parts/icons';
import { Bar, CARD } from '@/features/live/parts/ui';
import { openCount, sumCounts, sumFuel, sumNextRun } from '@/features/live/sums';
import { FUEL_UNAVAILABLE, NO_NEXT_DAY, NO_QUOTA, deliveredNote, fuelLitres, needYouNow, nextRunOrders, ratio, trucksOutNow } from '@/features/live/words';
import { whole } from '@/features/loader/words';
import { cn } from '@/lib/utils';

// What the next run's tile says when the depots shown run their next days apart; each has its own line in Next run.
const NEXT_RUNS_DIFFER = 'next runs differ by depot';

// The delivered tile's words: "stops delivered · 1 partial", "· no plan out" when no depot has a plan out, and on both
// depots together the depot that has none.
function deliveredLabel(counts: OperationsCounts, depots: string[], noPlan: string[]) {
  if (noPlan.length === depots.length) return deliveredNote(counts, false);
  return [deliveredNote(counts, true), ...(noPlan.length ? [`no plan out at ${noPlan.join(' and ')}`] : [])].join(' · ');
}
function deferredLabel(depots: string[], noPlan: string[]) {
  if (noPlan.length === depots.length) return 'deferred · no plan out';
  if (noPlan.length) return `deferred · no plan out at ${noPlan.join(' and ')}`;
  return depots.length > 1 ? 'deferred on both plans' : 'deferred on this plan';
}

// The dashboard's six tiles (Dispatcher · Dashboard 53:11540, spec 016 rule 3): who needs the dispatcher, stops
// delivered, trucks out, the next run's orders, the week's fuel and the plans' deferrals. Each figure is the reads', and
// each bar draws its own tile's numerator and denominator. Need you is the open problems the bell counts. On both
// depots together each figure is the two depots' added up (spec 021, rule 1); one either depot did not record, or a
// list not read, leaves it unknown. days and issues are in the order of depots.
export function Tiles({ depots, days, issues }: { depots: string[]; days: OperationsDay[]; issues: { data?: IssueList; isError: boolean }[] }) {
  const c = sumCounts(days.map((day) => day.counts));
  const noPlan = depots.filter((_, i) => days[i]!.plan === null);
  const open = openCount(issues);
  const fuel = sumFuel(days.map((day) => day.fuel));
  const next = sumNextRun(days.map((day) => day.nextRun));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Tile icon={ICON.alert} value={open === null ? '–' : whole(open)} label={needYouNow(open)} tone={open ? 'bad' : undefined} />
      <Tile icon={ICON.delivered} value={ratio(c.stopsDelivered, c.stopsTotal)} label={deliveredLabel(c, depots, noPlan)}
        bar={<Bar progress={c.deliveryProgress} label="Stops delivered" />} />
      <Tile icon={ICON.trucks} value={ratio(c.vehiclesOut, c.vehiclesTotal)} label={trucksOutNow(c.vehiclesTotal)} bar={<Bar progress={c.truckProgress} label="Trucks out now" />} />
      <Tile icon={ICON.nextRun} value={next && next !== 'differ' ? whole(next.orders) : '–'}
        label={next === 'differ' ? NEXT_RUNS_DIFFER : next ? nextRunOrders(next) : NO_NEXT_DAY} />
      <Tile icon={ICON.fuel} value={!fuel || fuel.percent === null ? '–' : `${fuel.percent}%`}
        label={!fuel ? FUEL_UNAVAILABLE : fuel.percent === null ? NO_QUOTA : `fuel · ${fuelLitres(fuel)} this week`}
        bar={fuel && <Bar tone="quiet" progress={{ numerator: fuel.percent === null ? null : fuel.litres, denominator: fuel.quotaLitres, percent: fuel.percent }} label="Fuel recorded and committed this week" />} />
      <Tile icon={ICON.deferred} value={whole(c.deferredOrders)} label={deferredLabel(depots, noPlan)} />
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
