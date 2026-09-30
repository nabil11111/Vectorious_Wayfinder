import { Fragment } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { IssueList } from '@wayfinder/contracts';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { plainButton } from '@/features/plan/parts/look';
import { StaleNotice } from '@/features/store/parts/LoadError';
import { clockTime, sentLine } from '@/features/loader/words';
import { reasonOf } from '@/features/store/words';
import { cn } from '@/lib/utils';
import { IssueCard, RaisedAt } from './IssueCard';
import type { Answering } from './issues';

const CARD = 'rounded-[14px] bg-card shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]';

// Live day's "Needs you" column (spec 012, D-39): the green line of the answer just sent, then the depot's open
// problems, oldest first, each in full in one outlined card, or "Nothing needs you right now." A7 builds the rest of
// Live day around it and keeps it as it is.
export function NeedsYou({ query, answering, className }: { query: UseQueryResult<IssueList>; answering: Answering; className?: string }) {
  if (!query.data) {
    return (
      <section aria-label="Needs you" className={className}>
        {query.isError ? (
          <div role="alert" className={cn(CARD, 'p-5')}>
            <h2 className="font-sans text-[15px] leading-5 font-semibold">Could not load what needs you.</h2>
            <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{reasonOf(query.error)}</p>
            <Button variant="outline" className={plainButton('mt-4 h-9 w-full text-xs')} disabled={query.isFetching} onClick={() => { void query.refetch(); }}>
              {query.isFetching ? 'Trying…' : 'Try again'}
            </Button>
          </div>
        ) : <NeedsYouSkeleton />}
      </section>
    );
  }

  const open = query.data.issues;
  return (
    <section aria-label="Needs you" className={cn('space-y-3', className)}>
      {query.isError && <StaleNotice busy={query.isFetching} onRetry={() => { void query.refetch(); }} />}
      {answering.refused && <p role="alert" className="rounded-[10px] bg-bad-tint px-3 py-2.5 text-xs leading-4 font-semibold text-bad">{answering.refused}</p>}
      {answering.sent && (
        <div role="status" className="rounded-[14px] bg-good-tint px-5 pt-4 pb-[18px]">
          <p className="flex items-center gap-2 text-[13px] leading-4 font-bold text-good">
            {/* The design draws a plain tick here, so it is the outline set's. */}
            <Check className="size-4 stroke-[2.5]" aria-hidden="true" />
            Sent {answering.sent.decidedAt ? clockTime(answering.sent.decidedAt) : ''}
          </p>
          <p className="mt-3 text-xs leading-4 font-semibold">{sentLine(answering.sent)}</p>
        </div>
      )}
      {open.length > 0 ? (
        <div className="rounded-[14px] border-2 border-foreground bg-card px-3.5 pt-3 pb-3.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-sans text-[11px] leading-[14px] font-semibold text-muted-foreground">Needs you · {open.length}</h2>
            <RaisedAt issue={open[0]!} />
          </div>
          {open.map((issue, i) => (
            <Fragment key={issue.id}>
              {i > 0 && <hr className="mt-5 border-border" />}
              <IssueCard issue={issue} answering={answering} time={i > 0} className={i > 0 ? 'mt-5' : 'mt-2'} />
            </Fragment>
          ))}
        </div>
      ) : (
        <div className={cn(CARD, 'px-5 py-[18px]')}>
          <h2 className="font-sans text-[11px] leading-[14px] font-semibold text-muted-foreground">Needs you</h2>
          <p className="mt-2 text-[13px] leading-[18px]">Nothing needs you right now.</p>
        </div>
      )}
    </section>
  );
}

// The first load (Dispatcher · Live day · loading): grey blocks in the shape of a problem card.
function NeedsYouSkeleton() {
  return (
    <div role="status" aria-label="Loading what needs you" className={cn(CARD, 'p-5')}>
      <div className="flex items-center gap-3">
        <Skeleton soft className="size-6 rounded-md" />
        <Skeleton className="h-3 w-32 rounded-full" />
      </div>
      <Skeleton className="mt-5 h-2.5 w-full rounded-full" />
      <Skeleton className="mt-2 h-2.5 w-4/5 rounded-full" />
      <div className="mt-4 flex gap-2.5">
        <Skeleton soft className="h-9 w-2/5 rounded-[10px]" />
        <Skeleton soft className="h-9 w-2/5 rounded-[10px]" />
      </div>
      <Skeleton className="mt-6 h-2.5 w-full rounded-full" />
      <Skeleton className="mt-2 h-2.5 w-4/5 rounded-full" />
      <div className="mt-4 flex gap-2.5">
        <Skeleton soft className="h-9 w-2/5 rounded-[10px]" />
        <Skeleton soft className="h-9 w-2/5 rounded-[10px]" />
      </div>
    </div>
  );
}
