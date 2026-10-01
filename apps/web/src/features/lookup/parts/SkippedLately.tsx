import { useId } from 'react';
import type { LookupOrders } from '@wayfinder/contracts';
import { CARD, Chip } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';
import { NO_SKIPS, dayOfMonth, deferralName, rangeWords, timesShort } from '../words';
import { ICON } from './icons';

// Skipped lately · 4 weeks (the Orders frame's lower rail, rule 11, D-89): the shops a sent plan left out in the 28
// dates ending on the chosen day, each counted once per plan, with the latest skip's date and reasons. The server
// reads it apart from the table, so the table's search and filters never change it.
export function SkippedLately({ skipped, className }: { skipped: NonNullable<LookupOrders['skippedLately']>; className?: string }) {
  const title = useId();
  return (
    <section aria-labelledby={title} className={cn(CARD, 'px-5 pt-[18px] pb-4', className)}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.waiting} alt="" className="size-[26px] object-contain" />
        <h2 id={title} className="text-[15px] leading-5 font-bold">Skipped lately · 4 weeks</h2>
      </div>
      <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{rangeWords(skipped.from, skipped.to)}</p>
      {skipped.rows.length === 0 ? (
        <p className="mt-3 text-xs leading-4 text-muted-foreground">{NO_SKIPS}</p>
      ) : (
        <ol className="mt-2">
          {skipped.rows.map((row) => (
            <li key={row.outlet.id} className="flex items-start justify-between gap-3 py-[7px]">
              <div className="min-w-0">
                <p className="text-xs leading-4 font-semibold">{row.outlet.name}</p>
                <p className="mt-0.5 text-[11px] leading-[15px] text-muted-foreground">
                  {row.reasons.map((reason) => reason.reason || deferralName(reason.code)).join(' ')} · last {dayOfMonth(row.latestDate)}
                </p>
              </div>
              <Chip tone={row.count > 1 ? 'bad' : 'warn'} className="mt-0.5"><span className="sr-only">skipped </span>{timesShort(row.count)}</Chip>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
