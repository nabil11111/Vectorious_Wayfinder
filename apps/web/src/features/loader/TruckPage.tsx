import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Issue, LoadingDay, LoadingLine, LoadingStop, LoadingTruck } from '@wayfinder/contracts';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { orangeButton, plainButton } from '@/features/plan/parts/look';
import { StaleNotice } from '@/features/store/parts/LoadError';
import { useAppClock } from '@/lib/clock';
import { cn } from '@/lib/utils';
import { SEE_CHANGES, usePlanChanges } from './changes';
import { useKeptRefusal, useLoadingDay, useLoaderWrites, type LoaderWrites, type WriteKind } from './loading';
import { DISPATCHER_ICON } from './parts/icons';
import { BackLink, LoadCard, StopList } from './parts/LoadCard';
import { LoadFailed, TruckGone } from './parts/LoadFailed';
import { NextList } from './parts/TruckRow';
import { ActionBar, Card, Label, NotSaved, Tag, TickBox } from './parts/ui';
import { KeptRefusal } from './TrucksPage';
import { useTicks } from './ticks';
import { allOnLine, answeredBy, answerSentence, brandOfStop, countOf, lineWords, outOnLine, readyLine, readyNote, truckName, waitingLine, whole } from './words';

// Load a truck at /loader/trucks/:tripId (spec 012, Loader · Load a truck, · phone and · all on, and Loader · Truck
// ready). The truck is found in the loading day by its id. It is loaded last stop first, a whole stop at a time, and
// marked ready once every stop is on and every flag is answered.
export function TruckPage() {
  const { tripId = '' } = useParams();
  // A write belongs to its truck: another truck opened from the Next list starts with none, and no sentence of the
  // truck before it.
  return <TruckScreen key={tripId} tripId={tripId} />;
}

function TruckScreen({ tripId }: { tripId: string }) {
  const query = useLoadingDay();
  const writes = useLoaderWrites();

  if (!query.data) {
    return query.isError
      ? <LoadFailed what="the trucks" error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} />
      : <TruckSkeleton />;
  }
  const stale = query.isError ? <StaleNotice busy={query.isFetching} onRetry={() => { void query.refetch(); }} /> : null;
  const truck = query.data.trucks.find((t) => t.tripId === tripId);
  // A truck its driver drove away says who and when (Q-34). A truck gone because the plan was sent again (spec 016)
  // has the list's sentence, and the way to what changed. The refusal and the write waiting for Try again stay on
  // screen with either (AC-31).
  if (!truck) {
    const left = query.data.left.some((t) => t.tripId === tripId);
    return (
      <>
        <KeptRefusal />
        {writes.phase === 'unsaved' && <NotSaved onRetry={writes.retry} />}
        {!left && <ChangesLink className="mb-3" />}
        <TruckGone day={query.data} tripId={tripId} />
      </>
    );
  }
  if (truck.status === 'ready') return <ReadyTruck day={query.data} truck={truck} stale={stale} />;
  return <LoadTruck day={query.data} truck={truck} writes={writes} stale={stale} />;
}

// The style guide's grey for a white button that is off.
const PLAIN_OFF = 'disabled:border-border/70 disabled:text-muted-foreground/65 disabled:opacity-100';
const BIG = 'h-16 w-full rounded-[12px] text-lg';
const SMALL = 'h-[52px] w-full rounded-[12px] text-[15px]';

function LoadTruck({ day, truck, writes, stale }: { day: LoadingDay; truck: LoadingTruck; writes: LoaderWrites; stale: ReactNode }) {
  const { at } = useAppClock();
  const refusal = useKeptRefusal();
  const ticks = useTicks(truck.tripId);
  // The stop being loaded is the last one not on yet (rule 4): the stops come last stop first.
  const current = truck.stops.find((stop) => !stop.loaded) ?? null;
  const open = truck.issues.filter((issue) => issue.status === 'open');
  const answered = truck.issues.filter((issue) => issue.status === 'decided');
  const flagged = new Set(truck.issues.flatMap((issue) => issue.lines.map((line) => line.lineId)));
  const busy = writes.phase !== 'idle';
  const saving = (kind: WriteKind) => writes.out === kind && writes.phase === 'saving';
  const loading = truck.status === 'loading';
  // A stop can be marked loaded once each of its lines is ticked or flagged.
  const stopDone = current !== null && current.lines.every((line) => ticks.isTicked(line.lineId) || flagged.has(line.lineId));
  const canReady = loading && current === null && open.length === 0;

  const send = {
    start: () => { if (day.plan) writes.send(truck.tripId, { kind: 'start', body: { revision: truck.revision, plan: day.plan } }); },
    stop: () => { if (current) writes.send(truck.tripId, { kind: 'stop', body: { revision: truck.revision, stopId: current.id } }); },
    ready: () => writes.send(truck.tripId, { kind: 'ready', body: { revision: truck.revision } }),
    // A stop marked loaded by mistake comes off again (Q-16), and its lines are ticked again as they go back on.
    undo: (stop: LoadingStop) => writes.send(truck.tripId, { kind: 'undo', body: { revision: truck.revision, stopId: stop.id } }, () => ticks.clear(stop.lines.map((line) => line.lineId))),
  };
  const readyWords = open.length > 0 ? `Mark ready · ${countOf(open.length, 'flag')}` : 'Mark ready';

  const orange = !loading
    ? <Button className={orangeButton(BIG)} disabled={busy} focusableWhenDisabled onClick={send.start}>{saving('start') ? 'Saving…' : `Start loading ${truckName(truck)}`}</Button>
    : current
      ? <Button className={orangeButton(BIG)} disabled={busy || !stopDone} focusableWhenDisabled onClick={send.stop}>{saving('stop') ? 'Saving…' : `Stop ${current.seq} loaded`}</Button>
      : <Button className={orangeButton(BIG)} disabled={busy || !canReady} focusableWhenDisabled onClick={send.ready}>{saving('ready') ? 'Saving…' : readyWords}</Button>;
  // Once every stop is on, Mark ready is the one button left.
  const plain = current && (
    <div className="grid grid-cols-2 gap-2.5 lg:gap-3">
      {loading && !busy
        ? <Link to={`/loader/trucks/${truck.tripId}/flag?stop=${current.id}`} className={plainButton(SMALL)}>Flag a problem</Link>
        : <Button variant="outline" className={plainButton(cn(SMALL, PLAIN_OFF))} disabled>Flag a problem</Button>}
      <Button variant="outline" className={plainButton(cn(SMALL, PLAIN_OFF))} disabled>{readyWords}</Button>
    </div>
  );
  const buttons = <div className="space-y-2.5 lg:space-y-3">{orange}{plain}</div>;

  return (
    <div>
      <BackLink to="/loader">Trucks</BackLink>
      <div className="mt-2.5 lg:mt-3.5">
        <OutOnLine truck={truck} />
        <KeptRefusal />
        {/* A start refused because the plan changed (012's refusal) offers the comparison when there is one. */}
        {refusal && <ChangesLink className="mb-3" />}
        {writes.phase === 'unsaved' && <NotSaved onRetry={writes.retry} />}
        {stale && <div className="mb-3">{stale}</div>}
      </div>
      <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:grid-rows-[auto_1fr] lg:gap-x-6">
        <LoadCard truck={truck} at={at} className="lg:col-start-1 lg:row-start-1" />
        <Card className="flex flex-col px-4 pt-4 pb-5 lg:sticky lg:top-[77px] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-[calc(100dvh-149px)] lg:self-start lg:px-5 lg:pt-[18px]">
          {current ? (
            <NowLoading truck={truck} stop={current} started={loading} ticks={ticks} flagged={flagged} />
          ) : (
            <AllOn truck={truck} />
          )}
          {/* A flag waiting for its answer shows under its own stop's lines (Q-23): here while that stop is being
              loaded, and in its row of "Load in this order" otherwise, so it never reads as the next stop's. */}
          {current && open.filter((issue) => issue.stop.id === current.id).map((issue) => (
            <p key={issue.id} className="mt-3 rounded-[10px] bg-warn-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-warn-ink">{waitingLine(issue)}</p>
          ))}
          {/* The dispatcher's answers show as soon as they come (rule 7), so a "Load it all" reaches the stop it is
              about while it is still being loaded. */}
          {answered.map((issue) => <Answer key={issue.id} issue={issue} />)}
          <div className="mt-auto hidden pt-6 lg:block">{buttons}</div>
        </Card>
        {/* While the truck loads, a loaded stop's row flags a problem on it or takes it off again (Q-16). */}
        <StopList truck={truck} current={current} menu={loading ? { busy, undoing: saving('undo'), onUndo: send.undo } : undefined} className="mt-1 lg:col-start-1 lg:row-start-2 lg:mt-2" />
      </div>
      <ActionBar>{buttons}</ActionBar>
    </div>
  );
}

// "Now loading · stop 2", the shop, and a tick box per line: the loader's own checklist, which is never saved. A
// flagged line says how many are short.
function NowLoading({ truck, stop, started, ticks, flagged }: {
  truck: LoadingTruck; stop: LoadingStop; started: boolean; ticks: ReturnType<typeof useTicks>; flagged: Set<string>;
}) {
  const brand = brandOfStop(truck, stop);
  return (
    <>
      <Label>{started ? 'Now loading' : 'Goes in first'} · stop {stop.seq}</Label>
      <h2 className="mt-[15px] text-2xl leading-8 font-bold">{stop.shopName}</h2>
      <ul className="mt-1.5">
        {stop.lines.map((line) => (
          <LineRow key={line.lineId} line={line} words={lineWords(line, brand)} ticked={ticks.isTicked(line.lineId)} flagged={flagged.has(line.lineId)} onToggle={() => ticks.toggle(line.lineId)} />
        ))}
      </ul>
    </>
  );
}

function LineRow({ line, words, ticked, flagged, onToggle }: { line: LoadingLine; words: string; ticked: boolean; flagged: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" role="checkbox" aria-checked={ticked} onClick={onToggle} className="flex w-full items-center gap-3.5 rounded-lg py-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <TickBox ticked={ticked} />
        <span className={cn('min-w-0 flex-1 text-lg leading-6', ticked ? 'text-muted-foreground' : 'font-semibold')}>{words}</span>
        {flagged && line.short > 0 && <Tag tone="bad" className="h-[26px] text-[13px]">{whole(line.short)} short</Tag>}
      </button>
    </li>
  );
}

// Every stop is on: the count on the truck.
function AllOn({ truck }: { truck: LoadingTruck }) {
  return (
    <>
      <Label>All stops loaded</Label>
      <h2 className="mt-[15px] text-2xl leading-8 font-bold">{allOnLine(truck)}</h2>
    </>
  );
}

// A trip whose vehicle is still out on an earlier one says so at the top of its page (Q-26): it can be started, and its
// goods go ready on the dock until the vehicle is back. The trip and the time come from the API.
function OutOnLine({ truck }: { truck: LoadingTruck }) {
  const line = outOnLine(truck);
  if (!line) return null;
  return <p role="status" className="mb-3 rounded-[10px] bg-warn-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-warn-ink">{line}</p>;
}

// An answer from the dispatcher, with the dispatcher's picture: who and when, then what to do.
function Answer({ issue }: { issue: Issue }) {
  return (
    <div className="mt-4 rounded-[12px] bg-muted px-4 pt-3 pb-4">
      <p className="flex items-center gap-2 text-[13px] leading-5 font-semibold">
        <img src={DISPATCHER_ICON} alt="" className="size-5 object-contain" />
        {answeredBy(issue)}
      </p>
      <p className="mt-[7px] text-[15px] leading-[21px]">{answerSentence(issue)}</p>
    </div>
  );
}

// Loader · Truck ready: a green tick and what went on, then the way back and the rest of the day's trucks, beside it
// from 1024 px and under it on a phone.
function ReadyTruck({ day, truck, stale }: { day: LoadingDay; truck: LoadingTruck; stale: ReactNode }) {
  const navigate = useNavigate();
  const others = day.trucks.filter((t) => t.tripId !== truck.tripId);
  const note = readyNote(truck);
  return (
    <div className="lg:pt-1">
      {stale && <div className="mb-3">{stale}</div>}
      <OutOnLine truck={truck} />
      <div className="grid grid-cols-1 gap-y-4 lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:gap-x-6">
        <Card className="px-5 pt-5 pb-6 lg:self-start lg:px-7 lg:pt-[22px] lg:pb-8">
          <div className="flex items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-good text-card lg:size-12">
              {/* The design draws a plain tick here, so it is the outline set's. */}
              <Check className="size-6 stroke-[3] lg:size-7" aria-hidden="true" />
            </span>
            <h1 className="text-2xl leading-8 font-bold lg:text-[30px] lg:leading-9">{truckName(truck)} is ready</h1>
          </div>
          <p className="mt-4 text-[15px] leading-5 text-muted-foreground lg:mt-3">{readyLine(truck)}</p>
          {note && <p className="mt-3 text-[15px] leading-5">{note}</p>}
        </Card>
        <div className="flex flex-col gap-y-4 lg:min-h-[calc(100dvh-115px)]">
          <NextList trucks={others} from={2} className="order-2 lg:order-1 lg:-mt-1.5" />
          <Button className={orangeButton(cn(BIG, 'order-1 lg:order-2 lg:mt-auto'))} onClick={() => navigate('/loader')}>Back to trucks</Button>
        </div>
      </div>
    </div>
  );
}

function TruckSkeleton() {
  return (
    <div role="status" aria-label="Loading the truck">
      <Skeleton className="h-4 w-20 rounded-full" />
      <div className="mt-5 grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:gap-x-6">
        <Card className="px-5 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12" />
            <div className="flex-1 space-y-2.5">
              <Skeleton className="h-5 w-1/2 rounded-full" />
              <Skeleton soft className="h-3 w-2/3 rounded-full" />
            </div>
          </div>
          <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
          <Skeleton soft className="mt-3 h-3.5 w-1/2 rounded-full" />
        </Card>
        <Card className="px-5 py-4">
          <Skeleton soft className="h-3 w-28 rounded-full" />
          <Skeleton className="mt-4 h-6 w-1/2 rounded-full" />
          {[0, 1].map((i) => (
            <div key={i} className="mt-6 flex items-center gap-3.5">
              <Skeleton soft className="size-[34px] rounded-[9px]" />
              <Skeleton className="h-4 w-1/2 rounded-full" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// "See what changed", when this tablet holds a comparison that Got it has not closed.
function ChangesLink({ className }: { className?: string }) {
  const { kept } = usePlanChanges();
  if (!kept?.changes || kept.closed) return null;
  return (
    <Link to="/loader/changes" className={plainButton(cn('h-10 w-fit rounded-[12px] px-4 text-[13px]', className))}>{SEE_CHANGES}</Link>
  );
}
