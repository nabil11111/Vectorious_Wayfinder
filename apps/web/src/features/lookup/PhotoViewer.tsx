import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CARD } from '@/features/live/parts/ui';
import { plainButton } from '@/features/plan/parts/look';
import { cn } from '@/lib/utils';
import { CloseButton } from './parts/ui';
import type { PhotoViewer as Viewer } from './queries';
import { NO_PHOTO, PHOTO_FAILED, clockTime } from './words';

// The photo viewer (spec 017, the Photo row's No frame states): a labelled region that takes the focus when a photo is
// opened, with grey blocks while its bytes load, then the photo, "No photo recorded", or "Could not load the photo"
// with Try again. Escape or Close shuts it and gives the focus back to what opened it. It traps nothing.
export function PhotoViewer({ viewer, className }: { viewer: Viewer; className?: string }) {
  const view = viewer.view;
  const region = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = view.status !== 'closed';
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    region.current?.focus();
    region.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  if (view.status === 'closed') return null;

  const close = () => {
    viewer.close();
    const back = opener.current;
    window.requestAnimationFrame(() => back?.focus());
  };
  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-label={`Photo · ${view.label}`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}
      className={cn(CARD, 'px-4 pt-3.5 pb-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-sans text-[13px] leading-[18px] font-semibold">{view.label}</h3>
          <p className="text-[11px] leading-[14px] text-muted-foreground">taken {clockTime(view.photo.takenAt)}</p>
        </div>
        <CloseButton label="Close the photo" onClick={close} />
      </div>
      <div className="mt-3" aria-live="polite">
        {view.status === 'loading' && <div role="status" aria-label="Loading the photo"><Skeleton className="aspect-[4/3] w-full rounded-[10px]" /></div>}
        {view.status === 'shown' && <img src={view.url} alt={view.label} onError={() => viewer.broken(view.url)} className="max-h-[420px] w-full rounded-[10px] bg-muted object-contain" />}
        {view.status === 'missing' && <p className="text-xs leading-4 font-semibold">{NO_PHOTO}</p>}
        {view.status === 'failed' && (
          <div role="alert">
            <p className="text-xs leading-4 font-semibold">{PHOTO_FAILED}</p>
            <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{view.reason}</p>
            <Button variant="outline" className={plainButton('mt-3 h-8 px-4 text-xs')} onClick={viewer.retry}>Try again</Button>
          </div>
        )}
      </div>
    </section>
  );
}
