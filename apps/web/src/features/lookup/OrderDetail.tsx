import { useId } from 'react';
import { Link } from 'react-router';
import type { LookupOrderRow, OrderStatus } from '@wayfinder/contracts';
import { CARD, Chip, type Tone } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';
import { shopIcon } from './parts/icons';
import { CloseButton, DetailHeading, Facts } from './parts/ui';
import {
  STATUS_WORDS, closedAnswerWords, closedVisitWords, clockTime, dayOfMonth, deferralName, depotDate, historyHref, historyLink, lineWords, loadWords,
  mallWords, nowWords, partOf, placedWords, timesLong, truckStop, unitsWords, wantedWords, windowWords,
} from './words';

// The selected order (Dispatcher · Orders, the detail rail): everything comes from its row of the list, never a second
// read. The current status is its own chip, apart from each dated sent plan; each sent plan names its date and opens
// that date in History. No call, Plan first or replacement controls (spec 017, "Not in this piece").

const STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: 'plain', placed: 'plain', planned: 'plain', deferred: 'warn', loaded: 'good', delivered: 'good', received: 'good', cancelled: 'plain', split: 'plain',
};

interface Entry { date: string; text: string; tone: 'plain' | 'warn' | 'quiet'; link?: { href: string; label: string } }

// The order's dated record, oldest first: when it was placed, the deferrals of sent plans before the listed days
// (a split part's include its original's), then each listed day's own sent plan, with each closed visit on its stop
// and its answer (Q-46).
function entriesOf(row: LookupOrderRow): Entry[] {
  const listed = new Set(row.days.flatMap((day) => (day.publication ? [day.publication.id] : [])));
  const placed: Entry[] = row.placedAt ? [{ date: depotDate(row.placedAt), text: `placed for ${dayOfMonth(row.wantedDate)}`, tone: 'quiet' }] : [];
  const earlier: Entry[] = row.deferralHistory.filter((deferral) => !listed.has(deferral.planId)).map((deferral) => ({
    date: deferral.date, text: `deferred · ${deferral.reason || deferralName(deferral.code)}`, tone: 'warn',
    link: { href: historyHref(deferral.date), label: historyLink(deferral.date) },
  }));
  const days: Entry[] = row.days.flatMap((day): Entry[] => {
    if (day.assignment) {
      const { assignment } = day;
      return [{
        date: day.date, tone: 'plain' as const, text: `planned · ${truckStop(assignment)} · arrives ${clockTime(assignment.plannedArrival)}`,
        link: { href: historyHref(day.date, assignment.tripId), label: historyLink(day.date) },
      // Each time nobody was at the shop on this stop, then its answer (Q-46).
      }, ...assignment.closed.flatMap((visit) => [
        { date: day.date, tone: 'warn' as const, text: closedVisitWords(visit, assignment) },
        { date: day.date, tone: visit.decision === 'bring_back' ? 'warn' as const : 'quiet' as const, text: closedAnswerWords(visit) },
      ])];
    }
    if (day.deferral) {
      return [{ date: day.date, tone: 'warn', text: `deferred · ${day.deferral.reason || deferralName(day.deferral.code)}`, link: { href: historyHref(day.date), label: historyLink(day.date) } }];
    }
    return [{ date: day.date, tone: 'quiet', text: day.publication ? 'on the sent plan, on no trip' : 'no sent plan yet' }];
  });
  return [...placed, ...earlier, ...days].sort((a, b) => a.date.localeCompare(b.date));
}

// anchor is the id the page scrolls to, one per depot's part on both depots together (spec 021).
export function OrderDetail({ row, anchor, onClose }: { row: LookupOrderRow; anchor: string; onClose: () => void }) {
  const title = useId();
  const part = partOf(row);
  const facts: [string, string][] = [
    ['Load', loadWords(row.outlet.brand, row.load)],
    ['Temp', row.temp],
    ['Window', windowWords(row.outlet).replace('–', ' to ') + (row.outlet.mallWindow ? ` · ${mallWords(row.outlet.mallWindow)}` : '')],
    ['Shop', `${row.outlet.id} · ${row.outlet.district}`],
    ...(row.note ? [['Note', row.note] as [string, string]] : []),
  ];
  return (
    <section id={anchor} aria-labelledby={title} className={cn(CARD, 'scroll-mt-24 px-5 pt-[18px] pb-5')}>
      <div className="flex items-start gap-2.5">
        <img src={shopIcon(row.outlet.brand)} alt="" className="mt-[-3px] size-[26px] shrink-0 object-contain" />
        <h2 id={title} className="min-w-0 flex-1 text-[15px] leading-5 font-bold">{row.outlet.name}</h2>
        <CloseButton label={`Close ${row.outlet.name}`} onClick={onClose} />
      </div>
      <p className="mt-2 font-mono text-[11px] leading-4 break-all text-muted-foreground">{row.id}</p>
      <p className="font-mono text-[11px] leading-4 text-muted-foreground">{placedWords(row.placedAt)} · {wantedWords(row.wantedDate)}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Chip tone={row.broughtBack ? 'warn' : STATUS_TONE[row.status]}>{nowWords(row)}</Chip>
        {row.timesDeferred > 0 && <Chip tone={row.timesDeferred > 1 ? 'bad' : 'warn'}>{timesLong(row.timesDeferred)}</Chip>}
        {row.days.some((day) => day.carriedOver) && <Chip tone="warn">carried over</Chip>}
        {part && <Chip tone="plain">{part}</Chip>}
      </div>
      <Facts rows={facts} className="mt-3.5" />

      <DetailHeading>Ordered</DetailHeading>
      <ul className="mt-1.5 space-y-1 text-xs leading-4">
        {row.lines.map((line) => <li key={line.lineId}>{lineWords(line)}</li>)}
      </ul>

      {row.original && (
        <>
          <DetailHeading>Split from one order</DetailHeading>
          <p className="mt-1.5 text-xs leading-4">
            <span className="font-mono">{row.original.id.slice(0, 8)}</span> · {unitsWords(row.outlet.brand, row.original.load.units)} · {wantedWords(row.original.wantedDate)} · {STATUS_WORDS[row.original.status].toLowerCase()}
          </p>
          <ul className="mt-1 space-y-1 text-xs leading-4 text-muted-foreground">
            {row.parts.map((each) => (
              <li key={each.id}>
                <span className="font-mono">{each.id.slice(0, 8)}</span> · {unitsWords(row.outlet.brand, each.load.units)} · {STATUS_WORDS[each.status].toLowerCase()}
                {each.id === row.id && <span className="ml-1 font-semibold text-foreground">· this part</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <DetailHeading>History</DetailHeading>
      <ol className="mt-1.5 space-y-[7px]">
        {entriesOf(row).map((entry, i) => (
          <li key={`${entry.date}-${i}`} className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-2.5 text-[11px] leading-[15px]">
            <span className="font-mono text-muted-foreground">{dayOfMonth(entry.date)}</span>
            <span>
              <span className={cn(entry.tone === 'warn' && 'font-semibold text-warn-ink', entry.tone === 'quiet' && 'text-muted-foreground')}>{entry.text}</span>
              {entry.link && (
                <Link to={entry.link.href} className="mt-0.5 block font-semibold underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  {entry.link.label}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
