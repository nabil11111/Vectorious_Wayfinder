import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { REFUSAL_REASONS, type DriverLine, type Me, type RefusalReason } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { newWriteId } from '@/features/loader/loading';
import { useAppClock } from '@/lib/clock';
import { UNUSABLE, usePhoto } from '@/lib/phone/photo';
import { PhotoInput, PhotoTile } from '@/lib/phone/PhotoTile';
import { hasSignal } from '@/lib/phone/signal';
import { cn } from '@/lib/utils';
import { Counter } from './parts/Counter';
import { GOODS, ICON } from './parts/icons';
import { TopArea } from './parts/TopArea';
import { ActionBar, BIG, Card, PLAIN, Problem, StopHead } from './parts/ui';
import { useSave } from './queue';
import { NO_PAIR, refusalPair, type Pair, type PairBox } from './tally';
import { useDriverView } from './view';
import {
  aboutStop, brandOf, clockTime, entranceOf, lineKindLine, NOT_SAVED, pickLine, REASON_WORDS, stayLine, stopOfLine, waitedLine, wholeCountsLine,
} from './words';

// Driver · Something's wrong · refused and · shop closed at /driver/wrong?stop= (spec 013, rules 5 and 6). The shop
// refused some: the lines it refused and how many, why, and a photo and a note if the driver wants. The shop is
// closed: since when and how long the driver waited, a photo and a note, and what stays on the truck. Either is saved
// on the phone first and goes to the dispatcher.
export function WrongPage({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const stopId = params.get('stop') ?? '';
  // A form belongs to one stop.
  return <Wrong key={stopId} me={me} stopId={stopId} />;
}

type Kind = 'refused' | 'closed';

// The frames' choice chips: ink when chosen, white with a thin line when not.
function Chip({ on, onClick, disabled = false, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-[27px] shrink-0 rounded-full px-[11px] text-[13px] leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:text-muted-foreground/60',
        on ? 'bg-secondary text-secondary-foreground' : 'border bg-card',
      )}
    >
      {children}
    </button>
  );
}

function Wrong({ me, stopId }: { me: Me; stopId: string }) {
  const view = useDriverView(me.id);
  const navigate = useNavigate();
  const { at, readNow } = useAppClock();
  const { save, saving, failed } = useSave();
  const { photo, unusable, reading, take, inputRef, pick } = usePhoto();
  const [kind, setKind] = useState<Kind>('refused');
  // The lines picked, and how many of each the shop refused with what each box holds: the form's own pair, never a
  // figure the phone keeps.
  const [picked, setPicked] = useState<string[]>([]);
  const [pair, setPair] = useState<Pair>(NO_PAIR);
  const [reason, setReason] = useState<RefusalReason | null>(null);
  const [note, setNote] = useState('');
  const [leaving, setLeaving] = useState(false);

  if (!view.ready) return null;
  const { trip, figures } = view;
  const stop = trip?.stops.find((s) => s.id === stopId);
  if (!trip || !stop || !figures) return <Navigate to="/driver" replace />;
  if (!leaving && (trip.status !== 'out' || stop.arrivedAt === null || stop.outcome !== null)) return <Navigate to="/driver" replace />;
  const counts = figures.byStop[trip.stops.indexOf(stop)]!;
  const brand = brandOf(trip, stop);
  const loadedOf = (line: DriverLine) => counts.byLine[stop.lines.indexOf(line)]!.loaded;
  const refusedOf = (line: DriverLine) => refusalPair.refusedOf(pair, line.lineId);
  const isWrong = (line: DriverLine, box: PairBox) => refusalPair.isWrong(pair, line.lineId, box, loadedOf(line));
  const shown = stop.lines.filter((line) => picked.includes(line.lineId));
  // A box that holds something that is not a count keeps "Save partial delivery" off until it is fixed (Q-25).
  const anyWrong = shown.some((line) => isWrong(line, 'accepted') || isWrong(line, 'refused'));
  const chosen = shown.filter((line) => refusedOf(line) > 0);
  const canSave = kind === 'closed' || (chosen.length > 0 && reason !== null && !anyWrong);

  const toggle = (line: DriverLine) => {
    if (picked.includes(line.lineId)) setPair((held) => refusalPair.drop(held, line.lineId));
    setPicked((held) => (held.includes(line.lineId) ? held.filter((id) => id !== line.lineId) : [...held, line.lineId]));
  };

  // Not while a photo is being read: the one before it, or none, would be saved instead. At the app clock's time at
  // the press.
  const submit = async () => {
    const now = readNow();
    if (now === null || !canSave || reading) return;
    const base = { writeId: newWriteId(), tripId: trip.tripId, stopId: stop.id, at: new Date(now).toISOString(), revision: stop.revision, note: note.trim(), ...(photo ? { photo } : {}) };
    setLeaving(true);
    const saved = kind === 'refused' && reason !== null
      ? await save({ ...base, kind: 'refuse', reason, lines: chosen.map((line) => ({ lineId: line.lineId, refused: refusedOf(line) })) }, aboutStop(stop))
      : await save({ ...base, kind: 'closed' }, aboutStop(stop));
    if (!saved) {
      setLeaving(false);
      return;
    }
    navigate(hasSignal() ? '/driver' : `/driver/saved?stop=${stop.id}`, { replace: true });
  };

  return (
    <div>
      <TopArea waitingRecords={view.waitingRecords} />
      {failed && <Problem>{NOT_SAVED}</Problem>}
      {unusable && <Problem>{UNUSABLE}</Problem>}
      <StopHead stopLine={stopOfLine(stop, figures)} stop={stop} brand={brand} sub={entranceOf(stop)} />

      <h2 className="mt-[13px] text-[17px] leading-[22px] font-bold">{"What's wrong?"}</h2>
      <div role="group" aria-label="What's wrong?" className="mt-3 flex flex-wrap gap-2">
        <Chip on={kind === 'refused'} disabled={saving} onClick={() => setKind('refused')}>Shop refused some</Chip>
        <Chip on={kind === 'closed'} disabled={saving} onClick={() => setKind('closed')}>Shop closed</Chip>
      </div>

      {kind === 'refused' ? (
        <>
          <div role="group" aria-label="The lines the shop refused" className="mt-3 flex flex-wrap gap-2">
            {stop.lines.map((line) => (
              <Chip key={line.lineId} on={picked.includes(line.lineId)} disabled={saving || loadedOf(line) === 0} onClick={() => toggle(line)}>
                {pickLine(line, counts.byLine[stop.lines.indexOf(line)]!, brand)}
              </Chip>
            ))}
          </div>
          {shown.map((line) => {
            const loaded = loadedOf(line);
            const kindWord = lineKindLine(line, brand);
            const box = (which: PairBox, title: string, icon: string, value: number) => {
              const fix = isWrong(line, which) ? `fix-${line.lineId}-${which}` : undefined;
              return (
                <CounterCard icon={icon} title={title} sub={kindWord} fix={fix && <p id={fix} role="alert" className="mt-2.5 text-[13px] leading-4 font-semibold text-bad">{wholeCountsLine(loaded)}</p>}>
                  <Counter
                    label={`${title} ${kindWord}`}
                    value={value}
                    text={refusalPair.textOf(pair, line.lineId, which)}
                    max={loaded}
                    of={loaded}
                    invalid={fix}
                    disabled={saving}
                    onStep={(n) => setPair((held) => refusalPair.step(held, line.lineId, which, n, loaded))}
                    onType={(text) => setPair((held) => refusalPair.type(held, line.lineId, which, text, loaded))}
                    onLeave={() => setPair((held) => refusalPair.leave(held, line.lineId, which, loaded))}
                  />
                </CounterCard>
              );
            };
            return (
              <div key={line.lineId} className="mt-2.5 space-y-2.5">
                {box('accepted', 'Accepted', GOODS[line.temp], loaded - refusedOf(line))}
                {box('refused', 'Refused', ICON.damaged, refusedOf(line))}
              </div>
            );
          })}
          <div role="group" aria-label="Why" className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[13px] leading-none font-semibold text-muted-foreground">Why</span>
            {REFUSAL_REASONS.map((why) => (
              <Chip key={why} on={reason === why} disabled={saving} onClick={() => setReason(why)}>{REASON_WORDS[why]}</Chip>
            ))}
          </div>
        </>
      ) : (
        <Card className="mt-3 space-y-[9px] px-3.5 py-3.5 text-[13px] leading-4">
          <p className="flex justify-between gap-3"><span className="font-semibold">Nobody at the shop</span><span className="text-muted-foreground">since {stop.arrivedAt ? clockTime(stop.arrivedAt) : ''}</span></p>
          <p className="flex justify-between gap-3"><span>Waited</span><span className="text-muted-foreground">{stop.arrivedAt ? waitedLine(stop.arrivedAt, at) : ''}</span></p>
        </Card>
      )}

      <div className="mt-2.5 flex gap-2.5">
        <PhotoTile photo={photo} reading={reading} disabled={saving || reading} onTake={take} />
        <label className="min-w-0 flex-1">
          <span className="sr-only">What happened?</span>
          <textarea
            value={note}
            maxLength={200}
            rows={2}
            disabled={saving}
            placeholder="What happened? (optional)"
            onChange={(event) => setNote(event.target.value)}
            className="block h-[52px] w-full resize-none rounded-[10px] border bg-card px-3 py-2.5 text-[13px] leading-4 outline-none placeholder:text-muted-foreground focus-visible:border-foreground"
          />
        </label>
      </div>
      <PhotoInput inputRef={inputRef} onPick={pick} />

      {kind === 'closed' && (
        <Card className="mt-2.5 flex items-center gap-2.5 px-3.5 py-3">
          <img src={ICON.cartons} alt="" className="size-5 shrink-0 object-contain" />
          <p className="text-sm leading-[18px] font-semibold">{stayLine(brand, counts)}</p>
        </Card>
      )}

      <ActionBar>
        <Button className={BIG()} disabled={!canSave || saving || reading || at === null} focusableWhenDisabled onClick={() => { void submit(); }}>
          {saving ? 'Saving…' : kind === 'refused' ? 'Save partial delivery' : 'Save attempt and move on'}
        </Button>
        <Button variant="outline" className={PLAIN()} disabled={saving} onClick={() => navigate('/driver')}>Back to unload</Button>
      </ActionBar>
    </div>
  );
}

// An "Accepted" or "Refused" card: the goods' picture, what it counts, and its counter, with the line that says what is
// wrong with its box under them.
function CounterCard({ icon, title, sub, fix, children }: { icon: string; title: string; sub: string; fix?: ReactNode; children: ReactNode }) {
  return (
    <Card className="px-4 py-4">
      <div className="flex items-center gap-3">
        <img src={icon} alt="" className="size-9 shrink-0 object-contain" />
        <span className="min-w-0 flex-1">
          <span className="block font-heading text-lg leading-[22px] font-bold">{title}</span>
          <span className="block text-xs leading-4 text-muted-foreground">{sub}</span>
        </span>
        {children}
      </div>
      {fix}
    </Card>
  );
}
