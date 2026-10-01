import { useEffect, useState, type ReactNode } from 'react';
import { deliveryFigures, writtenReason, type ShortReason, type StoreDelivery, type StoreOutlet } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { newWriteId } from '@/features/loader/loading';
import { useAppClock } from '@/lib/clock';
import { UNUSABLE, usePhoto } from '@/lib/phone/photo';
import { PhotoInput, PhotoTile } from '@/lib/phone/PhotoTile';
import { shopQueue } from '@/lib/phone/shop';
import { cn } from '@/lib/utils';
import type { ReceiptRecord, ShownReceipt } from './deliveries';
import { ORANGE, PLAIN } from './parts/actions';
import { Choice } from './parts/Choice';
import { NoteBox } from './parts/DriverNote';
import { Panel } from './parts/Panel';
import { CountCard } from './parts/ReceiptLineCard';
import { Problem, ReceiptFoot } from './parts/ReceiptStatusCard';
import { receiptBox, receiptCounts, receiptRequest } from './receipt-counts';
import { aboutDelivery, ADD_PHOTO, arrivedLine, NOT_SAVED_ON_PHONE, RECEIPT_NOTE_LABEL, RECEIPT_TITLE } from './words';

// Confirm delivery at /store/deliveries/:stopId (Shop · Confirm delivery, spec 015, rules 2 and 3, D-56): every line
// of the delivery, counted against what the driver handed over, what is wrong with each line once its count is lower
// (Q-40), the cold check when chilled goods came, and a photo and a note for the depot once the receipt reports
// something. "Confirm delivery" saves the receipt on the
// phone first, as the exact request it will send (D-57), and the button says "Sending…" while the phone has a signal
// and the receipt is on its way. The form keeps its counts, reasons, cold answer, photo and note in the page, so a fetch or a
// failed save leaves them. A receipt already on its way is drawn from its own request, with nothing to change.
export function ReceiptForm({ delivery, outlet, today, record }: { delivery: StoreDelivery; outlet: StoreOutlet; today: string; record: ReceiptRecord | null }) {
  const { brand } = outlet;
  const figures = deliveryFigures(delivery);
  const { at, readNow } = useAppClock();
  const { save, saving, failed } = shopQueue.useSave();
  const { photo, unusable, reading, inputRef, take, pick } = usePhoto();
  const sent = record?.write ?? null;
  // The form's own counters, from what was handed over, and its answers.
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries((sent?.lines ?? []).map((line) => [line.lineId, line.received])));
  // What a count box holds while it is not the count the form holds: what is being typed, and a wrong number, which
  // stays as it was typed (Q-38).
  const [typed, setTyped] = useState<Record<string, string>>({});
  // What is wrong with each short line, Missing until the shop picks another (Q-40). A receipt on its way shows its own.
  const [reasons, setReasons] = useState<Record<string, ShortReason>>(() =>
    Object.fromEntries((sent?.lines ?? []).flatMap((line) => { const reason = writtenReason(sent!, line); return reason ? [[line.lineId, reason]] : []; })));
  const [note, setNote] = useState(sent?.note ?? '');
  const [cold, setCold] = useState(sent?.cold ?? true);
  const sending = record !== null;
  const off = saving || sending;

  const tally = receiptCounts(figures.byLine, counts, typed);
  const { countAt, short } = tally;
  // A receipt reports something once a count is lower, or the chilled goods were not cold (rule 5, D-60).
  const reports = short || (figures.chilled && !cold);
  const shownPhoto = sent ? sent.photo ?? null : photo;
  // "Could not save" is on top of the form, so a phone that tapped the button at its foot is taken up to it.
  useEffect(() => { if (failed) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [failed]);

  // The receipt as receiptRequest makes it. Not while a box holds a wrong count (Q-38), or while a photo is being read,
  // or the one before it, or none, would go instead. With no clock known yet, it waits. The receipt takes the app clock's time at the press.
  const confirm = () => {
    const now = readNow();
    if (now === null || off || reading || !tally.canConfirm) return;
    const write = receiptRequest(delivery, {
      writeId: newWriteId(), at: new Date(now).toISOString(), counts: delivery.lines.map((_, i) => countAt(i)), reasons, cold, note, photo,
    });
    // The record keeps the delivery as the form showed it and its shop, so it draws with no deliveries kept.
    const shown: ShownReceipt = { ...delivery, outlet };
    void save(write, aboutDelivery(delivery, outlet), shown);
  };

  // − and + step from the count the form holds, and what was typed in the box goes. A whole number from 0 to what was
  // handed over is its count; anything else stays in the box as typed. Leaving the box shows its count, "048" as 48,
  // and a wrong number stays.
  const without = (held: Record<string, string>, lineId: string) => Object.fromEntries(Object.entries(held).filter(([id]) => id !== lineId));
  const box = {
    step: (lineId: string, value: number) => {
      setCounts((held) => ({ ...held, [lineId]: value }));
      setTyped((held) => without(held, lineId));
    },
    type: (lineId: string, expected: number, text: string) => {
      setTyped((held) => ({ ...held, [lineId]: text }));
      const { count } = receiptBox(text, expected);
      if (count !== null) setCounts((held) => ({ ...held, [lineId]: count }));
    },
    leave: (lineId: string, expected: number) => setTyped((held) => (held[lineId] !== undefined && receiptBox(held[lineId]!, expected).wrong === null ? without(held, lineId) : held)),
  };

  return (
    <div className="max-w-xl lg:pt-2.5">
      {failed && <Problem>{NOT_SAVED_ON_PHONE}</Problem>}
      <header>
        <h1 className="text-[22px] leading-[27px] font-bold">{RECEIPT_TITLE}</h1>
        <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">{arrivedLine(delivery, today)}</p>
      </header>

      <div className="mt-3.5 space-y-3">
        {delivery.lines.map((line, i) => (
          <CountCard
            key={line.lineId}
            brand={brand}
            line={line}
            figures={figures.byLine[i]!}
            count={countAt(i)}
            text={typed[line.lineId]}
            reason={reasons[line.lineId] ?? 'missing'}
            disabled={off}
            onStep={(count) => box.step(line.lineId, count)}
            onType={(text) => box.type(line.lineId, figures.byLine[i]!.expected, text)}
            onLeave={() => box.leave(line.lineId, figures.byLine[i]!.expected)}
            onReason={(why) => setReasons((held) => ({ ...held, [line.lineId]: why }))}
          />
        ))}

        {figures.chilled && (
          <Question label="Still cold on arrival?">
            <div role="radiogroup" aria-label="Still cold on arrival?" className="flex gap-2">
              {/* The frame's two widths. */}
              <Choice on={cold} disabled={off} className="w-[54px]" onClick={() => setCold(true)}>Yes</Choice>
              <Choice on={!cold} disabled={off} className="w-[60px]" onClick={() => setCold(false)}>No</Choice>
            </div>
          </Question>
        )}

        {reports && (
          <div className="!mt-4">
            {unusable && !sending && <p role="alert" className="mb-2.5 text-[13px] leading-4 font-semibold text-bad">{UNUSABLE}</p>}
            {shownPhoto ? (
              <div className="flex gap-2.5">
                <PhotoTile photo={shownPhoto} reading={reading} disabled={off || reading} onTake={take} />
                <Button variant="outline" className={cn(PLAIN, 'h-[52px] flex-1 text-sm')} disabled={off || reading} onClick={take}>
                  {reading ? 'Reading the photo…' : 'Retake photo'}
                </Button>
              </div>
            ) : (
              <Button variant="outline" className={cn(PLAIN, 'h-[46px] w-full text-sm')} disabled={off || reading} onClick={take}>
                {reading ? 'Reading the photo…' : ADD_PHOTO}
              </Button>
            )}
            <PhotoInput inputRef={inputRef} onPick={pick} />
          </div>
        )}

        {reports && (
          // The shop's own words for the depot, with the report (Q-40).
          <div className="!mt-4">
            <NoteBox id="receipt-note" label={RECEIPT_NOTE_LABEL} note={note} disabled={off} onChange={setNote} />
          </div>
        )}
      </div>

      <ReceiptFoot>
        <Button
          className={cn(ORANGE, 'h-[46px] w-full text-sm', off && 'disabled:bg-primary disabled:text-primary-foreground')}
          disabled={off || reading || at === null || !tally.canConfirm}
          focusableWhenDisabled
          onClick={confirm}
        >
          {off ? 'Sending…' : RECEIPT_TITLE}
        </Button>
      </ReceiptFoot>
    </div>
  );
}

// A question of the receipt in its own card, its answers on the right, as the frame draws "Still cold on arrival?".
function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Panel line className="flex items-center justify-between gap-3 py-2">
      <p className="text-[13px] leading-4 font-semibold">{label}</p>
      {children}
    </Panel>
  );
}
