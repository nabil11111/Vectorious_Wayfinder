import { useEffect, useState, type ReactNode } from 'react';
import { deliveryFigures, SHORT_REASONS, type ReceiptWrite, type ShortReason, type StoreDelivery, type StoreOutlet } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { newWriteId } from '@/features/loader/loading';
import { useAppClock } from '@/lib/clock';
import { UNUSABLE, usePhoto } from '@/lib/phone/photo';
import { PhotoInput, PhotoTile } from '@/lib/phone/PhotoTile';
import { shopQueue } from '@/lib/phone/shop';
import { cn } from '@/lib/utils';
import type { ReceiptRecord, ShownReceipt } from './deliveries';
import { ORANGE, PLAIN } from './parts/actions';
import { Panel } from './parts/Panel';
import { CountCard } from './parts/ReceiptLineCard';
import { Problem, ReceiptFoot } from './parts/ReceiptStatusCard';
import { aboutDelivery, ADD_PHOTO, arrivedLine, NOT_SAVED_ON_PHONE, RECEIPT_TITLE, SHORT_REASON_WORDS } from './words';

// Confirm delivery at /store/deliveries/:stopId (Shop · Confirm delivery, spec 015, rules 2 and 3, D-56): every line
// of the delivery, counted against what the driver handed over, what is wrong once a count is lower, the cold check
// when chilled goods came, and a photo once the receipt reports something. "Confirm delivery" saves the receipt on the
// phone first, as the exact request it will send (D-57), and the button says "Sending…" while the phone has a signal
// and the receipt is on its way. The form keeps its counts, reason, cold answer and photo in the page, so a fetch or a
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
  const [reason, setReason] = useState<ShortReason>(sent?.reason ?? 'missing');
  const [cold, setCold] = useState(sent?.cold ?? true);
  const sending = record !== null;
  const off = saving || sending;

  const countAt = (i: number) => counts[delivery.lines[i]!.lineId] ?? figures.byLine[i]!.expected;
  const short = figures.byLine.some((line, i) => countAt(i) < line.expected);
  // A receipt reports something once a count is lower, or the chilled goods were not cold (rule 5, D-60).
  const reports = short || (figures.chilled && !cold);
  const shownPhoto = sent ? sent.photo ?? null : photo;
  // "Could not save" is on top of the form, so a phone that tapped the button at its foot is taken up to it.
  useEffect(() => { if (failed) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [failed]);

  // Every line once, a line handed over at 0 at 0, the cold answer only when chilled goods came, what is wrong only
  // when a line is short, and the photo only with a report. Not while a photo is being read, or the one before it, or
  // none, would go instead. With no clock known yet, it waits. The receipt takes the app clock's time at the press.
  const confirm = () => {
    const now = readNow();
    if (now === null || off || reading) return;
    const write: ReceiptWrite = {
      kind: 'receipt',
      writeId: newWriteId(),
      stopId: delivery.stopId,
      at: new Date(now).toISOString(),
      revision: delivery.revision,
      lines: delivery.lines.map((line, i) => ({ lineId: line.lineId, received: countAt(i) })),
      cold: figures.chilled ? cold : null,
      reason: short ? reason : null,
      ...(reports && photo ? { photo } : {}),
    };
    // The record keeps the delivery as the form showed it and its shop, so it draws with no deliveries kept.
    const shown: ShownReceipt = { ...delivery, outlet };
    void save(write, aboutDelivery(delivery, outlet), shown);
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
            reason={reason}
            disabled={off}
            onCount={(count) => setCounts((held) => ({ ...held, [line.lineId]: count }))}
          />
        ))}

        {short && (
          <Question label="What’s wrong?">
            <div role="radiogroup" aria-label="What’s wrong?" className="flex h-[46px] overflow-hidden rounded-[10px] border bg-card">
              {SHORT_REASONS.map((why) => (
                <Choice key={why} on={reason === why} disabled={off} joined onClick={() => setReason(why)}>{SHORT_REASON_WORDS[why]}</Choice>
              ))}
            </div>
          </Question>
        )}

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
      </div>

      <ReceiptFoot>
        <Button
          className={cn(ORANGE, 'h-[46px] w-full text-sm', off && 'disabled:bg-primary disabled:text-primary-foreground')}
          disabled={off || reading || at === null}
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

// An answer: ink when chosen, white with a thin line when not. Joined answers share one outline, as the loader's flag
// form draws its reasons.
function Choice({ on, disabled, joined = false, className, onClick, children }: {
  on: boolean; disabled: boolean; joined?: boolean; className?: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'text-sm leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        joined ? 'h-full px-3.5 focus-visible:ring-inset' : 'h-[46px] rounded-[10px] border',
        on ? 'border-secondary bg-secondary text-secondary-foreground' : 'bg-card text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}
