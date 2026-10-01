import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CARD, LiveLine, StaleLine, Switch } from '@/features/live/parts/ui';
import { plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { readState } from '../queries';
import { CONNECTION_LOST, NO_CONNECTION, clockTime, reasonOf, staleLine } from '../words';

// The pieces the three look-up pages share, in the style guide's tokens: the table and rail layout, the read's state
// line, the first-load and failure states, the header's controls and the detail's facts.

// From 1024 the table or timeline sits beside the detail rail, which narrows between 1024 and 1280. Below 1024 they
// stack: the table first in its own scrolling box, then the detail.
export const LAYOUT = 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_284px] lg:items-start lg:gap-5 xl:grid-cols-[minmax(0,1fr)_326px]';

export type ReadQuery = Pick<UseQueryResult<{ readAt: string }>, 'data' | 'error' | 'failureReason' | 'failureCount' | 'isError' | 'isPaused' | 'isPending' | 'isFetching' | 'refetch'>;

// Beside the summary: live while the last read worked, the last read's time when a refresh failed, and a line of its
// own once the connection is lost. The loaded records stay on screen in both.
export function ReadLine({ query, online }: { query: ReadQuery; online: boolean }) {
  const data = query.data;
  const state = readState(query, online);
  if (!data) return state === 'loading' ? <Skeleton aria-hidden="true" className="h-2.5 w-28 rounded-full" /> : null;
  if (state === 'offline') {
    return <p role="status" className="rounded-[10px] bg-warn-tint px-3 py-[7px] text-[11px] leading-[14px] font-semibold text-warn-ink">{CONNECTION_LOST}</p>;
  }
  if (state === 'stale') {
    return <StaleLine busy={query.isFetching && !query.isPaused} onRetry={() => { void query.refetch(); }}>{staleLine(data.readAt)}</StaleLine>;
  }
  return <LiveLine updated={clockTime(data.readAt)} />;
}

// The first read failed, or there is no connection to make it: the page says so and asks again on Try again. It never
// stands in an empty or zero result.
export function LoadFailed({ title, query, online }: { title: string; query: Pick<ReadQuery, 'error' | 'failureReason' | 'isFetching' | 'isPaused' | 'refetch'>; online: boolean }) {
  const busy = query.isFetching && !query.isPaused;
  return (
    <div role="alert" className={cn(CARD, 'px-5 py-5')}>
      <h2 className="font-sans text-[15px] leading-5 font-semibold">{title}</h2>
      <p className="mt-1.5 text-xs leading-4 text-muted-foreground">{!online ? NO_CONNECTION : reasonOf(query.error ?? query.failureReason)}</p>
      <Button variant="outline" className={plainButton('mt-4 h-9 px-4 text-xs')} disabled={busy} onClick={() => { void query.refetch(); }}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </div>
  );
}

// A sentence in a card where rows would be: an empty day, no match, nothing sent.
export function Note({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn(CARD, 'flex flex-wrap items-center justify-between gap-3 px-5 py-4', className)}>
      <p className="text-[13px] leading-[18px] font-semibold">{children}</p>
      {action}
    </div>
  );
}

// The summary under a page's title, as the frames write it: "104 orders", "5 planned", "99 deferred". A figure the
// frames colour keeps its tone, and the words carry the meaning too.
export interface Figure { value: string; label: string; tone?: 'warn' | 'bad'; note?: string }
export function Figures({ items, className }: { items: Figure[]; className?: string }) {
  return (
    <dl className={cn('flex flex-wrap items-baseline gap-x-6 gap-y-1', className)}>
      {items.map((item) => (
        <div key={item.label} className={cn('flex max-w-full items-baseline gap-[5px]', item.tone === 'warn' && 'text-warn-ink', item.tone === 'bad' && 'text-bad')}>
          <dd className="font-mono text-sm leading-[18px] font-bold whitespace-nowrap">{item.value}</dd>
          <dt className="min-w-0 text-[11px] leading-[14px]">
            <span className={cn(!item.tone && 'text-muted-foreground')}>{item.label}</span>
            {item.note && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] leading-3 font-semibold text-muted-foreground">{item.note}</span>}
          </dt>
        </div>
      ))}
    </dl>
  );
}

export function FiguresSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {[64, 72, 80, 120, 56].map((w, i) => (
        <span key={i} className="flex items-center gap-2"><Skeleton className="h-3 w-6 rounded-full" /><Skeleton soft className="h-2.5 rounded-full" style={{ width: w }} /></span>
      ))}
    </div>
  );
}

// A table or timeline that is wider than the room scrolls sideways inside its own box, never the page. The box takes
// the keyboard's focus, so its arrows reach every column. It is positioned, so the hidden column headers inside it
// stay inside it too.
export function ScrollBox({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn('relative min-w-0 overflow-x-auto overscroll-x-contain rounded-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}>
      {children}
    </div>
  );
}

const PILL = 'h-[27px] rounded-full border bg-card px-3 text-xs leading-none font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

// The frames' joined switch. On the narrowest phones a long one scrolls inside itself rather than widening the page.
export function Choices<T extends string>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={cn('max-w-full overflow-x-auto rounded-full', props.className)}>
      <Switch label={props.label} value={props.value} options={props.options} onChange={props.onChange} />
    </div>
  );
}

// The date picker: the browser's own date field, labelled, so the keyboard and a phone's picker both work.
export function DateInput({ label, value, onChange, className }: { label: string; value: string; onChange: (date: string) => void; className?: string }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-xs font-semibold', className)}>
      <span className="text-muted-foreground">{label}</span>
      <input type="date" value={value} onChange={(event) => { if (event.target.value) onChange(event.target.value); }} className={cn(PILL, 'font-mono tabular-nums')} />
    </label>
  );
}

export function SelectPill<T extends string>({ label, value, options, onChange, className }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string;
}) {
  return (
    <label className={cn('inline-flex', className)}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className={cn(PILL, 'pr-2')}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function SearchField({ label, value, placeholder, onChange, className }: { label: string; value: string; placeholder: string; onChange: (text: string) => void; className?: string }) {
  return (
    <label className={cn('relative inline-flex items-center', className)}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-[31px] w-full rounded-[10px] border bg-card pr-3 pl-8 text-xs leading-none outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
}

export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outline" aria-label={label} className={plainButton('h-8 shrink-0 gap-1 rounded-full px-3 text-xs')} onClick={onClick}>
      <X aria-hidden="true" className="size-3.5" />Close
    </Button>
  );
}

// A detail's facts, label left and value right, as the frames' rails write them; a vehicle's figures in mono.
export function Facts({ rows, mono = false, className }: { rows: [string, string][]; mono?: boolean; className?: string }) {
  return (
    <dl className={cn('space-y-[7px] text-[13px] leading-[18px]', className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0">{label}</dt>
          <dd className={cn('min-w-0 text-right text-muted-foreground', mono && 'font-mono')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A small heading inside a detail card: "Ordered", "Sent plans".
export function DetailHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 font-sans text-xs leading-4 font-semibold">{children}</h3>;
}

// First load: the table's cards and the rail in grey blocks, no sample figures and no spinner (Loading · skeleton).
export function TableSkeleton({ label, cards = [5, 3, 2] }: { label: string; cards?: number[] }) {
  return (
    <div role="status" aria-label={label} className="space-y-2.5">
      {cards.map((rows, card) => (
        <div key={card} aria-hidden="true" className={cn(CARD, 'px-4 pt-3 pb-3')}>
          <div className="flex items-center gap-2.5">
            <Skeleton soft className="size-[26px] rounded-md" />
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton soft className="h-2.5 w-14 rounded-full" />
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="mt-3 flex items-center gap-4 px-2">
              <Skeleton soft className="size-5 rounded-md" />
              <Skeleton className="h-2.5 w-14 rounded-full" />
              <Skeleton className="h-3 w-32 rounded-full" />
              <Skeleton className="hidden h-2.5 w-40 rounded-full sm:block" />
              <Skeleton className="hidden h-2.5 w-24 rounded-full md:block" />
              <Skeleton soft className="ml-auto h-2.5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function RailSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className={cn(CARD, 'px-5 pt-5 pb-5')}>
      <div className="flex items-center gap-2.5">
        <Skeleton soft className="size-[26px] rounded-md" />
        <Skeleton className="h-3.5 w-36 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-2.5 w-48 rounded-full" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-2.5 w-20 rounded-full" />
            <Skeleton soft className="h-2.5 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
