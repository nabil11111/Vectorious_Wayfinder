import { Link } from 'react-router';
import type { PlanBoard } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { clockTime, countOf, whole } from '../words';
import { ICON } from './icons';
import { plainButton } from './look';
import { checkItems } from './lookup';
import { Column, Tag } from './ui';

// The right column of View plan: "Checks · N" and "Not ready · N blockers" with each check and "Open in edit";
// when nothing blocks, "Ready" and what goes out; once sent, the checks the plan was sent with.
export function ChecksPanel({ board, className }: { board: PlanBoard; className?: string }) {
  const sent = board.plan.status === 'published';
  const items = checkItems(board.check?.problems ?? []);
  const blockers = items.filter((item) => item.level === 'block').length;
  const title = sent && board.plan.sentAt ? `Sent ${clockTime(board.plan.sentAt)}` : items.length > 0 ? `Checks · ${whole(items.length)}` : 'Checks · all clear';
  const ready = !sent && board.check?.ok === true;

  return (
    <Column className={cn('p-5', className)}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.checks} alt="" className="size-[26px] shrink-0 object-contain" />
        <h2 className="min-w-0 flex-1 text-[15px] leading-5 font-bold">{title}</h2>
        {sent ? <Tag tone="good">Sent</Tag> : blockers > 0 ? <Tag tone="bad">Not ready · {countOf(blockers, 'blocker')}</Tag> : board.check && <Tag tone="good">Ready</Tag>}
      </div>
      {items.length > 0 && (
        <ul className="mt-3">
          {items.map((item) => (
            <li key={item.key} className="border-t py-3">
              <p className={cn('text-xs leading-[16px] font-semibold', item.level === 'block' ? 'text-bad' : 'text-warn-ink')}>{item.title}</p>
              {item.fix && <p className="mt-1 text-[11px] leading-[15px] text-muted-foreground">{item.fix}</p>}
              {!sent && (
                <Link to={item.trip ? `/dispatcher/plan?trip=${item.trip}` : '/dispatcher/plan'} className={plainButton('mt-2.5 h-8 px-4 text-[11px]')}>
                  Open in edit
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {(ready || sent) && board.counts && (
        <ul className="mt-3 space-y-2 text-xs leading-[16px]">
          <li className="flex gap-2"><span aria-hidden="true" className="font-bold text-good">✓</span>{countOf(board.counts.ordersOnTrips, 'order')} on {countOf(board.counts.trips, 'trip')}</li>
          {board.counts.ordersDeferred > 0 && (
            <li className="flex gap-2"><span aria-hidden="true" className="font-bold text-good">✓</span>{whole(board.counts.ordersDeferred)} deferred, each with a reason the shop will read</li>
          )}
        </ul>
      )}
    </Column>
  );
}
