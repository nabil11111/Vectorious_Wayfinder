import { useEffect, useRef } from 'react';
import type { Notification } from '@wayfinder/contracts';
import { GLANCE_MS, swiped } from './glance';
import { driverAnswerIcon } from './icons';

// The driver's answer at a glance (spec 025, AC-3b): a driver may be at the wheel, so the dispatcher's answer pops up as
// a large card with the answer's picture and its short form, three words with the count, and under it, small, who
// answered and when and the full sentence. A tap or a swipe closes it, and it goes by itself after 8 seconds. It sits
// under the top bar, clear of Start trip and I've arrived at the foot of the screen.

export function GlanceCard({ item, onClose }: { item: Notification; onClose: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(onClose, GLANCE_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, onClose]);
  if (!item.answer || !item.decision) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[72px] z-50 flex justify-center px-4">
      <button
        type="button"
        aria-label={`${item.answer.short}. ${item.answer.sentence} Tap to close.`}
        onClick={onClose}
        onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={(event) => {
          if (start.current && swiped(event.clientX - start.current.x, event.clientY - start.current.y)) onClose();
          start.current = null;
        }}
        className="pointer-events-auto flex w-full max-w-[440px] touch-none flex-col items-center gap-3 rounded-2xl bg-card px-6 py-6 text-center shadow-xl ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 animate-in fade-in-0 slide-in-from-top-4"
      >
        <span role="status" className="flex flex-col items-center gap-3">
          <img src={driverAnswerIcon(item.decision)} alt="" className="size-20 object-contain" />
          <span className="font-heading text-[32px] leading-9 font-extrabold text-balance">{item.answer.short}</span>
          <span className="text-sm leading-5 font-semibold text-muted-foreground tabular-nums">{item.answer.by} · {item.time}</span>
          <span className="text-sm leading-5 text-muted-foreground text-pretty">{item.answer.sentence}</span>
        </span>
      </button>
    </div>
  );
}
