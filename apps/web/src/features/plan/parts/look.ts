import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The plan board's colours and buttons, from the style guide's tokens only.

export type Tone = 'good' | 'warn' | 'bad';

// A figure's colour (rule 12): red when the checker blocks on it, yellow when it warns or at 95% and over, green
// otherwise. The screen compares; the API worked the percentage out.
export const toneOf = (pct: number, blocked: boolean, warned = false): Tone => (blocked ? 'bad' : warned || pct >= 95 ? 'warn' : 'good');

// The fuel left: red when the quota blocks, yellow with 5% or less of the week's quota left.
export const fuelTone = (leftPct: number, blocked: boolean): Tone => (blocked ? 'bad' : leftPct <= 5 ? 'warn' : 'good');

// The style guide's buttons, on the shared Button: white with a thin line, ink, or the one orange action. An ink
// or orange button that is off takes the style guide's grey. A button kept focusable while off says so with
// data-disabled rather than the disabled attribute, so both are styled.
const BUTTON = 'rounded-[10px] font-semibold shadow-none';
const OFF = 'disabled:bg-border disabled:text-muted-foreground/65 disabled:opacity-100 data-disabled:bg-border data-disabled:text-muted-foreground/65 data-disabled:opacity-100 data-disabled:pointer-events-none';
export const plainButton = (className?: string) => cn(buttonVariants({ variant: 'outline' }), BUTTON, 'bg-card dark:border-border dark:bg-card dark:hover:bg-muted data-disabled:opacity-50', className);
export const inkButton = (className?: string) => cn(buttonVariants({ variant: 'secondary' }), BUTTON, OFF, className);
export const orangeButton = (className?: string) => cn(buttonVariants(), BUTTON, 'border-0', OFF, className);
