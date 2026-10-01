import type { KeyboardEventHandler, Ref } from 'react';
import { cn } from '@/lib/utils';
import { pinCount } from '../words';

// The phone's PIN (frames PIN0 to PIN4): four dots, one filled per digit, 3 px down their 22 px row and 3.5 px left of
// the middle as the frame has them. A screen reader hears the count each time it changes. After a failed sign-in the
// page puts the focus here, and a keyboard can type the digits from here too.
export function PinDots({ count, ref, onKeyDown, className }: { count: number; ref?: Ref<HTMLOutputElement>; onKeyDown?: KeyboardEventHandler<HTMLOutputElement>; className?: string }) {
  return (
    <output ref={ref} tabIndex={-1} aria-labelledby="pin-label" aria-describedby="pin-line" onKeyDown={onKeyDown} className={cn('flex h-[22px] items-start justify-center gap-[25px] rounded-[8px] pr-[7px] pt-[3px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}>
      {[0, 1, 2, 3].map((place) => (
        <span key={place} data-filled={place < count} aria-hidden="true" className={cn('size-[13px] rounded-full border-[1.4px]', place < count ? 'border-foreground bg-foreground' : 'border-mute bg-card')} />
      ))}
      <span className="sr-only">{pinCount(count)}</span>
    </output>
  );
}
