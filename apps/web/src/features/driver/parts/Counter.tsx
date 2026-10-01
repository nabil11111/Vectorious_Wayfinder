import { NumberField } from '@base-ui/react/number-field';
import { cn } from '@/lib/utils';
import { whole } from '../words';

const STEP = 'flex size-[46px] shrink-0 items-center justify-center rounded-[12px] border bg-card text-xl leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:text-muted-foreground/40';

// The frames' counter: − the count /of +. It runs from 0 to max, and the number can be typed as well. The count is
// the screen's own (the driver's tally, or a refusal's pair), never a figure the phone keeps.
export function Counter({ label, value, max, of, disabled = false, onChange }: {
  label: string; value: number; max: number; of: number; disabled?: boolean; onChange: (value: number) => void;
}) {
  return (
    <NumberField.Root
      value={value}
      min={0}
      max={max}
      disabled={disabled}
      locale="en-GB"
      format={{ maximumFractionDigits: 0, useGrouping: false }}
      onValueChange={(next) => onChange(Math.min(max, Math.max(0, Math.round(next ?? 0))))}
    >
      <NumberField.Group className="flex items-center">
        <NumberField.Decrement aria-label={`One less: ${label}`} className={STEP}>−</NumberField.Decrement>
        <span className="flex min-w-[74px] items-baseline justify-center px-1.5 font-heading text-[28px] leading-8 font-bold tabular-nums">
          <NumberField.Input
            aria-label={label}
            maxLength={3}
            onClick={(event) => event.currentTarget.select()}
            className={cn('min-w-0 bg-transparent p-0 text-right outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-foreground', value > 99 ? 'w-[51px]' : value > 9 ? 'w-[34px]' : 'w-[17px]')}
          />
          <span className="text-muted-foreground/60">/{whole(of)}</span>
        </span>
        <NumberField.Increment aria-label={`One more: ${label}`} className={STEP}>+</NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}
