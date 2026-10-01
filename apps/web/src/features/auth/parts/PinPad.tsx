import type { KeyboardEventHandler } from 'react';
import { cn } from '@/lib/utils';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const KEY = 'flex h-11 items-center justify-center rounded-[8px] bg-muted text-foreground outline-none transition-colors hover:bg-border active:bg-border focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none';

// The phone's number pad (frame 53:6276): 1 to 9, then 0 under 8 with the delete key beside it. While the details are
// being checked the whole pad dims and takes no presses (frame Loading).
export function PinPad({ disabled, onDigit, onDelete, onKeyDown, className }: { disabled: boolean; onDigit: (digit: string) => void; onDelete: () => void; onKeyDown?: KeyboardEventHandler<HTMLDivElement>; className?: string }) {
  return (
    <div onKeyDown={onKeyDown} className={cn('grid grid-cols-3 gap-x-[9px] gap-y-2 transition-opacity', disabled && 'opacity-45', className)}>
      {DIGITS.map((digit) => (
        <button key={digit} type="button" disabled={disabled} onClick={() => onDigit(digit)} className={cn(KEY, 'pb-px font-mono text-[21px] leading-[29px]', digit === '0' && 'col-start-2')}>
          {digit}
        </button>
      ))}
      <button type="button" aria-label="Delete last PIN digit" disabled={disabled} onClick={onDelete} className={cn(KEY, 'text-muted-foreground')}>
        <svg viewBox="0 0 22 20" aria-hidden="true" className="h-5 w-[22px]">
          <path d="M8 4H20V16H8L2 10ZM11 7L16 13M16 7L11 13" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
