import type { ComponentProps, ReactNode } from 'react';
import type { OperationsProgress } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';

// The small pieces the dashboard and Live day repeat, in the style guide's tokens only: the white card, the status
// chips, a tile's or row's own bar, a trip's stop dots and the joined switch of All trucks and Problems only.

// A white card on the page grey, with the style guide's one soft shadow.
export const CARD = 'rounded-[14px] bg-card shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]';
export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn(CARD, className)} {...props} />;
}

export type Tone = 'good' | 'warn' | 'bad' | 'plain';
const CHIP: Record<Tone, string> = { good: 'bg-good-tint text-good', warn: 'bg-warn-tint text-warn-ink', bad: 'bg-bad-tint text-bad', plain: 'bg-muted text-foreground' };
export function Chip({ tone, className, children }: { tone: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-[5px] text-[10px] leading-3 font-semibold whitespace-nowrap', CHIP[tone], className)}>{children}</span>;
}

// A bar drawn from its own tile's or row's numerator and denominator (rule 3). An empty denominator draws an empty
// bar; an unknown numerator draws no fill at all, and says so to a screen reader.
export function Bar({ progress, tone = 'good', label, className }: { progress: OperationsProgress; tone?: 'good' | 'quiet'; label: string; className?: string }) {
  const known = progress.numerator !== null && progress.percent !== null;
  const share = known && progress.denominator > 0 ? Math.min(100, Math.max(0, progress.percent!)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={progress.denominator}
      aria-valuenow={known ? progress.numerator! : undefined}
      aria-valuetext={known ? undefined : 'not recorded'}
      className={cn('h-1.5 overflow-hidden rounded-full bg-border', className)}
    >
      {share > 0 && <div className={cn('h-full rounded-full', tone === 'good' ? 'bg-good' : 'bg-muted-foreground')} style={{ width: `${share}%` }} />}
    </div>
  );
}

// A trip's stops as dots along a line: the finished ones filled, the next one ringed and the rest open. Only the
// row's own finished and total counts place them.
export function StopDots({ progress, className }: { progress: OperationsProgress; className?: string }) {
  const total = progress.denominator;
  const done = progress.numerator ?? 0;
  if (total === 0) return null;
  return (
    <span aria-hidden="true" className={cn('relative flex h-3.5 min-w-0 flex-1 items-center justify-between', className)}>
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border" />
      {done > 0 && <span className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-good" style={{ width: total === 1 ? '100%' : `${((done - 1) / (total - 1)) * 100}%` }} />}
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'relative z-[1] rounded-full',
            i < done ? 'size-2 bg-good' : i === done ? 'size-3.5 border-2 border-foreground bg-card' : 'size-2 border-[1.5px] border-muted-foreground/50 bg-card',
          )}
        />
      ))}
    </span>
  );
}

// A joined switch, the chosen side ink, as the frames draw All trucks and Problems only.
export function Switch<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex overflow-hidden rounded-full border bg-card', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-[27px] px-3.5 text-xs leading-none font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
            option.value === value ? 'rounded-full bg-secondary text-secondary-foreground' : 'text-foreground hover:bg-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A line that a refresh failed: the last read stays on screen, and Try again asks again (the No frame state).
export function StaleLine({ children, busy, onRetry }: { children: ReactNode; busy: boolean; onRetry: () => void }) {
  return (
    <p role="status" className="flex items-center gap-3 rounded-[10px] bg-warn-tint px-3 py-[7px] text-[11px] leading-[14px] font-semibold text-warn-ink">
      {children}
      <button type="button" className="-my-2 shrink-0 py-2 underline underline-offset-2 disabled:opacity-50" disabled={busy} onClick={onRetry}>{busy ? 'Trying…' : 'Try again'}</button>
    </p>
  );
}

// "● Live · updated 03:38", only while the last refresh worked.
export function LiveLine({ updated }: { updated: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] leading-[14px] text-muted-foreground">
      <span aria-hidden="true" className="size-2 rounded-full bg-good" />
      Live · updated {updated}
    </span>
  );
}
