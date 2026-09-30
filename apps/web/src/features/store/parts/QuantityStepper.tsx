import { NumberField } from '@base-ui/react/number-field';
import { cn } from '@/lib/utils';

// − and + around the number, as the order form draws them. Both are real buttons with a label, − stops at 0
// and + at 999, and the number itself is a field: tap it and type, so 48 cartons do not take 48 taps.
// 'lg' is the Fresh form's stepper, 'md' the smaller one in the Style and Tech lists.
export function QuantityStepper({ name, value, onChange, size }: { name: string; value: number; onChange: (value: number) => void; size: 'lg' | 'md' }) {
  const lg = size === 'lg';
  // The small button is 36 px to look at. The ::before adds 4 px all round, which makes it 44 px to tap.
  const button = cn(
    'relative flex shrink-0 items-center justify-center rounded-[10px] border bg-card text-xl leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px',
    lg ? 'size-[46px]' : "size-9 before:absolute before:-inset-1 before:content-['']",
  );
  return (
    <NumberField.Root
      value={value}
      min={0}
      max={999}
      locale="en-GB"
      format={{ maximumFractionDigits: 0, useGrouping: false }}
      onValueChange={(next) => onChange(Math.min(999, Math.max(0, Math.round(next ?? 0))))}
    >
      <NumberField.Group className="flex items-center">
        <NumberField.Decrement aria-label={`One less: ${name}`} className={button}>−</NumberField.Decrement>
        <NumberField.Input
          aria-label={name}
          maxLength={3}
          // A tap selects the number, so typing replaces it.
          onClick={(event) => event.currentTarget.select()}
          className={cn(
            'min-w-0 rounded-md bg-transparent p-0 text-center font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-foreground',
            lg ? 'font-heading text-[28px] leading-[46px]' : 'w-[50px] font-mono text-xl leading-9',
            lg && (value > 99 ? 'w-[58px]' : 'w-[41px]'),
            value === 0 && 'text-muted-foreground/65',
          )}
        />
        <NumberField.Increment aria-label={`One more: ${name}`} className={button}>+</NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}
