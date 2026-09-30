import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { NumberField } from '@base-ui/react/number-field';
import { FLAG_REASONS, type FlagReason, type LoadingLine, type LoadingStop, type LoadingTruck } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { orangeButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { useLoadingDay, useLoaderWrites, type LoaderWrites } from './loading';
import { GOODS_ICON } from './parts/icons';
import { BackLink } from './parts/LoadCard';
import { LoadFailed, NotOnList } from './parts/LoadFailed';
import { ActionBar, Card, NotSaved, Refused, TickBox } from './parts/ui';
import { useTicks } from './ticks';
import { brandOfStop, leaves, lineKind, lineWords, truckName, whole } from './words';

const REASON: Record<FlagReason, string> = { short: 'Short', damaged: 'Damaged', wrong_item: 'Wrong item' };

// Flag a problem at /loader/trucks/:tripId/flag?stop= (spec 012, Loader · Flag a problem and · phone): the stop's
// lines with their count at the dock, what is wrong, the picked line's counter and a note, sent to the dispatcher.
export function FlagPage() {
  const { tripId = '' } = useParams();
  const [params] = useSearchParams();
  const query = useLoadingDay();
  const writes = useLoaderWrites();

  if (!query.data) {
    return query.isError
      ? <LoadFailed what="the trucks" error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} />
      : <FlagSkeleton />;
  }
  const truck = query.data.trucks.find((t) => t.tripId === tripId);
  if (!truck) return <NotOnList />;
  const stop = truck.stops.find((s) => s.id === params.get('stop'));
  // A flag is raised while the truck loads, on one of its stops. Anything else goes back to the truck.
  if (!stop || truck.status !== 'loading') return <Navigate to={`/loader/trucks/${truck.tripId}`} replace />;
  return <FlagForm truck={truck} stop={stop} writes={writes} />;
}

function FlagForm({ truck, stop, writes }: { truck: LoadingTruck; stop: LoadingStop; writes: LoaderWrites }) {
  const navigate = useNavigate();
  const ticks = useTicks(truck.tripId);
  const brand = brandOfStop(truck, stop);
  // The form keeps what was entered in the page, so a refusal or a fetch of the day leaves it as it was.
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState<FlagReason>('short');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  // A line is flagged once while its truck loads (rule 6), so a line on a problem already cannot be picked.
  const flagged = new Set(truck.issues.flatMap((issue) => issue.lines.map((line) => line.lineId)));
  const countAt = (line: LoadingLine) => counts[line.lineId] ?? line.quantity;
  const lowered = stop.lines.filter((line) => !flagged.has(line.lineId) && countAt(line) < line.quantity);
  const line = stop.lines.find((l) => l.lineId === picked && !flagged.has(l.lineId)) ?? null;
  const busy = writes.phase !== 'idle';

  const send = () => writes.send(truck.tripId, {
    kind: 'flag',
    body: { revision: truck.revision, stopId: stop.id, reason, lines: lowered.map((l) => ({ lineId: l.lineId, counted: countAt(l) })), note: note.trim() },
  }, () => navigate(`/loader/trucks/${truck.tripId}`));

  const sendButton = (
    <Button className={orangeButton('h-16 w-full rounded-[12px] text-lg')} disabled={busy || lowered.length === 0} focusableWhenDisabled onClick={send}>
      {writes.out === 'flag' && writes.phase === 'saving' ? 'Sending…' : 'Send to dispatcher'}
    </Button>
  );

  return (
    <div>
      <BackLink to={`/loader/trucks/${truck.tripId}`}>{truckName(truck)}</BackLink>
      <div className="mt-2.5 lg:mt-3.5">
        {writes.refused && <Refused>{writes.refused}</Refused>}
        {writes.phase === 'unsaved' && <NotSaved onRetry={writes.retry} />}
      </div>
      <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:items-start lg:gap-x-6">
        <Card className="px-4 pt-4 pb-3 lg:px-5 lg:pt-[19px]">
          <h1 className="text-[22px] leading-7 font-bold">Stop {stop.seq} · {stop.shopName}</h1>
          <p className="mt-3 text-[13px] leading-4 text-muted-foreground">{truckName(truck)} · {leaves(truck)}</p>
          <ul className="mt-[3px]">
            {stop.lines.map((l) => {
              const count = flagged.has(l.lineId) ? l.going : countAt(l);
              return (
                <li key={l.lineId}>
                  <button
                    type="button"
                    aria-pressed={picked === l.lineId}
                    disabled={flagged.has(l.lineId) || busy}
                    onClick={() => setPicked(l.lineId)}
                    className={cn(
                      '-mx-2.5 flex w-[calc(100%+20px)] items-center gap-3.5 rounded-[12px] px-2.5 py-[13px] text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      picked === l.lineId && 'ring-2 ring-foreground',
                      flagged.has(l.lineId) && 'text-muted-foreground/65',
                    )}
                  >
                    <TickBox ticked={ticks.isTicked(l.lineId)} className={cn(flagged.has(l.lineId) && 'opacity-50')} />
                    <span className="min-w-0 flex-1 text-[17px] leading-6">{lineWords(l, brand)}</span>
                    <span className={cn('shrink-0 font-mono text-base leading-6 font-bold whitespace-nowrap', flagged.has(l.lineId) ? '' : count < l.quantity ? 'text-bad' : 'text-good')}>
                      {whole(count)} / {whole(l.quantity)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="flex flex-col px-4 pt-4 pb-5 lg:min-h-[calc(100dvh-149px)] lg:px-5 lg:pt-[19px]">
          <h2 className="text-[22px] leading-7 font-bold">What’s wrong?</h2>
          <Reasons value={reason} onChange={setReason} disabled={busy} />
          {line ? (
            <Counter
              key={line.lineId}
              line={line}
              kind={lineKind(line, brand)}
              value={countAt(line)}
              disabled={busy}
              onChange={(value) => setCounts((held) => ({ ...held, [line.lineId]: value }))}
            />
          ) : (
            <p className="mt-3.5 rounded-[12px] bg-muted px-4 py-[18px] text-[15px] leading-5 text-muted-foreground">Tap the line that is not right, then count what is at the dock.</p>
          )}
          <label className="mt-3.5 block">
            <span className="sr-only">What happened?</span>
            <textarea
              value={note}
              maxLength={200}
              rows={3}
              disabled={busy}
              placeholder="What happened? (optional)"
              onChange={(event) => setNote(event.target.value)}
              className="block min-h-[82px] w-full resize-none rounded-[12px] border bg-card px-4 py-3.5 text-[15px] leading-5 outline-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-0"
            />
          </label>
          <div className="mt-auto hidden pt-6 lg:block">{sendButton}</div>
        </Card>
      </div>
      <ActionBar>{sendButton}</ActionBar>
    </div>
  );
}

// "Short", "Damaged" and "Wrong item", one of them chosen, as the design's joined switch.
function Reasons({ value, onChange, disabled }: { value: FlagReason; onChange: (reason: FlagReason) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label="What’s wrong?" className="mt-4 inline-flex self-start overflow-hidden rounded-full border bg-card">
      {FLAG_REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          role="radio"
          aria-checked={reason === value}
          disabled={disabled}
          onClick={() => onChange(reason)}
          className={cn(
            'h-[26px] px-3 text-xs leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
            reason === value ? 'bg-secondary text-secondary-foreground' : 'text-foreground',
          )}
        >
          {REASON[reason]}
        </button>
      ))}
    </div>
  );
}

const STEP = 'flex size-[42px] shrink-0 items-center justify-center rounded-[10px] border bg-card text-[22px] leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:text-muted-foreground/65 lg:size-[46px]';

// The picked line's counter: its picture and name, "at the dock", and − the count /quantity +. It runs from 0 to the
// line's quantity, and the number can be typed as well.
function Counter({ line, kind, value, disabled, onChange }: { line: LoadingLine; kind: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <div className="mt-3.5 flex items-center gap-3 rounded-[12px] bg-muted py-4 pr-4 pl-4 lg:pl-5">
      <img src={GOODS_ICON[line.temp]} alt="" className="size-10 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg leading-6 font-semibold">{kind}</p>
        <p className="mt-0.5 text-[13px] leading-4 text-muted-foreground">at the dock</p>
      </div>
      <NumberField.Root
        value={value}
        min={0}
        max={line.quantity}
        disabled={disabled}
        locale="en-GB"
        format={{ maximumFractionDigits: 0, useGrouping: false }}
        onValueChange={(next) => onChange(Math.min(line.quantity, Math.max(0, Math.round(next ?? 0))))}
      >
        <NumberField.Group className="flex items-center">
          <NumberField.Decrement aria-label={`One less: ${kind}`} className={STEP}>−</NumberField.Decrement>
          <span className="flex items-baseline px-2.5">
            <NumberField.Input
              aria-label={`${kind} at the dock`}
              maxLength={3}
              onClick={(event) => event.currentTarget.select()}
              className={cn('min-w-0 bg-transparent p-0 text-right font-heading text-[26px] leading-8 font-bold tabular-nums outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-foreground', value > 99 ? 'w-[52px]' : value > 9 ? 'w-[34px]' : 'w-[18px]')}
            />
            <span className="ml-1.5 text-base leading-5 text-muted-foreground">/{whole(line.quantity)}</span>
          </span>
          <NumberField.Increment aria-label={`One more: ${kind}`} className={STEP}>+</NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </div>
  );
}

function FlagSkeleton() {
  return (
    <div role="status" aria-label="Loading the stop">
      <Skeleton className="h-4 w-20 rounded-full" />
      <div className="mt-5 grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:gap-x-6">
        <Card className="px-5 py-4">
          <Skeleton className="h-5 w-3/5 rounded-full" />
          <Skeleton soft className="mt-3 h-3 w-2/5 rounded-full" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="mt-5 flex items-center gap-3.5">
              <Skeleton soft className="size-[34px] rounded-[9px]" />
              <Skeleton className="h-4 w-1/2 rounded-full" />
            </div>
          ))}
        </Card>
        <Card className="px-5 py-4">
          <Skeleton className="h-5 w-2/5 rounded-full" />
          <Skeleton soft className="mt-4 h-[26px] w-48 rounded-full" />
          <Skeleton soft className="mt-4 h-[78px] w-full rounded-[12px]" />
        </Card>
      </div>
    </div>
  );
}
