import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { keepAccountThroughSignOut, meKey, useMe } from '@/features/auth/api';
import { useAppClock } from '@/lib/clock';
import { OtherTab } from '@/lib/phone/OtherTab';
import { shopQueue } from '@/lib/phone/shop';
import { useSignal } from '@/lib/phone/signal';
import { cn } from '@/lib/utils';
import { holdPictures, PAST_ORDERS, recordFor, screenOf, useDeliveriesView, useOneDelivery, wasShownSaved, type DeliveriesView } from './deliveries';
import { PLAIN, plainLink } from './parts/actions';
import { PageHeader } from './parts/PageHeader';
import { Panel } from './parts/Panel';
import { Problem, ReceiptFoot } from './parts/ReceiptStatusCard';
import { ReceiptForm } from './ReceiptForm';
import { RefusedReceipt, SavedReceipt, SentReceipt } from './ReceiptStatus';
import {
  COULD_NOT_LOAD_DELIVERIES, COULD_NOT_READ_PHONE, depotDayOf, NOT_ON_LIST, NOT_SAVED_ON_PHONE, NOTHING_SENT_UNTIL_READ, NOTHING_TO_CONFIRM, SIGN_IN_AGAIN,
} from './words';

// Deliveries at /store/deliveries and /store/deliveries/:stopId (spec 015, rules 1 and 6, plan.md "The pages"). Only
// the tab that owns the shop's queue shows it; any other says so, and the shop's other pages work there. The list opens,
// with replace, the stop of the first receipt waiting or refused on the phone, else the first delivery to confirm, and
// with neither says nothing is waiting. A stop shows its receipt on the phone when there is one, else the delivery the
// phone kept, else the one GET /store/deliveries/:stopId answers, online. Everything else opens at once from what the
// phone kept, with no signal too.
export function DeliveriesPage() {
  const { stopId = null } = useParams();
  const owner = shopQueue.useOwner();
  const { data: me } = useMe();
  if (owner === 'other') return <Column><OtherTab /></Column>;
  if (owner === 'checking' || !me) return <DeliveriesSkeleton />;
  return <OwnDeliveries me={me} stopId={stopId} />;
}

const Column = ({ children }: { children: ReactNode }) => <div className="max-w-xl lg:pt-2.5">{children}</div>;

function OwnDeliveries({ me, stopId }: { me: Me; stopId: string | null }) {
  // While Deliveries is open a 401 keeps the account and the screen, and the line on top asks to sign in again: a
  // receipt answered signed_out waits for the same account (rule 6).
  useEffect(() => keepAccountThroughSignOut(), []);
  useEffect(() => { holdPictures(); }, []);
  const view = useDeliveriesView(me.id);
  const { signedOut, notSaved } = shopQueue.useSync();
  const waiting = view.records.some((record) => record.state === 'waiting');
  return (
    <>
      {signedOut && <SignInLine waiting={waiting} />}
      {notSaved && <Column><Problem>{NOT_SAVED_ON_PHONE}</Problem></Column>}
      <Screen view={view} stopId={stopId} />
    </>
  );
}

function Screen({ view, stopId }: { view: DeliveriesView; stopId: string | null }) {
  const navigate = useNavigate();
  const { failure, unanswered, signedOut } = shopQueue.useSync();
  const signal = useSignal();
  const { at } = useAppClock();
  const unread = stopId !== null && view.day !== null && !recordFor(view, stopId) && !view.day.deliveries.some((delivery) => delivery.stopId === stopId);
  const one = useOneDelivery(stopId ?? '', unread);
  const screen = screenOf({
    view, stopId, one, failure, unanswered, signedOut, signal, today: at !== null ? depotDayOf(at) : null, shownSaved: wasShownSaved,
  });

  switch (screen.show) {
    case 'could-not-read': return <CouldNotRead />;
    case 'loading': return <DeliveriesSkeleton />;
    case 'could-not-load':
      return screen.readAgain
        ? <CouldNotLoad reason={screen.reason} busy={one.isFetching} onRetry={() => { void one.refetch(); }} />
        : <CouldNotLoad reason={screen.reason} />;
    case 'redirect': return <Navigate to={`/store/deliveries/${screen.stopId}`} replace />;
    case 'nothing': return <NothingToConfirm />;
    case 'not-on-list': return <NotOnList />;
    case 'refused': {
      // Cleared, it shows the delivery as the depot has it, or that nothing is waiting when the depot no longer has it.
      const cleared = () => { if (!screen.listed) navigate('/store/deliveries', { replace: true }); };
      return <RefusedReceipt record={screen.record} drawn={screen.drawn} brand={screen.outlet.brand} today={screen.today} onCleared={cleared} />;
    }
    case 'saved': return <SavedReceipt record={screen.record} drawn={screen.drawn} brand={screen.outlet.brand} today={screen.today} />;
    case 'sending': return <ReceiptForm key={stopId} delivery={screen.delivery} outlet={screen.outlet} today={screen.today} record={screen.record} />;
    case 'sent': return <SentReceipt delivery={screen.delivery} outlet={screen.outlet} today={screen.today} />;
    case 'form': return <ReceiptForm key={stopId} delivery={screen.delivery} outlet={screen.outlet} today={screen.today} record={null} />;
  }
}

// Sign in again (no frame, spec 013's line): the receipt waits under its account until the same person signs in. "Sign
// in" opens the sign-in page; what waits stays on the phone meanwhile.
function SignInLine({ waiting }: { waiting: boolean }) {
  const qc = useQueryClient();
  return (
    <Column>
      <div className="mb-3 flex items-center gap-3 rounded-[10px] bg-warn-tint px-3 py-2.5">
        <p role="alert" className="min-w-0 flex-1 text-[13px] leading-4 font-semibold text-warn-ink">{waiting ? SIGN_IN_AGAIN : 'Sign in again.'}</p>
        <button
          type="button"
          className="-my-2 shrink-0 rounded-md px-1 py-2 text-[13px] leading-4 font-bold text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => qc.setQueryData(meKey, null)}
        >
          Sign in
        </button>
      </div>
    </Column>
  );
}

// Nothing to confirm (no frame).
function NothingToConfirm() {
  return (
    <Column>
      <PageHeader title="Deliveries" />
      <Panel line className="mt-[26px]">
        <p className="text-[15px] leading-5">{NOTHING_TO_CONFIRM}</p>
        <Link to={PAST_ORDERS} className={plainLink('mt-4 h-[46px] w-full text-sm')}>View past orders</Link>
      </Panel>
    </Column>
  );
}

// Could not load (no frame), only when nothing is kept on the phone, or for a delivery of another day the phone did not
// keep. "Try again" asks for the signal and fetches at once.
function CouldNotLoad({ reason, busy = false, onRetry = shopQueue.retrySync }: { reason: string; busy?: boolean; onRetry?: () => void }) {
  return (
    <Column>
      <PageHeader title="Deliveries" />
      <Panel line role="alert" className="mt-[26px]">
        <h2 className="font-sans text-[15px] leading-[18px] font-semibold">{COULD_NOT_LOAD_DELIVERIES}</h2>
        <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">{reason}</p>
        <Button variant="outline" className={cn(PLAIN, 'mt-3 h-11 w-full text-sm')} disabled={busy} onClick={onRetry}>{busy ? 'Trying…' : 'Try again'}</Button>
      </Panel>
    </Column>
  );
}

// Could not read (no frame): the phone's database would not give back what it kept. Nothing is sent or saved until it
// does, so a receipt kept earlier never goes after a newer one.
function CouldNotRead() {
  const [reading, setReading] = useState(false);
  const again = async () => {
    setReading(true);
    await shopQueue.readAgain();
    setReading(false);
  };
  return (
    <Column>
      <PageHeader title="Deliveries" />
      <Panel line role="alert" className="mt-[26px]">
        <h2 className="font-sans text-[15px] leading-[18px] font-semibold">{COULD_NOT_READ_PHONE}</h2>
        <p className="mt-1.5 text-xs leading-[15px] text-muted-foreground">{NOTHING_SENT_UNTIL_READ}</p>
        <Button variant="outline" className={cn(PLAIN, 'mt-3 h-11 w-full text-sm')} disabled={reading} onClick={() => { void again(); }}>{reading ? 'Reading…' : 'Try again'}</Button>
      </Panel>
    </Column>
  );
}

// Not on your list (no frame): the address of a stop that is not this shop's delivery.
function NotOnList() {
  return (
    <Column>
      <PageHeader title="Deliveries" />
      <Panel line role="alert" className="mt-[26px]">
        <p className="text-[15px] leading-5">{NOT_ON_LIST}</p>
        <Link to="/store/deliveries" className={plainLink('mt-4 h-[46px] w-full text-sm')}>Back to Deliveries</Link>
      </Panel>
    </Column>
  );
}

// Loading · skeleton: grey blocks for the title, two line cards and the button, on the first load with nothing kept.
function DeliveriesSkeleton() {
  return (
    <div role="status" aria-label="Loading your deliveries" className="max-w-xl lg:pt-2.5">
      <Skeleton className="h-[22px] w-44" />
      <Skeleton className="mt-2.5 h-3 w-52" />
      <div className="mt-[22px] space-y-3">
        {[0, 1].map((row) => (
          <Panel key={row} line>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-8" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton soft className="h-11 w-[152px] rounded-[10px]" />
            </div>
          </Panel>
        ))}
      </div>
      <ReceiptFoot>
        <Skeleton soft className="h-[46px] w-full rounded-[10px]" />
      </ReceiptFoot>
    </div>
  );
}
