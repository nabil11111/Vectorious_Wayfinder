import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { acceptedNote, TO_DECIDE } from '../words';
import { Tag } from './ui';

// One of the planner's reasons, under what it is about: an order of the stop ("39 cartons chilled"), or nothing more
// when the popover is about one order.
export interface WhyReason { key: string; about?: string; reason: string }
// One of the planner's decisions about a deferred order, by its title.
export interface WhyDecision { key: string; title: string; acceptedAt: string | null }

// "Plan reason" (spec 014, D-55): a chip on each stop of the open trip and on each deferred order, opening the planner's
// reason for each of the stop's orders, or for the deferred order with its decisions, "to decide" in the warning
// colour or "✓ accepted 16:08". Every word in it is the planner's or the board's. No frame draws it, so it takes the
// style guide's chip and the board's popover.
// align is the chip's side of the row: the popover lines up with it and opens towards the rest of the row.
export function Why({ title, reasons, decisions = [], align = 'end' }: { title: string; reasons: WhyReason[]; decisions?: WhyDecision[]; align?: 'start' | 'end' }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Plan reason: ${title}`}
        className="inline-flex min-h-[21px] shrink-0 items-center rounded-sm px-1 text-[11px] leading-[15px] text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:text-foreground"
      >
        Plan reason
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} className="w-80 max-w-[calc(100vw-32px)] gap-0 p-3.5 text-left">
        <PopoverTitle className="text-xs leading-[15px] font-semibold">{title}</PopoverTitle>
        <ul className="mt-2 space-y-2.5">
          {reasons.map((item) => (
            <li key={item.key}>
              {item.about && <p className="text-[11px] leading-[14px] font-semibold text-muted-foreground">{item.about}</p>}
              <p className="text-xs leading-[16px] text-pretty">{item.reason}</p>
            </li>
          ))}
        </ul>
        {decisions.length > 0 && (
          <ul className="mt-3 space-y-2 border-t pt-2.5">
            {decisions.map((decision) => (
              <li key={decision.key} className="flex items-start justify-between gap-3">
                <span className="text-xs leading-[16px] font-semibold">{decision.title}</span>
                {decision.acceptedAt
                  ? <Tag tone="good" className="text-[10px] leading-[13px]">{acceptedNote(decision.acceptedAt)}</Tag>
                  : <Tag tone="warn" className="text-[10px] leading-[13px]">{TO_DECIDE}</Tag>}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
