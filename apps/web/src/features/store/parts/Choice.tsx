import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// An answer of the receipt: ink when chosen, white with a thin line when not. Joined answers share one outline, as the
// loader's flag form draws its reasons.
export function Choice({ on, disabled, joined = false, className, onClick, children }: {
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
