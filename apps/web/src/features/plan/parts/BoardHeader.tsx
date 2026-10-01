import { useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Tooltip } from '@base-ui/react/tooltip';
import { Redo2, RotateCcw, Undo2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { BoardCounts, DraftPlan } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { editable, type BoardScreen, type Undo } from '../board';
import { setMixBrands } from '../draft';
import { clockTime, figure, planFor, space, whole } from '../words';
import { historyTip, START_OVER_LINE } from './history-keys';
import { inkButton, plainButton } from './look';
import { Tag } from './ui';

export type Tab = 'unplanned' | 'planning' | 'done';

// The top of the board (Edit plan's header): the day, the three columns as tabs, whether the draft is saved,
// the counts of rule 12, "Mix brands" and "View plan". Below 1024 px the tabs choose the column on screen; on a
// desktop they only mark the column being worked in.
export function BoardHeader({ screen, tab, working, onTab, openCount, unplannedCount, doneCount, change, retry, onViewPlan, stale, onRefresh, refreshing, onUndo, onRedo, onStartOver }: {
  screen: BoardScreen;
  tab: Tab;
  working: Tab;
  onTab: (tab: Tab) => void;
  openCount: number;
  unplannedCount: number;
  doneCount: number;
  change: (next: DraftPlan, said: Undo) => void;
  retry: () => void;
  onViewPlan: () => void;
  stale: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  // The history's Undo and Redo (spec 027).
  onUndo: () => void;
  onRedo: () => void;
  // Start over, once asked (spec 027).
  onStartOver: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const { board, draft } = screen;
  // View plan is greyed until the first change has made a plan.
  const hasPlan = board.plan.id !== null || screen.saving !== 'saved';
  const tabs: { value: Tab; label: string }[] = [
    { value: 'unplanned', label: `Unplanned · ${whole(unplannedCount)}` },
    { value: 'planning', label: `Planning · ${openCount}` },
    { value: 'done', label: doneCount > 0 ? `Done · ${whole(doneCount)} ${doneCount === 1 ? 'trip' : 'trips'}` : 'Done · 0' },
  ];

  // One line on a desktop: the day, the tabs, the saving and the counts, with Mix brands and View plan under them.
  // On a phone the tabs come last, under the header and the counts (spec 010, narrow screens).
  return (
    <header className="flex flex-wrap items-center gap-x-3.5 gap-y-3 lg:gap-y-3.5">
      <h1 className="mr-px text-xl leading-6 font-bold">{planFor(board.day!.date)}</h1>
      <div role="tablist" aria-label="Board" className="order-last flex h-[26px] w-full overflow-hidden rounded-full border bg-card lg:order-none lg:w-auto">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={t.value === tab}
            data-shown={t.value === tab}
            data-working={t.value === working}
            onClick={() => onTab(t.value)}
            className={cn(
              'flex-1 px-3 text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 lg:flex-none',
              'max-lg:data-[shown=true]:bg-secondary max-lg:data-[shown=true]:text-secondary-foreground lg:data-[working=true]:bg-secondary lg:data-[working=true]:text-secondary-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <SaveStatus screen={screen} />
      {board.counts && <Counts counts={board.counts} />}
      <div className="flex w-full flex-wrap items-center justify-end gap-2.5">
        {screen.saving === 'refused' && screen.refused && <Refused message={screen.refused} onRetry={retry} />}
        {stale && screen.saving !== 'refused' && (
          <p role="status" className="mr-auto flex items-center gap-3 rounded-[10px] bg-warn-tint px-3 py-[7px] text-xs leading-[15px] font-semibold text-warn-ink">
            Could not update. This may be out of date.
            <button type="button" className="underline underline-offset-2 disabled:opacity-50" disabled={refreshing} onClick={onRefresh}>Try again</button>
          </p>
        )}
        <HistoryButton icon={Undo2} verb="Undo" line={screen.history.undo} onPress={onUndo} />
        <HistoryButton icon={Redo2} verb="Redo" line={screen.history.redo} onPress={onRedo} />
        {editable(board) && (
          <Button variant="outline" className={plainButton('h-8 px-3.5 text-[13px]')} onClick={() => setAsking(true)}>
            <RotateCcw aria-hidden="true" className="size-3.5" /> Start over
          </Button>
        )}
        <label className="flex h-8 cursor-pointer items-center gap-2.5 rounded-[10px] bg-card pr-3 pl-3 shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
          <Switch.Root
            checked={draft.mixBrands}
            onCheckedChange={(on) => change(setMixBrands(draft, on), { line: `Mix brands turned ${on ? 'on' : 'off'}`, tripKey: null })}
            className="relative flex h-5 w-9 shrink-0 items-center rounded-full bg-border p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-secondary"
          >
            <Switch.Thumb className="size-4 rounded-full bg-card shadow-sm ring-1 ring-foreground/5 transition-transform data-checked:translate-x-4" />
          </Switch.Root>
          <span className="text-xs font-semibold">Mix brands · {draft.mixBrands ? 'on' : 'off'}</span>
        </label>
        <Button variant="secondary" className={inkButton('h-8 w-[120px] text-[13px]')} disabled={!hasPlan} focusableWhenDisabled onClick={onViewPlan}>View plan</Button>
      </div>
      {/* Start over asks in the app first, never with the browser's box (spec 027). */}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="gap-3.5 rounded-lg p-5 sm:max-w-sm">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle className="text-base leading-5 font-bold">Start over?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-[18px] text-muted-foreground">{START_OVER_LINE(board.day!.date)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="-mx-5 -mb-5 rounded-b-lg px-5 py-3.5">
            <AlertDialogCancel className={plainButton('h-10 px-5 text-[13px]')}>Keep the plan</AlertDialogCancel>
            <Button className={inkButton('h-10 px-5 text-[13px]')} onClick={() => { onStartOver(); setAsking(false); }}>Start over</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

// Undo or Redo (spec 027): an icon button named by the change it would undo or redo, also in its tooltip, and off with
// nothing to do. Off is the app's disabled look and Base UI's disabled button, which ignores presses; it stays
// focusable (as View plan does) so the tooltip can still say "Nothing to undo" (L-15).
function HistoryButton({ icon: Icon, verb, line, onPress }: { icon: typeof Undo2; verb: 'Undo' | 'Redo'; line: string | null; onPress: () => void }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<Button variant="outline" disabled={line === null} focusableWhenDisabled />}
        aria-label={line ? `${verb}: ${line}` : verb}
        onClick={onPress}
        className={plainButton('size-8 p-0 text-foreground data-disabled:hover:bg-card')}
      >
        <Icon aria-hidden="true" className="size-4" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="z-50">
          <Tooltip.Popup className="max-w-72 rounded-md bg-secondary px-2.5 py-1.5 text-xs leading-[15px] text-secondary-foreground shadow-md">{historyTip(verb, line)}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// Whether the draft is saved (spec 010, "Saving and after"): the time it was, or that a change is on its way.
function SaveStatus({ screen }: { screen: BoardScreen }) {
  const { board } = screen;
  const line = 'text-[11px] leading-[15px] font-semibold lg:ml-2.5';
  if (screen.saving === 'saving') return <span role="status" className={cn(line, 'text-muted-foreground')}>Saving…</span>;
  if (screen.saving === 'retrying') return <Tag role="status" tone="warn" className="lg:ml-2.5">Not saved · trying again</Tag>;
  if (screen.saving === 'refused') return <Tag role="status" tone="bad" className="lg:ml-2.5">Not saved</Tag>;
  if (board.plan.savedAt) return <Tag role="status" tone="warn" className="lg:ml-2.5">Draft saved {clockTime(board.plan.savedAt)} · not sent</Tag>;
  return <span className={line}>Orders closed {clockTime(board.day!.cutoffAt)} · no plan yet</span>;
}

// A refusal in the server's words, with Try again, which sends the same changes once more.
function Refused({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="mr-auto flex max-w-2xl items-center gap-3 rounded-[10px] bg-bad-tint px-3 py-[7px] text-xs leading-[15px] font-semibold text-bad">
      {message}
      <button type="button" className="shrink-0 underline underline-offset-2" onClick={onRetry}>Try again</button>
    </p>
  );
}

// The counts of rule 12, as the API sent them: "0 / 35 trucks", "0 trips", "0 / 102 orders", "37% fuel this
// week", "0 / 140.7 m³ fridge space".
function Counts({ counts }: { counts: BoardCounts }) {
  const items: [string, string][] = [
    [`${whole(counts.vehiclesUsed)} / ${whole(counts.vehiclesWorking)}`, 'trucks'],
    [whole(counts.trips), counts.trips === 1 ? 'trip' : 'trips'],
    [`${whole(counts.ordersOnTrips)} / ${whole(counts.ordersDue)}`, 'orders'],
    [`${figure(counts.fuelWeekPct)}%`, 'fuel this week'],
    [`${space(counts.fridgeM3Used)} / ${space(counts.fridgeM3Working)}`, 'm³ fridge space'],
  ];
  return (
    <dl className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 lg:ml-2.5">
      {items.map(([number, label]) => (
        <div key={label} className="flex items-baseline gap-[5px] whitespace-nowrap">
          <dt className="sr-only">{label}</dt>
          <dd className="font-mono text-sm leading-[18px] font-bold">{number}</dd>
          <span aria-hidden="true" className="text-[11px] leading-[14px] text-muted-foreground">{label}</span>
        </div>
      ))}
    </dl>
  );
}
