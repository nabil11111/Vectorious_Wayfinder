import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import type { ChipTone } from '../words';
import { Panel } from './Panel';

// The head of the saved and sent screens (Shop · Short delivery · receipt pending sync, Shop · Receipt sent): the
// design's picture, the title and the line under it, set in from the cards as the frames draw them.
export function StatusHead({ icon, title, sub }: { icon: string; title: string; sub?: string | null }) {
  return (
    <header className="px-2">
      <img src={icon} alt="" className="mt-[18px] size-[46px] object-contain" />
      <h1 className="mt-[19px] text-[21px] leading-[26px] font-bold">{title}</h1>
      {sub && <p className="mt-[11px] text-[13px] leading-4 text-muted-foreground">{sub}</p>}
    </header>
  );
}

// The card under the lines: a chip in its tone and what it means, a sentence to a line as the frames break them.
export function StatusCard({ chip, tone, sentences, className }: { chip: string; tone: ChipTone; sentences: string[]; className?: string }) {
  return (
    <Panel line className={cn('pt-[14px] pb-[22px]', className)}>
      <Chip tone={tone} size="sm" className="py-[5px]">{chip}</Chip>
      <p className="mt-[13px] text-xs leading-[17px] text-muted-foreground">
        {sentences.map((sentence) => <span key={sentence} className="block">{sentence}</span>)}
      </p>
    </Panel>
  );
}

// The foot of a receipt screen: its one button and, on the saved and sent screens, the grey line under it. Below
// 1024 px they are pinned above the tabs on the page's grey, as the frames draw them, out of the page's flow, with a
// spacer of their height so the end of the page stays reachable; from 1024 px, where the tabs move to the top bar, they
// close the column. The tabs are 63 px tall plus the phone's safe area at every width they show.
export function ReceiptFoot({ line, children }: { line?: string; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const foot = (
    <>
      {children}
      {line !== undefined && <p className="mt-2.5 text-center text-[11px] leading-[14px] text-muted-foreground">{line}</p>}
    </>
  );
  return (
    <>
      <div className="mt-6 hidden lg:block">{foot}</div>
      <div aria-hidden="true" className="lg:hidden" style={{ height }} />
      <div
        ref={bar}
        className={cn('fixed inset-x-0 bottom-[calc(63px+env(safe-area-inset-bottom))] z-[5] bg-background px-4 pt-3 md:px-6 lg:hidden', line === undefined ? 'pb-[34px]' : 'pb-2.5')}
      >
        <div className="max-w-xl">{foot}</div>
      </div>
    </>
  );
}

// A line on top of the screen in red: the phone could not do something, in its own words.
export function Problem({ children }: { children: ReactNode }) {
  return <p role="alert" className="mb-3 rounded-[10px] bg-bad-tint px-3 py-2.5 text-[13px] leading-4 font-semibold text-bad">{children}</p>;
}
