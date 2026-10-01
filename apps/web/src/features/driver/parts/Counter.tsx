import { cn } from '@/lib/utils';
import { whole } from '../words';

const STEP = 'flex size-[46px] shrink-0 items-center justify-center rounded-[12px] border bg-card text-xl leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:text-muted-foreground/40';

// The frames' counter: − the count /of +. − and + step from 0 to max, and the number can be typed as well. The count is
// the screen's own (the driver's tally, or a refusal's pair), never a figure the phone keeps. The box keeps what is
// typed as it is: a minus, a fraction or more than max is never turned into another number (Q-25). While it holds one,
// the screen says so in a line of its own, whose id is `invalid`: the box is marked red, and − and + wait until it is
// a count again, as the loader's flag box and the shop's quantity box do.
export function Counter({ label, value, text, max, of, invalid, disabled = false, onStep, onType, onLeave, className }: {
  label: string; value: number; text?: string; max: number; of: number; invalid?: string; disabled?: boolean;
  onStep: (value: number) => void; onType: (text: string) => void; onLeave: () => void; className?: string;
}) {
  const wrong = invalid !== undefined;
  const shown = text ?? String(value);
  const off = disabled || wrong;
  const step = (by: number) => onStep(Math.min(max, Math.max(0, value + by)));
  return (
    <div role="group" className={cn('flex items-center', className)}>
      <button type="button" tabIndex={-1} aria-label={`One less: ${label}`} disabled={off || value <= 0} className={STEP} onClick={() => step(-1)}>−</button>
      <span className="flex min-w-[74px] items-baseline justify-center px-1.5 font-heading text-[28px] leading-8 font-bold tabular-nums">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          aria-invalid={wrong || undefined}
          aria-describedby={invalid}
          value={shown}
          disabled={disabled}
          onChange={(event) => onType(event.currentTarget.value)}
          onBlur={onLeave}
          // A tap selects the count, so typing replaces it.
          onClick={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            if (!wrong) step(event.key === 'ArrowUp' ? 1 : -1);
          }}
          // A longer text than three figures widens the box, so all of it shows.
          style={shown.length > 3 ? { width: `${shown.length + 1}ch` } : undefined}
          className={cn(
            'min-w-0 rounded-md bg-transparent p-0 text-right outline-none focus-visible:ring-2 focus-visible:ring-foreground',
            shown.length > 2 ? 'w-[51px]' : shown.length > 1 ? 'w-[34px]' : 'w-[17px]',
            wrong && 'text-bad ring-1 ring-bad focus-visible:ring-bad',
          )}
        />
        <span className="text-muted-foreground/60">/{whole(of)}</span>
      </span>
      <button type="button" tabIndex={-1} aria-label={`One more: ${label}`} disabled={off || value >= max} className={STEP} onClick={() => step(1)}>+</button>
    </div>
  );
}
