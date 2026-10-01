import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useMe } from '@/features/auth/api';
import { cn } from '@/lib/utils';
import { recordOf, retrySync } from '../sender';
import { useSignal } from '../signal';
import { clearRefused, type Queued } from '../store';
import { useDriverView } from '../view';
import { clockTime, whole } from '../words';
import { ICON } from './icons';
import { BIG, PLAIN } from './ui';

// The status chip beside the time on every driver screen (spec 013, rule 12): "● Online" in green, "Offline" with
// the design's no-signal picture in yellow, and whenever records wait a thin line and the design's tray with their
// number. "1 not accepted" in red once the server refused a record, until the driver clears it on the sheet, which
// lists what waits too. A tap opens the waiting sheet.
//
// The phone's top bar also carries the demo chip (spec 008), so at 390 wide the chip has about 84 px: it keeps its
// spacing tight, reaches into the bar's gaps when it carries the tray, and below 380 wide shows its pictures alone.
export function StatusChip() {
  const { data: me } = useMe();
  const view = useDriverView(me?.id ?? '');
  const signal = useSignal();
  const refused = view.refusedRecords > 0;
  const tray = !refused && view.waitingRecords > 0;
  const tone = refused ? 'bg-bad-tint text-bad' : signal ? 'bg-good-tint text-good' : 'bg-warn-tint text-warn-ink';
  const word = refused ? `${whole(view.refusedRecords)} not accepted` : signal ? 'Online' : 'Offline';
  const label = [word, view.waitingRecords > 0 && `${whole(view.waitingRecords)} waiting to send`].filter(Boolean).join(', ');

  return (
    <Sheet>
      <SheetTrigger
        aria-label={`${label}. Open what waits on this phone.`}
        className={cn(
          'relative flex h-[22px] shrink-0 items-center gap-[3px] rounded-full px-[7px] text-[11px] leading-none font-semibold whitespace-nowrap outline-none select-none after:absolute after:-inset-1.5 focus-visible:ring-3 focus-visible:ring-ring/50',
          (tray || refused) && '-mx-1.5',
          tone,
        )}
      >
        {refused ? null : signal
          ? <span aria-hidden="true" className="mr-[3px] size-2 shrink-0 rounded-full bg-good" />
          : <img src={ICON.noSignal} alt="" className="h-3.5 w-2.5 shrink-0 object-contain" />}
        {refused ? (
          <span>
            <span aria-hidden="true" className="mr-1 font-bold min-[380px]:hidden">!</span>
            {whole(view.refusedRecords)}
            <span className="max-[379px]:hidden"> not accepted</span>
          </span>
        ) : <span className="max-[379px]:hidden">{word}</span>}
        {tray && (
          <>
            <span aria-hidden="true" className={cn('mx-0.5 h-3 w-px shrink-0', signal ? 'bg-good/50' : 'bg-warn')} />
            <img src={ICON.tray} alt="" className="size-[13px] shrink-0 object-contain" />
            <span className="font-bold tabular-nums">{whole(view.waitingRecords)}</span>
          </>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto w-full max-w-[480px] rounded-t-xl border-t-0 px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <WaitingSheet waiting={view.waiting} refused={view.refused} userId={me?.id ?? ''} />
      </SheetContent>
    </Sheet>
  );
}

interface Row { key: string; about: string; detail: string }

// One row per record: its latest save time while it waits, and the server's sentence once refused.
function waitingRows(entries: Queued[]): Row[] {
  const rows = new Map<string, Row>();
  for (const entry of entries) rows.set(recordOf(entry.write), { key: recordOf(entry.write), about: entry.about, detail: `saved ${clockTime(entry.savedAt)}` });
  return [...rows.values()];
}
function refusedRows(entries: Queued[]): Row[] {
  const rows = new Map<string, Row>();
  for (const entry of entries) {
    const detail = entry.refusal?.message ?? 'Not accepted.';
    const key = `${recordOf(entry.write)}:${detail}`;
    if (!rows.has(key)) rows.set(key, { key, about: entry.about, detail });
  }
  return [...rows.values()];
}

// The waiting sheet (no frame): what waits to send and what the server did not accept, with "Clear" and, while
// something waits, "Retry sync".
function WaitingSheet({ waiting, refused, userId }: { waiting: Queued[]; refused: Queued[]; userId: string }) {
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const waitingList = waitingRows(waiting);
  const refusedList = refusedRows(refused);
  const waitingCount = new Set(waiting.map((entry) => recordOf(entry.write))).size;
  const refusedCount = new Set(refused.map((entry) => recordOf(entry.write))).size;

  const clear = async () => {
    setClearing(true);
    setClearFailed(false);
    try {
      await clearRefused(userId);
    } catch (error) {
      console.warn('Could not clear the records that were not accepted.', error);
      setClearFailed(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="pr-8">
        <SheetTitle className="font-heading text-lg leading-6 font-bold text-foreground">
          {waitingCount > 0 ? `Waiting to send · ${whole(waitingCount)}` : 'Everything is sent.'}
        </SheetTitle>
        {waitingList.length > 0 && (
          <ul className="mt-2 divide-y">
            {waitingList.map((row) => (
              <li key={row.key} className="py-2.5 text-sm leading-5">
                <span className="font-semibold">{row.about}</span>
                <span className="text-muted-foreground"> · {row.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {refusedList.length > 0 && (
        <section>
          <h2 className="font-heading text-lg leading-6 font-bold text-bad">Not accepted · {whole(refusedCount)}</h2>
          <ul className="mt-2 divide-y">
            {refusedList.map((row) => (
              <li key={row.key} className="py-2.5 text-sm leading-5">
                <span className="font-semibold">{row.about}</span>
                <span className="text-bad"> · {row.detail}</span>
              </li>
            ))}
          </ul>
          {clearFailed && <p role="alert" className="mt-2 text-sm font-semibold text-bad">Could not clear on this phone. Try again.</p>}
          <Button variant="outline" className={PLAIN('mt-3')} disabled={clearing} onClick={() => { void clear(); }}>
            {clearing ? 'Clearing…' : 'Clear'}
          </Button>
        </section>
      )}

      {waitingCount > 0 && <Button className={BIG()} onClick={retrySync}>Retry sync</Button>}
    </div>
  );
}
