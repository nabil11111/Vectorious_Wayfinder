import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { Brand, DriverStop } from '@wayfinder/contracts';
import { orangeButton, plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { shopIcon } from './icons';

// The small pieces the driver's frames repeat, in the style guide's tokens only: the cards, the buttons pinned to the
// foot of the phone, a stop's heading and the lines that say what the phone could not do.

// A white card on the style guide's one soft shadow.
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-[14px] bg-card shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]', className)} {...props} />;
}

// The frames' two buttons: the big orange one for the screen's one action, and the plain one under it.
export const BIG = (className?: string) => orangeButton(cn('h-[60px] w-full rounded-[12px] text-lg', className));
export const PLAIN = (className?: string) => plainButton(cn('h-12 w-full rounded-[12px] text-sm', className));

// The buttons pinned to the foot of the phone, as every driver frame draws them, no wider than the screens. The bar is
// out of the page's flow, so a spacer of its height keeps the end of the page reachable.
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
      <div aria-hidden="true" style={{ height }} />
      <div ref={bar} className="fixed inset-x-0 bottom-0 z-[5] mx-auto w-full max-w-[480px] bg-card px-4 pt-3.5 pb-[max(28px,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
        <div className="flex flex-col gap-2.5">{children}</div>
      </div>
    </>
  );
}

// "Stop 1 of 2", the shop's picture and name, and the line under it, as Unload, Proof and Something's wrong draw them.
export function StopHead({ stopLine, stop, brand, sub }: { stopLine: string; stop: DriverStop; brand: Brand | null; sub: string }) {
  return (
    <header>
      <p className="text-xs leading-4 font-semibold text-muted-foreground">{stopLine}</p>
      <h1 className="mt-2.5 flex items-center gap-3 text-xl leading-7 font-bold">
        <img src={shopIcon(brand)} alt="" className="size-7 shrink-0 object-contain" />
        {stop.shopName}
      </h1>
      <p className="mt-3 text-[13px] leading-4 text-muted-foreground">{sub}</p>
    </header>
  );
}

// A line on top of the screen in red: the phone could not do something, and says so in its own words.
export function Problem({ children }: { children: ReactNode }) {
  return <p role="alert" className="mb-3 rounded-[10px] bg-bad-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-bad">{children}</p>;
}

// A band under the top bar, as the frames draw the top line and the signal's bars. It sits in the top area.
export function Band({ tone, className, children }: { tone: 'good' | 'warn'; className?: string; children: ReactNode }) {
  return <div className={cn('px-4 md:rounded-[12px]', tone === 'good' ? 'bg-good-tint' : 'bg-warn-tint', className)}>{children}</div>;
}
