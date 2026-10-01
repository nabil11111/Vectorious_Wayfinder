import { useEffect, useState } from 'react';
import type { DraftDeferral, DraftPlan } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { reasonOf } from '@/features/store/words';
import { useSlots, type BoardScreen, type Undo } from '../board';
import { addOrders, defer, keyOf, type CrewRef, type TripKey } from '../draft';
import { cubic, deferredTimes, ENTRANCE, hhmm, kilos, orderAmount, shortDay } from '../words';
import { CrewMenu } from './CrewMenu';
import type { Pick } from './crews';
import { DeferForm } from './DeferForm';
import type { BoardIndex } from './lookup';
import { inkButton, orangeButton, plainButton } from './look';
import { Tag } from './ui';

// Find a slot (rule 10, Edit plan · find a slot · Tue and · Mon) for a carried-over order on no trip. The server
// tries it on every trip of the saved draft: a green box per trip it fits, "Put it here", or a red box with each
// trip's first block. Then a new trip with this order, keeping it deferred with its reason, or closing.
export function FindSlot({ screen, index, orderId, change, onPut, onCrew, onClose }: {
  screen: BoardScreen;
  index: BoardIndex;
  orderId: string;
  change: (next: DraftPlan, said: Undo) => void;
  onPut: (key: TripKey) => void;
  // A crew picked for a new trip with this order (spec 026).
  onCrew: (pick: Pick, crew: CrewRef) => void;
  onClose: () => void;
}) {
  const { board, draft } = screen;
  const date = board.day!.date;
  // A trip named by its truck's driver on the draft (spec 026): "Chaminda · dry truck".
  const crewOf = (trip: { vehicleId: string; tripNo: number }) => index.crew({ ...trip, driverId: draft.trips.find((t) => t.vehicleId === trip.vehicleId)?.driverId ?? null });
  const order = index.order(orderId);
  const shop = order ? index.shop(order.outletId) : null;
  // The search is worked out on the saved draft, so it waits for the save on its way.
  const saved = screen.saving === 'saved' && !screen.acting;
  const slots = useSlots(date, orderId, saved);
  const [deferring, setDeferring] = useState(false);
  const { refetch } = slots;
  const answerRevision = slots.data?.revision;
  // An answer for an older draft is asked for again.
  useEffect(() => {
    if (saved && answerRevision !== undefined && answerRevision !== board.plan.revision) void refetch();
  }, [saved, answerRevision, board.plan.revision, refetch]);

  if (!order || !shop) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm">This order is no longer on the board.</p>
        <Button variant="outline" className={plainButton('h-9 w-fit px-4 text-[13px]')} onClick={onClose}>Close</Button>
      </div>
    );
  }

  // A new trip with this order, on the crew picked for it (spec 026).
  const start: Pick = { kind: 'start', group: { brand: shop.brand, district: shop.district }, orders: [order], startWith: [order] };
  // Offers stand only for the saved draft they were worked out on: a change on its way hides them until it is saved.
  const current = saved && slots.data && slots.data.revision === board.plan.revision ? slots.data : null;
  const put = (key: TripKey) => {
    const trip = draft.trips.find((t) => keyOf(t) === key);
    change(addOrders(draft, key, [order]), { line: `${shop.name} added to ${trip ? index.called(trip) : 'the trip'}`, tripKey: key });
    onPut(key);
  };
  const keepDeferred = (deferrals: DraftDeferral[]) => {
    change(defer(draft, deferrals), { line: `${shop.name} kept deferred`, tripKey: null });
    onClose();
  };
  const facts = [
    orderAmount(shop.brand, order), kilos(order.load.kg), cubic(order.load.m3),
    `${ENTRANCE[shop.dockType]}${order.load.needsTailLift ? ', needs a tail lift' : ''}`,
    `${hhmm(shop.windowOpen)} to ${hhmm(shop.windowClose)}`,
  ];

  return (
    <div className="flex flex-col px-5 pt-5 pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-lg leading-[23px] font-bold">Find a slot · {shop.name}</h2>
        <Tag tone={order.timesDeferred >= 2 ? 'bad' : 'warn'} className="px-3 text-[10px] leading-[13px]">wanted {shortDay(order.deliveryDate)} · {deferredTimes(order)}</Tag>
        <Button variant="outline" className={plainButton('ml-auto h-8 px-4 text-xs')} onClick={onClose}>Close</Button>
      </div>
      <p className="mt-3 text-xs leading-[15px] text-muted-foreground">{facts.join(' · ')}</p>
      <p className="mt-4 text-[11px] leading-[14px] text-muted-foreground">Tried on every trip of this plan</p>

      <div className="mt-3 space-y-3">
        {slots.isError && !current ? (
          <div role="alert" className="rounded-[12px] bg-bad-tint px-5 py-4 text-xs">
            <p className="font-semibold text-bad">Could not look for a slot</p>
            <p className="mt-1 text-muted-foreground">{reasonOf(slots.error)}</p>
            <Button variant="outline" className={plainButton('mt-3 h-8 px-4 text-xs')} disabled={slots.isFetching} onClick={() => { void refetch(); }}>Try again</Button>
          </div>
        ) : !current ? (
          <div role="status" aria-label="Looking for a slot" className="space-y-2 rounded-[12px] bg-muted px-5 py-4">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : current.slots.length > 0 ? (
          current.slots.map((slot, i) => (
            <div key={`${slot.vehicleId}-${slot.tripNo}`} className="flex flex-wrap items-center gap-3 rounded-[12px] border-[1.5px] border-good bg-good-tint px-5 py-4">
              <p className="min-w-0 flex-1 text-[15px] leading-5 font-semibold">
                {crewOf(slot)} · stop {slot.stopSeq} · arrives {hhmm(slot.arriveAt)}
              </p>
              <Button
                variant={i === 0 ? 'default' : 'outline'}
                className={i === 0 ? orangeButton('h-9 px-5 text-[13px]') : plainButton('h-9 px-5 text-[13px]')}
                onClick={() => put(keyOf(slot))}
              >
                Put it here
              </Button>
            </div>
          ))
        ) : (
          <div className="rounded-[12px] bg-bad-tint px-5 py-4">
            <p className="text-[15px] leading-5 font-semibold text-bad">No slot on {shortDay(date)}</p>
            {current.refused.length > 0 && (
              <dl className="mt-3 grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-xs leading-[15px]">
                {current.refused.map((trip) => (
                  <div key={`${trip.vehicleId}-${trip.tripNo}`} className="contents">
                    <dt className="text-muted-foreground">{crewOf(trip)}</dt>
                    <dd className="font-semibold">{trip.problem.message}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <CrewMenu
          screen={screen}
          index={index}
          pick={start}
          title={`Start a trip · ${shop.name}`}
          trigger="Start a trip"
          triggerClassName={inkButton('h-10 px-5 text-[13px]')}
          onPick={(crew) => onCrew(start, crew)}
        />
        <Button variant="outline" className={plainButton('h-10 px-5 text-[13px]')} onClick={() => setDeferring(true)}>Keep deferred, tell the shop</Button>
      </div>
      {deferring && (
        <DeferForm
          orders={[order]}
          index={index}
          code={order.lastDeferral?.code}
          reason={order.lastDeferral?.reason}
          onDefer={keepDeferred}
          onCancel={() => setDeferring(false)}
        />
      )}
    </div>
  );
}
