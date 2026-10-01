import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { orangeButton, plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';

// The small pieces the loader's frames repeat, in the style guide's tokens only: the cards, the stop chip, the load
// bar, the tick box, the status chips and the lines that say a write was refused or not saved.

// A white card. The one that needs the loader now (Next out, the stop being loaded) is outlined in ink, the others
// float on the style guide's one soft shadow.
export function Card({ ink = false, className, ...props }: ComponentProps<'div'> & { ink?: boolean }) {
  return (
    <div
      className={cn('rounded-[14px] bg-card', ink ? 'border-2 border-foreground' : 'shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]', className)}
      {...props}
    />
  );
}

// "stop 2", a grey pill before a shop's name.
export function StopChip({ seq, className }: { seq: number; className?: string }) {
  return <span className={cn('inline-flex h-[25px] shrink-0 items-center rounded-full bg-muted px-2.5 text-xs leading-none font-semibold whitespace-nowrap tabular-nums', className)}>stop {seq}</span>;
}

// A chip in the style guide's tones: green done, yellow waiting, red a problem.
const TONE = { good: 'bg-good-tint text-good', warn: 'bg-warn-tint text-warn-ink', bad: 'bg-bad-tint text-bad' } as const;
export function Tag({ tone, tick = false, className, children }: { tone: keyof typeof TONE; tick?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-[25px] shrink-0 items-center gap-1 rounded-full px-2.5 text-xs leading-none font-semibold whitespace-nowrap', TONE[tone], className)}>
      {/* The design draws a plain tick here, so it is the outline set's. */}
      {tick && <Check className="size-3.5 stroke-[2.5]" aria-hidden="true" />}
      {children}
    </span>
  );
}

// What is on the truck over what it carries, as a bar. The API counted both; the screen only draws them. An empty
// bar keeps a round start, as the design draws it.
export function LoadBar({ on, of, className }: { on: number; of: number; className?: string }) {
  const share = of > 0 ? Math.min(1, on / of) : 0;
  return (
    <div className={cn('h-2.5 overflow-hidden rounded-full bg-border', className)} role="presentation">
      <div className="h-full min-w-2.5 rounded-full bg-good" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

// The loader's own tick box: green with a white tick when ticked, a grey outline when not.
export function TickBox({ ticked, className }: { ticked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[34px] shrink-0 items-center justify-center rounded-[9px]',
        ticked ? 'bg-good text-card' : 'border-2 border-muted-foreground/45 bg-card',
        className,
      )}
    >
      {ticked && <Check className="size-[18px] stroke-[3]" />}
    </span>
  );
}

// A section's small grey heading: "Next out", "Goes in first", "Load in this order".
export function Label({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-[13px] leading-4 font-semibold text-muted-foreground', className)} {...props} />;
}

// The line on top of the page when the server refused a write, in its own words. It stays in view under the top bar
// while the page scrolls, so a phone with its buttons at the foot still sees it.
export function Refused({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="sticky top-[61px] z-[5] mb-3 rounded-[10px] bg-bad-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-bad">
      {children}
    </p>
  );
}

// A write that got no answer. Try again sends the same write, with the same id, so one that had landed counts once.
export function NotSaved({ onRetry }: { onRetry: () => void }) {
  return (
    <p role="alert" className="sticky top-[61px] z-[5] mb-3 flex items-center justify-between gap-3 rounded-[10px] bg-warn-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-warn-ink">
      Not saved. Check the connection and try again.
      <button type="button" className="-my-3 shrink-0 py-3 underline underline-offset-2" onClick={onRetry}>Try again</button>
    </p>
  );
}

// The loader tried to leave the flag form, or to sign out, while its flag is not sent (Q-22). It stays in view under the
// top bar, as "Not saved" does, until they choose: Try again sends the same flag, and Leave without sending or Sign out
// anyway does what they meant to.
export function LeaveUnsent({ signingOut = false, onRetry, onLeave }: { signingOut?: boolean; onRetry: () => void; onLeave: () => void }) {
  const line = useId();
  return (
    <div role="alertdialog" aria-labelledby={line} className="sticky top-[61px] z-[5] mb-3 rounded-[10px] bg-warn-tint px-3 pt-2.5 pb-3 text-warn-ink">
      <p id={line} className="text-[13px] leading-4 font-semibold">This flag is not sent. If you {signingOut ? 'sign out' : 'leave'} now, the dispatcher may never see it.</p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <Button className={orangeButton('h-11 rounded-[10px] text-[13px]')} onClick={onRetry}>Try again</Button>
        <Button variant="outline" className={plainButton('h-11 rounded-[10px] text-[13px]')} onClick={onLeave}>{signingOut ? 'Sign out anyway' : 'Leave without sending'}</Button>
      </div>
    </div>
  );
}

// The loader tried to leave while the flag is still on its way (Q-22): they go once it is sent, or are asked if it is not.
export function SendingFirst() {
  return (
    <p role="status" className="sticky top-[61px] z-[5] mb-3 rounded-[10px] bg-warn-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-warn-ink">
      Sending the flag. You can leave once it is sent.
    </p>
  );
}

// A bar pinned to the foot of a phone screen with the page's buttons, as the phone frames draw them. It is out of
// the page's flow, so a spacer of its height keeps the end of the page reachable. From 1024 px the buttons sit in
// the page instead.
export function ActionBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden="true" className="lg:hidden" style={{ height }} />
      <div ref={bar} className="fixed inset-x-0 bottom-0 z-[5] bg-card px-4 pt-6 pb-[max(30px,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_color-mix(in_srgb,var(--foreground)_6%,transparent)] md:px-6 lg:hidden">
        {children}
      </div>
    </>
  );
}
