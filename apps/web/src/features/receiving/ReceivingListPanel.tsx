import { useId, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReceivingList, ReceivingStatus } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { useOnline } from '@/features/live/operations';
import { depotDay } from '@/features/live/words';
import { clockTime, shortDay } from '@/features/store/words';
import { inDepot, useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { receivingListOptions, useFollowReceiving } from './api';
import { receivingCounts, receivingMatches, type ReceivingFilter } from './list';
import { statusWords } from './words';

const filters: [ReceivingStatus, string][] = [['ready', 'Ready'], ['unavailable', 'Unavailable'], ['unconfirmed', 'Not confirmed']];
const control = 'rounded-md px-2 py-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50';
const tone = { ready: 'text-good', unavailable: 'text-warn-ink', unconfirmed: 'text-muted-foreground' };

export function ReceivingListPanel({ depot }: { depot: string }) {
  const { data: me } = useMe(); const clock = useAppClock(); const online = useOnline();
  const date = clock.at === null ? null : depotDay(clock.at);
  const options = receivingListOptions(me, depot, date, clock.state?.day);
  useFollowReceiving(options.queryKey);
  const query = useQuery(options);
  // Presentation state resets with the existing account/depot/calendar/reset identity, while the read stays unchanged.
  return <ReceivingSummary key={JSON.stringify(options.queryKey)} depot={depot} date={date} query={query} online={online} />;
}
function ReceivingSummary({ depot, date, query, online }: { depot: string; date: string | null; query: UseQueryResult<ReceivingList>; online: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<ReceivingFilter>('all');
  const [search, setSearch] = useState('');
  const id = useId();
  const data = query.data;
  const current = data && data.date !== null && data.date === date && data.states.every(row => row.date === data.date) ? data : null;
  const stale = !online || query.isError;
  const counts = current ? receivingCounts(current.states) : null;
  const matches = current ? receivingMatches(current.states, filter, search) : [];
  const shown = showAll ? matches : matches.slice(0, 6);
  const choose = (status: ReceivingFilter) => { setFilter(status); setShowAll(false); setExpanded(true); };
  const clear = () => { setFilter('all'); setSearch(''); setShowAll(false); };
  const toggle = () => { if (expanded) clear(); setExpanded(!expanded); };
  return <section aria-label={`Shop receiving status · ${depot}`} className="my-3 rounded-lg border bg-card px-3 py-2.5 [overflow-anchor:none] sm:px-4">
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-sm font-semibold">Shop receiving status</h2>
      {date && <span className="text-xs text-muted-foreground">{shortDay(date)}</span>}
      {current && <button type="button" className={cn(control, 'ml-auto font-semibold underline underline-offset-2')} aria-expanded={expanded} aria-controls={id} onClick={toggle}>{expanded ? 'Hide shops' : 'View shops'}</button>}
    </header>
    {current && counts ? <>
      <div role="group" aria-label="Filter shops by receiving status" className="mt-1 flex flex-wrap items-center gap-1">
        {stale && <span className="mr-1 text-xs font-semibold text-muted-foreground">Last known</span>}
        {filters.map(([status, label]) => <button key={status} type="button" className={cn(control, tone[status], expanded && filter === status && 'bg-muted font-semibold')}
          aria-label={`${label}: ${counts[status]} shops`} aria-pressed={expanded && filter === status} onClick={() => choose(status)}>
          {label} <span className="ml-1 font-mono tabular-nums">{counts[status]}</span>
        </button>)}
      </div>
      {query.isError && <p role="alert" className="mt-1 text-xs text-muted-foreground">Could not read current updates. These are the last known declarations. <button type="button" className={cn(control, 'underline')} disabled={!online || query.isFetching} onClick={() => { void query.refetch(); }}>Read again</button></p>}
      {!online && <p className="mt-1 text-xs text-muted-foreground">Offline · connect to read current updates.</p>}
      {expanded && <div id={id} className="mt-2 space-y-2">
        <p className="text-xs leading-4 text-muted-foreground">Managers update this for today. It guides deliveries and does not stop the driver’s work.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-0 flex-1 text-xs"><span className="sr-only">Search shops</span><input type="search" placeholder="Search shops" aria-label="Search shops" value={search} onChange={event => { setSearch(event.target.value); setShowAll(false); }}
            className="h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" /></label>
          <button type="button" className={cn(control, filter === 'all' && 'bg-muted font-semibold')} aria-pressed={filter === 'all'} onClick={() => choose('all')}>All shops</button>
          {(filter !== 'all' || search !== '') && <button type="button" className={cn(control, 'underline')} onClick={clear}>Clear</button>}
        </div>
        {matches.length > 0 ? <>
          <div role="region" aria-label="Shop receiving results" tabIndex={0} className={cn('max-h-[min(320px,45dvh)] overflow-y-auto overscroll-contain rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50', matches.length > 6 && 'h-[min(320px,45dvh)]')}>
            <ul className="divide-y">{shown.map(row => <li key={row.outletId} className="py-2 pr-2 text-xs leading-4">
              <div className="flex items-start justify-between gap-3"><span className="min-w-0 font-semibold">{row.shopName}</span><span className={cn('shrink-0', tone[row.status])}>{statusWords[row.status]}</span></div>
              {row.note && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{row.note}</p>}
              {row.updatedAt && <p className="mt-1 text-muted-foreground">Updated <time dateTime={row.updatedAt} title={inDepot(Date.parse(row.updatedAt)).date}>{clockTime(row.updatedAt)}</time></p>}
            </li>)}</ul>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p role="status">Showing {shown.length} of {matches.length} {filter !== 'all' || search.trim() ? 'matching shops' : 'shops'}</p>
            {matches.length > 6 && <button type="button" className={cn(control, 'font-semibold underline underline-offset-2')} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : 'Show more'}</button>}
          </div>
        </> : <p role="status" className="py-2 text-xs text-muted-foreground">{current.states.length === 0 ? 'No shops to show.' : 'No shops match this search and status filter.'}</p>}
      </div>}
    </> : data?.date === null ? <div className="mt-1 text-xs text-muted-foreground">
      <p>{stale ? 'Last known · ' : ''}No receiving day today.</p>
      {query.isError && <p role="alert">Could not read current updates. <button type="button" className={cn(control, 'underline')} disabled={!online || query.isFetching} onClick={() => { void query.refetch(); }}>Read again</button></p>}
      {!online && <p>Offline · connect to read current updates.</p>}
    </div> : <div className="mt-1 text-xs text-muted-foreground">
      <p role={query.isError ? 'alert' : 'status'}>{!online ? 'Status unknown. Connect to read the shops.' : query.isError || (data && !current) ? 'Status unknown. Could not read current declarations.' : 'Reading shop receiving status…'}</p>
      {(query.isError || (data && !current)) && <Button variant="outline" className="mt-2 h-8 text-xs" disabled={!online || query.isFetching} onClick={() => { void query.refetch(); }}>Read again</Button>}
    </div>}
  </section>;
}
