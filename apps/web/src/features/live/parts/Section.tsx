import type { Issue, OperationsBrandTotal, OperationsGroup, OperationsTimeline } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { brandLine, brandName, groupLine } from '../words';
import { brandIcon } from './icons';
import { rowFacts, shownGroups, type Filter } from './rows';
import { nowOn } from './axis';
import { Axis, NowLine } from './Timeline';
import { TripRow, type RowActions } from './TripRow';
import { CARD, Chip } from './ui';


// One dated part of Live day (the watched day, or an earlier day still out): its axis, the now line when the app
// clock is on its day, and a card per brand from the server's own brand totals, its districts and their trips.
export function Section({ date, totals, groups, timeline, filter, issues, actions, at }: {
  date: string; totals: OperationsBrandTotal[]; groups: OperationsGroup[]; timeline: OperationsTimeline | null; filter: Filter; issues: Issue[] | undefined; actions: RowActions; at: number | null;
}) {
  const now = timeline ? nowOn(timeline, date, at) : null;
  const shown = shownGroups(groups, filter);
  return (
    <div>
      {timeline && <div className="hidden lg:block"><Axis timeline={timeline} date={date} now={now} /></div>}
      <div className="relative mt-1 space-y-2.5">
        {timeline && <div className="hidden lg:contents"><NowLine timeline={timeline} now={now} /></div>}
        {totals.map((total) => {
          const brandGroups = shown.filter(({ group }) => group.brand === total.brand);
          if (brandGroups.length === 0) return null;
          return <BrandCard key={total.brand ?? 'mixed'} total={total} groups={groups.filter((group) => group.brand === total.brand)} shown={brandGroups} timeline={timeline} issues={issues} actions={actions} />;
        })}
      </div>
    </div>
  );
}

function BrandCard({ total, groups, shown, timeline, issues, actions }: {
  total: OperationsBrandTotal; groups: OperationsGroup[]; shown: { group: OperationsGroup; trips: OperationsGroup['trips'] }[]; timeline: OperationsTimeline | null; issues: Issue[] | undefined; actions: RowActions;
}) {
  // The brand's rows that need someone, as chips beside its name, as the frames draw them.
  const flagged = groups.flatMap((group) => group.trips).map((trip) => rowFacts(trip, issues)).filter((facts) => facts.tint !== null);
  const chips = [...new Map(flagged.map((facts) => [`${facts.tone}:${facts.word}`, facts])).values()].slice(0, 3);
  return (
    <section aria-label={brandName(total.brand)} className={cn(CARD, 'px-2 pt-2.5 pb-2 lg:px-4 lg:pt-3')}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1.5 lg:px-0">
        <img src={brandIcon(total.brand)} alt="" className="size-[26px] object-contain" />
        <h2 className="text-sm leading-5 font-bold">{brandName(total.brand)}</h2>
        {/* Below 1024 the brand's totals take their own line under its name and chips. */}
        <p className="order-last basis-full text-[11px] leading-[14px] text-muted-foreground lg:order-none lg:min-w-0 lg:flex-1 lg:basis-auto">{brandLine(total)}</p>
        <span className="ml-auto flex flex-wrap justify-end gap-1.5 lg:ml-0">
          {chips.map((facts) => <Chip key={`${facts.tone}:${facts.word}`} tone={facts.tone}>{facts.word}</Chip>)}
        </span>
      </div>
      {shown.map(({ group, trips }) => (
        <div key={`${group.brand ?? 'mixed'}:${group.district}`} className="mt-2">
          <h3 className="px-1.5 font-sans text-[11px] leading-[14px] font-semibold text-muted-foreground lg:px-0">{groupLine(group)}</h3>
          <ol className="mt-1.5 space-y-1.5 lg:mt-1 lg:space-y-0">
            {trips.map((trip) => <TripRow key={trip.tripId} trip={trip} facts={rowFacts(trip, issues)} timeline={timeline} issues={issues} actions={actions} />)}
          </ol>
        </div>
      ))}
    </section>
  );
}
