import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Navigate, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import { FLAG_REASONS, type FlagReason, type LoadingLine, type LoadingStop, type LoadingTruck } from '@wayfinder/contracts';
import { StaleNotice } from '@/features/store/parts/LoadError';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLogout } from '@/features/auth/api';
import { orangeButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { DiscardDraft, hasFormEdits } from '@/lib/dirty-form';
import { flagCounts, wholeCount } from './count';
import { useLoadingDay, useLoaderWrites, type LoaderWrites } from './loading';
import { GOODS_ICON } from './parts/icons';
import { BackLink } from './parts/LoadCard';
import { LoadFailed, TruckGone } from './parts/LoadFailed';
import { ActionBar, Card, LeaveUnsent, NotSaved, Refused, SendingFirst, TickBox } from './parts/ui';
import { useTicks } from './ticks';
import { asksBeforeLeaving, useAsksBeforeSignOut } from './unsent';
import { brandOfStop, countHint, countLine, countWhere, leaves, lineKind, lineWords, truckName, whole } from './words';

// "Won't fit" is a truck that cannot take all of a line (Q-20).
const REASON: Record<FlagReason, string> = { short: 'Short', damaged: 'Damaged', wrong_item: 'Wrong item', wont_fit: 'Won\'t fit' };

// Flag a problem at /loader/trucks/:tripId/flag?stop= (spec 012, Loader · Flag a problem and · phone): the stop's
// lines with their count at the dock, what is wrong, the picked line's counter and a note, sent to the dispatcher.
export function FlagPage() {
  const { tripId = '' } = useParams();
  const [params] = useSearchParams();
  const stopId = params.get('stop') ?? '';
  // A form and its write belong to one stop of one truck.
  return <FlagScreen key={`${tripId}:${stopId}`} tripId={tripId} stopId={stopId} />;
}

function FlagScreen({ tripId, stopId }: { tripId: string; stopId: string }) {
  const query = useLoadingDay();
  const writes = useLoaderWrites();

  if (!query.data) {
    return query.isError
      ? <LoadFailed what="the trucks" error={query.error} busy={query.isFetching} onRetry={() => { void query.refetch(); }} />
      : <FlagSkeleton />;
  }
  const truck = query.data.trucks.find((t) => t.tripId === tripId);
  // A truck its driver drove away says who and when (Q-34); any other left the plan.
  if (!truck) return <TruckGone day={query.data} tripId={tripId} />;
  const stop = truck.stops.find((s) => s.id === stopId);
  // A flag is raised while the truck loads, on one of its stops. Anything else goes back to the truck.
  if (!stop || truck.status !== 'loading') return <Navigate to={`/loader/trucks/${truck.tripId}`} replace />;
  const stale = query.isError ? <StaleNotice busy={query.isFetching} onRetry={() => { void query.refetch(); }} /> : null;
  return <FlagForm truck={truck} stop={stop} writes={writes} stale={stale} />;
}

function FlagForm({ truck, stop, writes, stale }: { truck: LoadingTruck; stop: LoadingStop; writes: LoaderWrites; stale: ReactNode }) {
  const navigate = useNavigate();
  const ticks = useTicks(truck.tripId);
  const brand = brandOfStop(truck, stop);
  // The form keeps what was entered in the page, so a refusal or a fetch of the day leaves it as it was.
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState<FlagReason>('short');
  const [counts, setCounts] = useState<Record<string, number>>({});
  // What a count box holds while it is not the count the form holds: what is being typed, and a wrong number, which
  // stays as it was typed (Q-17).
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  // A line is flagged once while its truck loads (rule 6), so a line on a problem already cannot be picked.
  const flagged = new Set(truck.issues.flatMap((issue) => issue.lines.map((line) => line.lineId)));
  const tally = flagCounts(stop.lines, flagged, counts, typed);
  const line = stop.lines.find((l) => l.lineId === picked && !flagged.has(l.lineId)) ?? null;
  const busy = writes.phase !== 'idle';
  const completed = useRef(false);
  const dirty = hasFormEdits({ counts, typed, note, reason });
  const holding = () => !completed.current && (dirty || writes.holding('flag'));

  // − and + step from the count the form holds, and what was typed in the box goes. A whole number from 0 to the line's
  // count is its count; anything else stays in the box as typed. Leaving the box shows its count, "054" as 54, and a
  // wrong number stays.
  const without = (held: Record<string, string>, lineId: string) => Object.fromEntries(Object.entries(held).filter(([id]) => id !== lineId));
  const box = {
    step: (l: LoadingLine, value: number) => {
      setCounts((held) => ({ ...held, [l.lineId]: value }));
      setTyped((held) => without(held, l.lineId));
    },
    type: (l: LoadingLine, text: string) => {
      setTyped((held) => ({ ...held, [l.lineId]: text }));
      const count = wholeCount(text, l.quantity);
      if (count !== null) setCounts((held) => ({ ...held, [l.lineId]: count }));
    },
    leave: (l: LoadingLine) => setTyped((held) => (held[l.lineId] !== undefined && wholeCount(held[l.lineId]!, l.quantity) !== null ? without(held, l.lineId) : held)),
  };

  const send = () => writes.send(truck.tripId, {
    kind: 'flag',
    body: { revision: truck.revision, stopId: stop.id, reason, lines: tally.lowered.map((l) => ({ lineId: l.lineId, counted: tally.countAt(l) })), note: note.trim() },
  }, () => { completed.current = true; navigate(`/loader/trucks/${truck.tripId}`); });

  const sendButton = (
    <Button className={orangeButton('h-16 w-full rounded-[12px] text-lg')} disabled={busy || !tally.canSend} focusableWhenDisabled onClick={send}>
      {writes.out === 'flag' && writes.phase === 'saving' ? 'Sending…' : 'Send to dispatcher'}
    </Button>
  );

  // A flag on its way or not sent keeps the loader on the form until it is sent, or until they choose to leave without
  // it (Q-22): by the back link, the bell, the browser's back, or closing or reloading the tab. Once the flag is sent the
  // form goes on to the truck as before, and a flag the server refused lets them go, as the refusal says why.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => asksBeforeLeaving(holding(), currentLocation, nextLocation));
  const unsent = writes.out === 'flag' && writes.phase !== 'idle';
  // Sign out asks the same way, as signing out would take the form and its flag with it.
  const logout = useLogout();
  useEffect(() => { if (logout.isError) completed.current = false; }, [logout.isError]);
  const [signOutAsked, setSignOutAsked] = useState(false);
  useAsksBeforeSignOut(holding, () => setSignOutAsked(true));
  useEffect(() => {
    if (blocker.state === 'blocked' && !unsent && !dirty) blocker.reset();
  }, [blocker, unsent, dirty]);
  useEffect(() => {
    if (!unsent && !dirty) return;
    const ask = (event: BeforeUnloadEvent) => { if (!completed.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [unsent, dirty]);
  const leaving = blocker.state === 'blocked' ? blocker : null;

  return (
    <div>
      <DiscardDraft open={!unsent && (signOutAsked || leaving !== null)} name="problem report" signingOut={signOutAsked}
        onKeep={() => { setSignOutAsked(false); leaving?.reset(); }}
        onDiscard={() => {
          completed.current = true;
          if (signOutAsked) { setSignOutAsked(false); logout.signOutAnyway(); }
          else leaving?.proceed();
        }} />
      <BackLink to={`/loader/trucks/${truck.tripId}`}>{truckName(truck)}</BackLink>
      <div className="mt-2.5 lg:mt-3.5">
        {stale}
        {writes.refused && <Refused>{writes.refused}</Refused>}
        {signOutAsked && unsent ? (
          <LeaveUnsent signingOut onRetry={() => { setSignOutAsked(false); writes.retry(); }} onLeave={() => { completed.current = true; setSignOutAsked(false); logout.signOutAnyway(); }} />
        ) : (
          <>
            {leaving && writes.phase === 'unsaved' && <LeaveUnsent onRetry={() => { leaving.reset(); writes.retry(); }} onLeave={() => leaving.proceed()} />}
            {leaving && writes.phase === 'saving' && <SendingFirst />}
            {!leaving && writes.phase === 'unsaved' && <NotSaved onRetry={writes.retry} />}
          </>
        )}
      </div>
      <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,680fr)_minmax(0,420fr)] lg:items-start lg:gap-x-6">
        <Card className="px-4 pt-4 pb-3 lg:px-5 lg:pt-[19px]">
          <h1 className="text-[22px] leading-7 font-bold">Stop {stop.seq} · {stop.shopName}</h1>
          <p className="mt-3 text-[13px] leading-4 text-muted-foreground">{truckName(truck)} · {leaves(truck)}</p>
          <ul className="mt-[3px]">
            {stop.lines.map((l) => {
              // A flagged line shows what goes out; a line whose box holds a wrong number shows what was typed, in red.
              const shown = flagged.has(l.lineId) ? { count: whole(l.going), wrong: false } : tally.shownOf(l);
              const lower = shown.wrong || tally.countAt(l) < l.quantity;
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
                    <span className={cn('shrink-0 font-mono text-base leading-6 font-bold whitespace-nowrap', flagged.has(l.lineId) ? '' : lower ? 'text-bad' : 'text-good')}>
                      {shown.count} / {whole(l.quantity)}
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
              where={countWhere(reason)}
              value={tally.countAt(line)}
              text={typed[line.lineId]}
              disabled={busy}
              onStep={(value) => box.step(line, value)}
              onType={(text) => box.type(line, text)}
              onLeave={() => box.leave(line)}
            />
          ) : (
            <p className="mt-3.5 rounded-[12px] bg-muted px-4 py-[18px] text-[15px] leading-5 text-muted-foreground">{countHint(reason)}</p>
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

// "Short", "Damaged", "Wrong item" and "Won't fit" (Q-20), one of them chosen, as the design's joined switch.
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

// The picked line's counter: its picture and name, where it counts ("at the dock", or "fit on the truck" for a truck
// that cannot take it all, Q-20), and − the count /quantity +. The count runs from 0 to the line's quantity, and can be
// typed as well. The box keeps what is typed as it is: a minus, a fraction or more than the line holds is never turned
// into another number. It is marked red with the fix under it, as the shop's quantity box is, and Send, − and + wait
// until it is a whole number from 0 to the line's count (Q-17). The fix is the card's last child, so it takes a row of
// its own under the counter.
export function Counter({ line, kind, where, value, text, disabled, onStep, onType, onLeave }: {
  line: LoadingLine; kind: string; where: string; value: number; text: string | undefined; disabled: boolean;
  onStep: (value: number) => void; onType: (text: string) => void; onLeave: () => void;
}) {
  const fix = useId();
  const wrong = text !== undefined && wholeCount(text, line.quantity) === null;
  const shown = text ?? String(value);
  const off = disabled || wrong;
  const step = (by: number) => onStep(Math.min(line.quantity, Math.max(0, value + by)));
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-muted py-4 pr-4 pl-4 lg:pl-5">
      <img src={GOODS_ICON[line.temp]} alt="" className="size-10 shrink-0 object-contain" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg leading-6 font-semibold">{kind}</p>
        <p className="mt-0.5 text-[13px] leading-4 text-muted-foreground">{where}</p>
      </div>
      <div role="group" className="flex items-center">
        <button type="button" aria-label={`One less: ${kind}`} disabled={off || value <= 0} className={STEP} onClick={() => step(-1)}>−</button>
        <span className="flex items-baseline px-2.5">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${kind} ${where}`}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? fix : undefined}
            value={shown}
            disabled={disabled}
            onChange={(event) => onType(event.currentTarget.value)}
            onBlur={onLeave}
            // A tap selects the count, so typing replaces it.
            onClick={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              if (!wrong) step(event.key === 'ArrowUp' ? 1 : -1);
            }}
            // A longer text than three figures widens the box, so all of it shows.
            style={shown.length > 3 ? { width: `${shown.length + 1}ch` } : undefined}
            className={cn(
              'min-w-0 rounded-md bg-transparent p-0 text-right font-heading text-[26px] leading-8 font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-foreground',
              shown.length > 2 ? 'w-[52px]' : shown.length > 1 ? 'w-[34px]' : 'w-[18px]',
              wrong && 'text-bad ring-1 ring-bad focus-visible:ring-bad',
            )}
          />
          <span className="ml-1.5 text-base leading-5 text-muted-foreground">/{whole(line.quantity)}</span>
        </span>
        <button type="button" aria-label={`One more: ${kind}`} disabled={off || value >= line.quantity} className={STEP} onClick={() => step(1)}>+</button>
      </div>
      {wrong && <p id={fix} role="alert" className="basis-full text-right text-[13px] leading-4 font-semibold text-bad">{countLine(line.quantity)}</p>}
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
