import { cn } from '@/lib/utils';
import type { Line } from '../sign-in';
import { CHECKING, FAILURE_LINE, HINT } from '../words';

// The line under the PIN (frames PIN0 to PIN4, Loading and Error): the hint on a phone and nothing on a desktop, then
// "Checking your details…", or why the sign-in failed in the error's red. It is announced when it changes.
export function PinLine({ line, className }: { line: Line; className?: string }) {
  const failed = line !== 'hint' && line !== 'checking';
  return (
    <p id="pin-line" aria-live="polite" className={cn('min-h-[15px] text-[11px] leading-[15px] lg:min-h-[17px] lg:text-xs lg:leading-[17px]', failed ? 'text-bad-ink' : 'text-muted-foreground', className)}>
      {line === 'hint' ? <span className="lg:hidden">{HINT}</span> : line === 'checking' ? CHECKING : FAILURE_LINE[line]}
    </p>
  );
}
