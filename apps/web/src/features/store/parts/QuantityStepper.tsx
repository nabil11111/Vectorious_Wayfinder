import { useId } from 'react';
import { MAX_LINE_UNITS } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { wholeQuantity } from '../draft-form';
import { QUANTITY_LINE } from '../words';

// What an item's box shows and does: the number the form holds, what is typed in the box while it is not that
// number, and the form's three changes.
export interface QuantityBox {
  value: number;
  text: string | undefined;
  // − or +, with the number it steps to.
  onStep: (value: number) => void;
  onType: (text: string) => void;
  onLeave: () => void;
}

// − and + around the number, as the order form draws them. Both are real buttons with a label, − stops at 0
// and + at 999, and the number itself is a box: tap it and type, so 48 cartons do not take 48 taps. The box keeps
// what is typed as it is: a minus, a fraction or more than 999 is never turned into another number. It is marked
// red with the fix under it, as the style guide's inputs are, the form saves nothing until it is a whole number from
// 0 to 999, and − and + wait for that too (Q-01, Q-02). The line is the row's last child, so a row that wraps puts
// it under the stepper.
// 'lg' is the Fresh form's stepper, 'md' the smaller one in the Style and Tech lists. While the order is being
// placed the stepper is off, and its signs and number take the style guide's disabled grey.
export function QuantityStepper({ name, box, size, disabled = false }: { name: string; box: QuantityBox; size: 'lg' | 'md'; disabled?: boolean }) {
  const lg = size === 'lg';
  const line = useId();
  const { value, text } = box;
  const wrong = text !== undefined && wholeQuantity(text) === null;
  const shown = text ?? String(value);
  const off = disabled || wrong;
  const step = (by: number) => box.onStep(Math.min(MAX_LINE_UNITS, Math.max(0, value + by)));
  // The small button is 36 px to look at. The ::before adds 4 px all round, which makes it 44 px to tap.
  // − at 0 is off as well, but keeps its look, as in the frames, so the grey follows `off` only. Like the number
  // field they were, the buttons are for pointers and touch: a keyboard steps with the arrow keys in the box.
  const button = cn(
    'relative flex shrink-0 items-center justify-center rounded-[10px] border bg-card text-xl leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px',
    lg ? 'size-[46px]' : "size-9 before:absolute before:-inset-1 before:content-['']",
    off && 'text-muted-foreground/65',
  );
  return (
    <>
      <div role="group" className="flex items-center">
        <button type="button" tabIndex={-1} aria-label={`One less: ${name}`} disabled={off || value <= 0} className={button} onClick={() => step(-1)}>−</button>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={name}
          aria-invalid={wrong || undefined}
          aria-describedby={wrong ? line : undefined}
          value={shown}
          disabled={disabled}
          onChange={(event) => box.onType(event.currentTarget.value)}
          onBlur={box.onLeave}
          // A tap selects the number, so typing replaces it.
          onClick={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            if (!wrong) step(event.key === 'ArrowUp' ? 1 : -1);
          }}
          // The box keeps its width whatever is typed, so a long refused number scrolls inside it and never pushes the
          // product's name aside (L-01). The line under it says what to fix.
          className={cn(
            'min-w-0 rounded-md bg-transparent p-0 text-center font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-foreground',
            lg ? 'font-heading text-[28px] leading-[46px]' : 'w-[50px] font-mono text-xl leading-9',
            lg && (shown.length > 2 ? 'w-[58px]' : 'w-[41px]'),
            (value === 0 || disabled) && !wrong && 'text-muted-foreground/65',
            wrong && 'text-bad ring-1 ring-bad focus-visible:ring-bad',
          )}
        />
        <button type="button" tabIndex={-1} aria-label={`One more: ${name}`} disabled={off || value >= MAX_LINE_UNITS} className={button} onClick={() => step(1)}>+</button>
      </div>
      {wrong && <p id={line} role="alert" className="basis-full text-right text-[11px] leading-[14px] font-semibold text-bad">{QUANTITY_LINE}</p>}
    </>
  );
}
