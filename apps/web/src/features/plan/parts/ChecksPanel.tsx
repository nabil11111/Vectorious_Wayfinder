import { Link } from 'react-router';
import type { PlanBoard } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { clockTime, countOf, READY_WITH_WARNINGS, whole } from '../words';
import { ICON } from './icons';
import { plainButton } from './look';
import { checkItems } from './lookup';
import { Column, Tag } from './ui';

// The right column of View plan: "Checks · N" and "Not ready · N blockers" with each check and "Open in edit";
// when nothing blocks, "Ready", or "Ready, with warnings" while warnings stay listed, and what goes out; once sent,
// the checks the plan was sent with. While one of the planner's decisions is open the plan is not ready, so neither
// tag shows (spec 014): accepting a decision changes nothing the checker says.
export function ChecksPanel({ board, className }: { board: PlanBoard; className?: string }) {
  const sent = board.plan.status === 'published';
  const items = [
    ...board.plan.trips.filter((trip) => trip.driverId === null).map((trip) => ({
      key: `driver-${trip.vehicleId}-${trip.tripNo}`, level: 'warn' as const,
      title: `${trip.vehicleId} has no driver`, fix: 'Choose a driver before sending.', trip: `${trip.vehicleId}-${trip.tripNo}`,
    })),
    ...checkItems(board.check?.problems ?? []),
  ];
  const blockers = items.filter((item) => item.level === 'block').length;
  const title = sent && board.plan.sentAt ? `Sent ${clockTime(board.plan.sentAt)}` : items.length > 0 ? `Checks · ${whole(items.length)}` : 'Checks · all clear';
  const deciding = board.suggestion?.decisions.some((decision) => decision.open) ?? false;
  const ready = !sent && board.check?.ok === true && !deciding;

  return (
    // The frames' measures, shared with the Decisions card above it: 14 around, a 24 picture and 28 buttons.
    <Column aria-label="Checks" className={cn('p-3.5', className)}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.checks} alt="" className="size-6 shrink-0 object-contain" />
        <h2 className="min-w-0 flex-1 text-[15px] leading-5 font-bold">{title}</h2>
        {sent ? <Tag tone="good">Sent</Tag>
          : blockers > 0 ? <Tag tone="bad">Not ready · {countOf(blockers, 'blocker')}</Tag>
            : ready && <Tag tone="good">{items.length > 0 ? READY_WITH_WARNINGS : 'Ready'}</Tag>}
      </div>
      {items.length > 0 && (
        <ul className="mt-1.5">
          {items.map((item) => (
            <li key={item.key} className="border-t py-[11px]">
              <p className={cn('text-xs leading-4 font-semibold', item.level === 'block' ? 'text-bad' : 'text-warn-ink')}>{item.title}</p>
              {item.fix && <p className="mt-1 text-[11px] leading-[15px] text-muted-foreground">{item.fix}</p>}
              {!sent && (
                <Link to={item.trip ? `/dispatcher/plan?trip=${item.trip}` : '/dispatcher/plan'} className={plainButton('mt-2 h-11 px-3.5 text-sm')}>
                  {item.trip ? 'Open this trip' : 'Open the orders'}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {(ready || sent) && board.counts && (
        <ul className="mt-4 space-y-2 text-xs leading-[16px]">
          <li className="flex gap-2"><span aria-hidden="true" className="font-bold text-good">✓</span>{countOf(board.counts.ordersOnTrips, 'order')} on {countOf(board.counts.trips, 'trip')}</li>
          {board.counts.ordersDeferred > 0 && (
            <li className="flex gap-2"><span aria-hidden="true" className="font-bold text-good">✓</span>{whole(board.counts.ordersDeferred)} deferred, each with a reason the shop will read</li>
          )}
        </ul>
      )}
    </Column>
  );
}
