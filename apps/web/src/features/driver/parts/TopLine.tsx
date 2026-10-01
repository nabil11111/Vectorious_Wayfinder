import type { DriverDay, DriverProblem, DriverStop, DriverTrip } from '@wayfinder/contracts';
import { Check } from 'lucide-react';
import { useSignal } from '@/lib/phone/signal';
import { cn } from '@/lib/utils';
import { closeBackOnline, useSync, type Queued } from '../queue';
import {
  answerLine, backOnlineLines, brandOf, closedLine, DEPOT_DECIDES, deliveredLine, keepLine, noSignalLine, refusedLine, whole,
  type Figures,
} from '../words';
import { ICON } from './icons';
import { Band } from './ui';

// The lines under the top bar (spec 013, rule 12 and the screen states' top line): the yellow "No signal" bar in place
// of the top line on Next stop, the green "Back online" in its place until it is closed, and otherwise the top line,
// the trip's latest problem or else the last stop done. An answer from the dispatcher shows under "Back online" at
// once, so the driver never has to close the bar to read it.
export function TopLines({ day, trip, figures, waiting, waitingRecords, noSignalBar }: {
  day: DriverDay; trip: DriverTrip; figures: Figures; waiting: Queued[]; waitingRecords: number; noSignalBar: boolean;
}) {
  const signal = useSignal();
  const { backOnline } = useSync();
  if (noSignalBar && !signal) return <NoSignal waiting={waitingRecords} />;
  const answered = latestProblem(trip)?.problem.decision != null;
  return (
    <>
      {backOnline && <BackOnline names={backOnline} />}
      {(!backOnline || answered) && <TopLine day={day} trip={trip} figures={figures} waiting={waiting} />}
    </>
  );
}

// The latest problem, unless "Try again" sent its stop back and the stop is done again since.
function latestProblem(trip: DriverTrip): { problem: DriverProblem; stop: DriverStop } | null {
  const problem = trip.problems.at(-1);
  if (!problem) return null;
  const stop = trip.stops.find((s) => s.id === problem.stopId);
  if (!stop || (problem.decision === 'try_again' && stop.outcome !== null)) return null;
  return { problem, stop };
}

function TopLine({ day, trip, figures, waiting }: { day: DriverDay; trip: DriverTrip; figures: Figures; waiting: Queued[] }) {
  const latest = latestProblem(trip);
  if (latest) {
    const { problem, stop } = latest;
    const counts = figures.byStop[trip.stops.indexOf(stop)]!;
    const brand = brandOf(trip, stop);
    const onPhone = waiting.some((entry) => entry.write.writeId === problem.id);
    const detail = problem.decision
      ? answerLine(problem, stop, brand, counts, day.depot)
      : problem.kind === 'refused' ? keepLine(brand, counts) : DEPOT_DECIDES;
    return (
      <Band tone="warn" className="pt-2 pb-[7px]">
        <div className="flex min-h-[22px] items-center gap-3">
          <p className="flex min-w-0 flex-1 gap-2 text-xs leading-4 font-semibold">
            <span aria-hidden="true" className="font-bold text-warn-ink">!</span>
            <span>{problem.kind === 'refused' ? refusedLine(stop, counts) : closedLine(stop)}</span>
          </p>
          <SentChip onPhone={onPhone} word="sent" />
        </div>
        <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{detail}</p>
      </Band>
    );
  }
  const done = trip.stops.filter((stop) => stop.doneAt !== null).sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? '')).at(-1);
  if (!done) return null;
  const onPhone = waiting.some((entry) => 'stopId' in entry.write && entry.write.stopId === done.id && entry.write.kind !== 'arrive');
  return (
    <Band tone="good" className="flex min-h-[38px] items-center gap-3 py-2">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-xs leading-4 font-semibold">
        {/* The design draws a plain tick here, so it is the outline set's. */}
        <Check className="size-3.5 shrink-0 stroke-[2.5] text-good" aria-hidden="true" />
        <span>{deliveredLine(done)}</span>
      </p>
      {onPhone ? <SentChip onPhone word="synced" /> : <span className="shrink-0 text-[10px] leading-3 font-semibold text-good">synced</span>}
    </Band>
  );
}

// "sent" in a green pill, or "on this phone" while the write waits.
function SentChip({ onPhone, word }: { onPhone: boolean; word: string }) {
  return (
    <span className={cn('shrink-0 rounded-full px-[9px] py-[5px] text-[10px] leading-3 font-semibold whitespace-nowrap', onPhone ? 'bg-card text-warn-ink' : 'bg-good-tint text-good')}>
      {onPhone ? 'on this phone' : word}
    </span>
  );
}

// Driver · No signal: the yellow bar with the no-signal picture, what waits, and the tray with its number.
function NoSignal({ waiting }: { waiting: number }) {
  return (
    <Band tone="warn" className="flex h-[50px] items-center gap-3">
      <img src={ICON.noSignal} alt="" className="size-[26px] shrink-0 object-contain" />
      <p role="status" className="min-w-0 flex-1 text-[13px] leading-4 font-bold">{noSignalLine(waiting)}</p>
      {waiting > 0 && (
        <span className="relative shrink-0" aria-hidden="true">
          <img src={ICON.tray} alt="" className="size-[26px] object-contain" />
          <span className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-card px-1 text-[10px] leading-none font-bold tabular-nums">{whole(waiting)}</span>
        </span>
      )}
    </Band>
  );
}

// Driver · connection restored: the green bar with the sync picture, what was sent and where it reached, and the dark
// tick that closes it. Its lines wrap at the phone's width rather than being cut, and the bar grows with them (Q-27).
function BackOnline({ names }: { names: string[] }) {
  const { title, line } = backOnlineLines(names);
  return (
    <Band tone="good" className="flex min-h-[54px] items-center gap-3 border-b border-good/15 py-2 md:border-b-0">
      <img src={ICON.sync} alt="" className="size-[30px] shrink-0 object-contain" />
      <div role="status" className="min-w-0 flex-1">
        <p className="text-[13px] leading-4 font-bold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-[14px] text-muted-foreground">{line}</p>
      </div>
      <button type="button" aria-label="Close" onClick={closeBackOnline} className="flex h-[25px] w-[31px] shrink-0 items-center justify-center rounded-full bg-secondary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {/* The design draws a plain tick here, so it is the outline set's. */}
        <Check className="size-3.5 stroke-[2.5] text-good" aria-hidden="true" />
      </button>
    </Band>
  );
}
