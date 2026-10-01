import { Link } from 'react-router';
import type { PlanBoard } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { acceptAll, acceptedLine, decisionsTitle, decisionTitle, openCount } from '../words';
import { ICON } from './icons';
import { decisionShop, decisionsOf, type BoardIndex } from './lookup';
import { inkButton, orangeButton, plainButton } from './look';
import { Column, Tag } from './ui';

// View plan's "Decisions · N" (spec 014, D-54), in the place and look of the design's Suggestions card: the planner's
// decisions with their titles and the planner's sentences, each with Accept and Open in edit, and "Accept all N" in
// orange. An accepted one says when. A decision an edit has ended is not listed, and nothing is listed when the plan
// was never built or the planner left nothing to decide. canAccept is false for a sent plan and for another day's.
export function Decisions({ board, index, canAccept, accepting, onAccept, className }: {
  board: PlanBoard;
  index: BoardIndex;
  canAccept: boolean;
  // The accept on its way: one decision's key, or 'all'.
  accepting: string | null;
  onAccept: (keys: string[], which: string) => void;
  className?: string;
}) {
  const decisions = decisionsOf(board);
  if (decisions.length === 0) return null;
  const open = decisions.filter((decision) => decision.open);
  const sent = board.plan.status === 'published';
  const busy = accepting !== null;

  // The Suggestions card's measures: 14 around, a 24 picture, 28 buttons, and the orange button the card's width.
  return (
    <Column aria-label="Decisions" className={cn('p-3.5', className)}>
      <div className="flex items-center gap-2.5">
        <img src={ICON.decisions} alt="" className="size-6 shrink-0 object-contain" />
        <h2 className="min-w-0 flex-1 text-[15px] leading-5 font-bold">{decisionsTitle(decisions.length, open.length)}</h2>
        {open.length > 0 ? <Tag tone="warn">{openCount(open.length)}</Tag> : <Tag tone="good">Accepted</Tag>}
      </div>
      <ul className="mt-1.5">
        {decisions.map((decision) => (
          <li key={decision.key} className="border-t py-[11px]">
            <p className="text-xs leading-4 font-semibold">{decisionTitle(decision, decisionShop(index, decision))}</p>
            <p className="mt-1 text-[11px] leading-[15px] text-muted-foreground">{decision.reason}</p>
            {decision.acceptedAt ? (
              <p className="mt-2 text-[11px] leading-[15px] font-semibold text-good">{acceptedLine(decision.acceptedAt)}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2.5">
                {canAccept && (
                  <Button variant="secondary" className={inkButton('h-7 px-3.5 text-[11px]')} disabled={busy} focusableWhenDisabled onClick={() => onAccept([decision.key], decision.key)}>
                    {accepting === decision.key ? 'Accepting…' : 'Accept'}
                  </Button>
                )}
                {!sent && (
                  <Link to={decision.vehicleId !== null && decision.tripNo !== null ? `/dispatcher/plan?trip=${decision.vehicleId}-${decision.tripNo}` : '/dispatcher/plan'} className={plainButton('h-7 px-3.5 text-[11px]')}>
                    Open in edit
                  </Link>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canAccept && open.length > 0 && (
        <Button className={orangeButton('mt-1 h-9 w-full text-[13px]')} disabled={busy} focusableWhenDisabled onClick={() => onAccept(open.map((decision) => decision.key), 'all')}>
          {accepting === 'all' ? 'Accepting…' : acceptAll(open.length)}
        </Button>
      )}
    </Column>
  );
}
