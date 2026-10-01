import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BoardScreen } from '../board';
import type { CrewRef } from '../draft';
import { BUILD, BUILDING, buildingLine, KEEP_DRAFT, REPLACE_TITLE, replaceLine } from '../words';
import { buildPlan, suggestionLine, type BuildAct } from './build';
import { CrewMenu } from './CrewMenu';
import type { Pick } from './crews';
import { useLanding } from './dragging';
import { ICON } from './icons';
import type { BoardIndex } from './lookup';
import { orangeButton, plainButton } from './look';

// The empty middle's drop area, in place of "Start a blank trip" (spec 023, with the trucks panel going in spec 026).
const DROP_HERE = 'or drag an order here to start a trip';

// The middle column with no trip open (Edit plan · empty and · building, spec 014): "Build the suggested plan" in
// orange, and beside it, in place of "Start a blank trip", the place to drop an order to start its trip (spec 023).
// Over a draft with a trip or a deferral the build asks first (D-52). While the build is out the column shows Building
// and the board holds still. A refusal shows the server's sentence in red with Try again, and one that loads the board
// again says so in spec 010's line. After a build, the line says when it was suggested and how many of the planner's
// decisions are still to make, while the draft still holds the suggestion (L-18).
export function BuildPanel({ screen, act, onBuilding, index, dropped, onCrew, onDropClose }: {
  screen: BoardScreen;
  act: BuildAct;
  onBuilding: () => void;
  index: BoardIndex;
  // An order dropped here, for which the crew picker opens at the drop area; Escape or a click outside starts nothing.
  dropped: Pick | null;
  onCrew: (pick: Pick, crew: CrewRef) => void;
  onDropClose: () => void;
}) {
  const { board, draft } = screen;
  const [asking, setAsking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const navigate = useNavigate();
  const dropArea = useRef<HTMLParagraphElement>(null);
  // The whole empty middle takes the drop. Its dashed area says so and shows the drag over it.
  const { setNodeRef: middleRef, look: middleLook } = useLanding('middle', { kind: 'middle' }, 'the middle, to start a trip');
  // The suggested plan's line, while the draft holds it (L-18).
  const suggested = suggestionLine(board.suggestion);

  // A build that goes through opens View plan for its day (spec 023). A refused one stays here with its line.
  const build = async () => {
    setAsking(false);
    setRefused(null);
    setBuilding(true);
    onBuilding();
    const problem = await buildPlan(act, (date) => navigate(`/dispatcher/plan/${date}`));
    setBuilding(false);
    setRefused(problem);
  };
  const press = () => {
    if (draft.trips.length > 0 || draft.deferrals.length > 0) setAsking(true);
    else void build();
  };

  // The frames' measures: the route picture at 72, then 14 between it, the title, the bar and the line or buttons.
  if (building) {
    return (
      <div role="status" className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <img src={ICON.route} alt="" className="size-[72px] object-contain" />
        <h2 className="mt-3.5 text-xl leading-6 font-bold">{BUILDING}</h2>
        <MovingBar />
        {board.counts && <p className="mt-3.5 text-[13px] leading-4 text-muted-foreground">{buildingLine(board.counts.ordersDue, board.counts.vehiclesWorking)}</p>}
      </div>
    );
  }
  return (
    <div ref={middleRef} className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <img src={ICON.route} alt="" className="size-[72px] object-contain" />
      <h2 className="mt-3.5 text-xl leading-6 font-bold">No trip open</h2>
      {suggested && (
        <p className="mt-1.5 text-[13px] leading-4 text-muted-foreground">
          {suggested.at} · <span className={suggested.open > 0 ? 'font-semibold text-warn-ink' : undefined}>{suggested.toMake}</span>
        </p>
      )}
      <div className="mt-3.5 flex flex-wrap justify-center gap-2.5">
        <Button className={orangeButton('h-11 px-6 text-sm')} disabled={screen.acting} focusableWhenDisabled onClick={press}>{BUILD}</Button>
        {/* While an order is dragged, the drag's outline takes the place of the area's own dashed line. */}
        <p ref={dropArea} className={cn('flex h-11 items-center rounded-[10px] border-[1.5px] border-dashed px-5 text-sm text-muted-foreground', middleLook ? 'border-transparent' : 'border-mute', middleLook)}>{DROP_HERE}</p>
        {dropped && (
          <CrewMenu
            screen={screen} index={index} pick={dropped} title={`Start a trip · ${dropped.kind === 'start' && dropped.dropped !== undefined ? dropped.dropped : ''}`}
            anchor={dropArea} open onOpenChange={(open) => { if (!open) onDropClose(); }} onPick={(crew) => onCrew(dropped, crew)}
          />
        )}
      </div>
      {refused && (
        <p role="alert" className="mt-4 flex max-w-md items-center gap-3 rounded-[10px] bg-bad-tint px-3 py-[7px] text-left text-xs leading-[15px] font-semibold text-bad">
          {refused}
          <button type="button" className="shrink-0 underline underline-offset-2" onClick={() => { void build(); }}>Try again</button>
        </p>
      )}
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent className="gap-3.5 rounded-lg p-5 sm:max-w-sm">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle className="text-base leading-5 font-bold">{REPLACE_TITLE}</AlertDialogTitle>
            {/* The board's orders, the Done column's trips and the Deferred list's rows: rows the board lists. */}
            <AlertDialogDescription className="text-[13px] leading-[18px] text-muted-foreground">
              {replaceLine(board.orders.length, draft.trips.length, draft.deferrals.length)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="-mx-5 -mb-5 rounded-b-lg px-5 py-3.5">
            <AlertDialogCancel className={plainButton('h-10 px-5 text-[13px]')}>{KEEP_DRAFT}</AlertDialogCancel>
            <Button className={orangeButton('h-10 px-5 text-[13px]')} onClick={() => { void build(); }}>{BUILD}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Edit plan · building's bar. One request has no progress to tell, so the bar moves while it is out (departure 2), and
// holds still where the frame draws it for someone who asked for less motion.
function MovingBar() {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const moving = element.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(160%)' }], { duration: 1400, iterations: Infinity, easing: 'ease-in-out' });
    return () => moving.cancel();
  }, []);
  return (
    <span role="progressbar" aria-label={BUILDING} className="relative mt-3.5 block h-2 w-80 max-w-full overflow-hidden rounded-full bg-border">
      <span ref={bar} className="absolute inset-y-0 left-0 w-[62.5%] rounded-full bg-good" />
    </span>
  );
}
