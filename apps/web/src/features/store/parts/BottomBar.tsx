import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A bar pinned to the foot of a phone screen, above the tabs, the way the frames pin the order's button. It is
// out of the page's flow, so a spacer of its height keeps the end of the page reachable. From 1024 px the
// screens are two columns and hold the same content in the page, so the bar is not shown.
//
// AppShell's tabs are 63 px tall below 768 px (a 1 px line, 8 px, the 26 px picture, 4 px, the 16 px label,
// 8 px) plus the phone's safe area, and gone above it. If AppShell's tab bar changes height, change it here.
export function BottomBar({ className, children }: { className?: string; children: ReactNode }) {
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
      <div ref={bar} className={cn('fixed inset-x-0 bottom-[calc(63px+env(safe-area-inset-bottom))] md:bottom-0 lg:hidden', className)}>
        {children}
      </div>
    </>
  );
}
