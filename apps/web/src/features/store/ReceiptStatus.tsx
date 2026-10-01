import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { deliveryFigures, lineReason, writtenReason, type Brand, type StoreDelivery, type StoreOutlet } from '@wayfinder/contracts';
import receiptIcon from '@/assets/icons/icon-order-delivered.png';
import trayIcon from '@/assets/icons/icon-offline-queue.png';
import { Button } from '@/components/ui/button';
import { shopQueue } from '@/lib/phone/shop';
import { useSignal } from '@/lib/phone/signal';
import { cn } from '@/lib/utils';
import { markShownSaved, PAST_ORDERS, type ReceiptRecord } from './deliveries';
import { ORANGE, orangeLink } from './parts/actions';
import { ReceivedCard } from './parts/ReceiptLineCard';
import { ReceiptNote } from './parts/ReceiptNote';
import { ReceiptFoot, StatusCard, StatusHead } from './parts/ReceiptStatusCard';
import {
  confirmedLine, COULD_NOT_CLEAR, DROPPED, keptSentences, NO_SIGNAL, NOT_ACCEPTED, NOT_SENT_YET, notAcceptedFoot, reportFacts, SAVED_TITLE, savedFoot,
  SENT_TITLE, sentStatus,
} from './words';

// The lines of a receipt, each as received, with what the shop said about each one that is short (Q-40), and the note
// that went with its report. Every count is deliveryFigures' over the delivery.
function Lines({ delivery, brand }: { delivery: StoreDelivery | null; brand: Brand }) {
  if (!delivery) return null;
  const figures = deliveryFigures(delivery);
  const report = delivery.receipt?.report ?? null;
  const said = (lineId: string) => {
    const counted = report?.lines.find((line) => line.lineId === lineId);
    return report && counted ? lineReason(report, counted) : null;
  };
  return (
    <>
      <div className="mt-6 space-y-3">
        {delivery.lines.map((line, i) => <ReceivedCard key={line.lineId} brand={brand} line={line} figures={figures.byLine[i]!} reason={said(line.lineId)} />)}
      </div>
      <ReceiptNote note={report?.note} />
    </>
  );
}

// Saved on this phone (Shop · Short delivery · receipt pending sync, spec 015, rule 6): a receipt waiting on the phone,
// drawn from its own copy, with why it waits. It goes by itself when the signal is back; "Retry sending" asks for the
// signal now. While it goes, the button says "Sending…". Once shown, it stays until the receipt is in or refused.
export function SavedReceipt({ record, drawn, brand, today }: { record: ReceiptRecord; drawn: StoreDelivery | null; brand: Brand; today: string }) {
  const signal = useSignal();
  const { unanswered, signedOut } = shopQueue.useSync();
  const { writeId } = record.write;
  useEffect(() => { markShownSaved(writeId); }, [writeId]);
  const dropped = unanswered.includes(writeId);
  const sending = signal && !dropped && !signedOut;
  // A line with a reason, or the one reason of a receipt saved before lines had their own (Q-40), or warm goods.
  const reports = record.write.lines.some((line) => writtenReason(record.write, line) !== null) || record.write.cold === false;
  return (
    <div className="max-w-xl lg:pt-2.5">
      <StatusHead icon={trayIcon} title={SAVED_TITLE} sub={dropped ? DROPPED : signal ? null : NO_SIGNAL} />
      <Lines delivery={drawn} brand={brand} />
      <StatusCard chip={NOT_SENT_YET} tone="warn" sentences={keptSentences(reports)} className="mt-[18px]" />
      <ReceiptFoot line={savedFoot(record.savedAt, today)}>
        <Button
          className={cn(ORANGE, 'h-[46px] w-full text-sm', sending && 'disabled:bg-primary disabled:text-primary-foreground')}
          disabled={sending}
          focusableWhenDisabled
          onClick={shopQueue.retrySync}
        >
          {sending ? 'Sending…' : 'Retry sending'}
        </Button>
      </ReceiptFoot>
    </div>
  );
}

// Not accepted (no frame): the depot turned the receipt down, in its own words. It is never sent again, and stays on the
// phone, drawn from its own copy, until "Clear" takes it off; then the page shows the delivery as the depot has it.
export function RefusedReceipt({ record, drawn, brand, today, onCleared }: {
  record: ReceiptRecord; drawn: StoreDelivery | null; brand: Brand; today: string; onCleared: () => void;
}) {
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);
  const clear = async () => {
    setClearing(true);
    setFailed(false);
    try {
      await shopQueue.clearRefused([record.seq]);
      onCleared();
    } catch (error) {
      console.warn('Could not clear the receipt the depot did not accept.', error);
      setFailed(true);
      setClearing(false);
    }
  };
  return (
    <div className="max-w-xl lg:pt-2.5">
      <StatusHead icon={trayIcon} title={SAVED_TITLE} />
      <div role="alert" className="mt-[18px] rounded-[10px] bg-bad-tint px-4 py-3 text-[13px] leading-[18px] text-bad">
        <p className="font-semibold">{NOT_ACCEPTED}</p>
        {record.refusal && <p className="mt-0.5">{record.refusal.message}</p>}
      </div>
      <Lines delivery={drawn} brand={brand} />
      <ReceiptFoot line={notAcceptedFoot(record.savedAt, today)}>
        {failed && <p role="alert" className="mb-2.5 text-[13px] leading-4 font-semibold text-bad">{COULD_NOT_CLEAR}</p>}
        <Button className={cn(ORANGE, 'h-[46px] w-full text-sm')} disabled={clearing} onClick={() => { void clear(); }}>
          {clearing ? 'Clearing…' : 'Clear'}
        </Button>
      </ReceiptFoot>
    </div>
  );
}

// Receipt sent (Shop · Receipt sent, and the sent states with no frame): the delivery as the depot has it, what it
// received, and where the report stands: waiting for the depot, all received, or the depot's answer.
export function SentReceipt({ delivery, outlet, today }: { delivery: StoreDelivery; outlet: StoreOutlet; today: string }) {
  const receipt = delivery.receipt!;
  const { short, temps } = reportFacts(delivery, deliveryFigures(delivery));
  const status = sentStatus(receipt, outlet.brand, short, temps);
  return (
    <div className="max-w-xl lg:pt-2.5">
      <StatusHead icon={receiptIcon} title={SENT_TITLE} sub={confirmedLine(receipt, outlet, today)} />
      <Lines delivery={delivery} brand={outlet.brand} />
      <StatusCard chip={status.chip.label} tone={status.chip.tone} sentences={status.sentences} className="mt-[18px]" />
      <ReceiptFoot line={status.foot}>
        <Link to={PAST_ORDERS} className={orangeLink('h-[46px] w-full text-sm')}>View past orders</Link>
      </ReceiptFoot>
    </div>
  );
}
