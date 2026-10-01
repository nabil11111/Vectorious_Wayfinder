import { useState, type ComponentType, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { DEMO_DAY } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ApiRequestError } from '@/lib/api';
import { inDepot, partAt, useNextPart, useResetDay, type AppClock, type HeldClock } from '@/lib/clock';
import { cn } from '@/lib/utils';

// The demo chip beside the time and the control it opens (spec 008). It is the judges' tool for walking a whole
// delivery day in a few minutes, so it has no frame of its own and is built from the style guide: the chip, a
// sheet from the bottom on a phone, a small panel under the chip on a desktop, one orange button.
export function DemoClock({ clock, as, className, compact = false }: { clock: AppClock; as: 'sheet' | 'panel'; className?: string; compact?: boolean }) {
  const { state, at, waiting } = clock;
  const chip = cn(
    'relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs font-semibold whitespace-nowrap text-foreground outline-none select-none',
    'after:absolute after:-inset-2 hover:bg-border focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-border',
    className,
  );
  // With no time to show, the chip's place says so and asks again, rather than "--:--" looking like loading.
  if (clock.failed) {
    return (
      <button type="button" className={chip} aria-label="Could not load the time. Try again." onClick={clock.retry}>
        <span className="size-2 rounded-full bg-warn" aria-hidden="true" />
        No time · Try again
      </button>
    );
  }
  // Demo mode off shows the time only, and nothing shows until the clock has arrived.
  if (!state?.demo || at === null) return null;

  const label = (
    <>
      {waiting && <span className="size-2 rounded-full bg-warn" aria-hidden="true" />}
      Demo<span className={compact ? 'hidden sm:inline' : undefined}> · {inDepot(at).day}</span>
      {waiting && <span className="sr-only">, the clock waits</span>}
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </>
  );

  if (as === 'sheet') {
    return (
      <Sheet>
        <SheetTrigger className={chip}>{label}</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-xl border-t-0 px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <Control state={state} at={at} waiting={waiting} Title={SheetTitle} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover>
      <PopoverTrigger className={chip}>{label}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[22rem] gap-0 p-4">
        <Control state={state} at={at} waiting={waiting} Title={PopoverTitle} />
      </PopoverContent>
    </Popover>
  );
}

// What a failed button says. One that never reached the server, or met a proxy instead, asks to try again.
function failure(error: Error | null) {
  if (!error) return null;
  return error instanceof ApiRequestError && error.code !== 'network' ? error.message : 'Could not reach Wayfinder. Try again.';
}

const TITLE = 'font-heading text-lg font-bold text-foreground';
// The style guide's buttons: 10 px round and semibold, the orange one for the main action. Plain is white with a
// thin line, and stays white on a device in dark mode, where the shared outline button would turn grey.
const BUTTON = 'h-12 w-full rounded-[10px] text-base font-semibold';
const PLAIN = 'bg-card dark:border-border dark:bg-card dark:hover:bg-muted';

function Control({ state, at, waiting, Title }: {
  state: HeldClock;
  at: number;
  waiting: boolean;
  Title: ComponentType<{ className?: string; children?: ReactNode }>;
}) {
  const next = useNextPart();
  const resetDay = useResetDay();
  const [asking, setAsking] = useState(false);
  const now = inDepot(at);
  const current = DEMO_DAY.parts.findIndex((part) => part.key === state.part);

  if (asking) {
    const problem = failure(resetDay.error);
    return (
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5 pr-8">
          <Title className={TITLE}>Reset the demo day?</Title>
          <p className="text-sm text-muted-foreground">
            Every order, plan and delivery made in this demo is removed, and the day starts again on Wednesday at 15:00.
            Everyone using the demo is affected.
          </p>
        </div>
        {problem && <p role="alert" className="text-sm font-semibold text-bad">{problem}</p>}
        <div className="grid gap-2">
          <Button variant="secondary" className={BUTTON} disabled={resetDay.isPending} focusableWhenDisabled onClick={() => resetDay.mutate(undefined, { onSuccess: () => setAsking(false) })}>
            {resetDay.isPending ? 'Resetting…' : 'Reset the day'}
          </Button>
          <Button variant="outline" className={cn(BUTTON, PLAIN)} disabled={resetDay.isPending} onClick={() => { resetDay.reset(); setAsking(false); }}>
            Keep going
          </Button>
        </div>
      </div>
    );
  }

  const problem = failure(next.error);
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5 pr-8">
        <Title className={TITLE}>Demo day</Title>
        <p className="text-sm text-muted-foreground">{now.date}, {now.time}. The app runs on its own clock so you can walk a whole delivery day.</p>
      </div>
      {waiting && state.next && (
        <p className="flex gap-2 rounded-lg bg-warn-tint px-3 py-2.5 text-sm text-warn-ink">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          The clock waits here. Go to the next part when you are ready.
        </p>
      )}
      <ol className="space-y-0.5">
        {DEMO_DAY.parts.map((part, index) => {
          const start = inDepot(Date.parse(part.at));
          const isCurrent = index === current;
          return (
            <li key={part.key} aria-current={isCurrent ? 'step' : undefined} className={cn('flex items-center gap-3 rounded-lg px-2 py-1.5', isCurrent && 'bg-muted')}>
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', isCurrent ? 'bg-secondary text-secondary-foreground' : 'bg-muted', index < current && 'text-muted-foreground')}>
                {index + 1}
              </span>
              <span className={cn('flex-1 text-sm', isCurrent ? 'font-semibold' : index < current && 'text-muted-foreground')}>{part.label}</span>
              <span className={cn('font-mono text-xs tabular-nums', isCurrent ? 'text-foreground' : 'text-muted-foreground')}>{start.weekday} {start.time}</span>
            </li>
          );
        })}
      </ol>
      {problem && <p role="alert" className="text-sm font-semibold text-bad">{problem}</p>}
      <div className="grid gap-2">
        {state.next ? (
          <Button className={BUTTON} disabled={next.isPending} focusableWhenDisabled onClick={() => next.mutate(state.revision)}>
            {next.isPending ? 'Moving…' : `Next: ${partAt(state.next.part, at)}`}
          </Button>
        ) : (
          <p className="py-1 text-sm font-semibold">The demo day is over. Reset to start again.</p>
        )}
        <Button variant="outline" className={cn(BUTTON, PLAIN)} onClick={() => { next.reset(); setAsking(true); }}>
          Reset the demo day
        </Button>
      </div>
    </div>
  );
}
