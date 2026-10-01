import { useState, type ReactNode, type RefObject } from 'react';
import { reasonOf } from '@/features/store/words';
import { useCrews, type BoardScreen } from '../board';
import type { CrewRef } from '../draft';
import { crewRows, pickOrders, type Pick } from './crews';
import type { BoardIndex } from './lookup';
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from './ui';

// The crew picker (spec 026, AC-1): a dropdown of the depot's crews, a truck and its driver each, read from the API for
// the trip's orders and listed in the read's order, with the same look and keys as the driver menu. It opens from its
// trigger ("Start a trip", "Swap truck"), or, for an order dropped in the empty middle, at the drop area with no
// trigger: Escape or a click outside closes it and starts nothing. A crew in the workshop or on two trips is greyed.
export function CrewMenu({ screen, index, pick, title, onPick, trigger, triggerClassName, anchor, open: shown, onOpenChange }: {
  screen: BoardScreen;
  index: BoardIndex;
  pick: Pick;
  // The popup's heading: "Start a trip · Fresh · Galle", "Swap truck".
  title: string;
  onPick: (crew: CrewRef) => void;
  // A trigger's words and look, or, with none, the element it opens at and whether it is open.
  trigger?: ReactNode;
  triggerClassName?: string;
  anchor?: RefObject<Element | null>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = shown ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      {trigger !== undefined && <MenuTrigger className={triggerClassName}>{trigger}</MenuTrigger>}
      <MenuPopup align="start" anchor={anchor} className="max-h-96 w-80">
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-[14px] font-semibold text-muted-foreground">{title}</p>
        {open && <CrewRows screen={screen} index={index} pick={pick} onPick={onPick} />}
      </MenuPopup>
    </MenuRoot>
  );
}

// The rows, read when the picker opens. While the read is out it says so, and a failed read says why with Try again.
function CrewRows({ screen, index, pick, onPick }: { screen: BoardScreen; index: BoardIndex; pick: Pick; onPick: (crew: CrewRef) => void }) {
  const { board, draft } = screen;
  const orderIds = pickOrders(pick, draft, index).map((order) => order.id);
  const crews = useCrews(board.day!.date, orderIds, true);
  if (crews.isError) {
    return (
      <div role="alert" className="px-2.5 py-1.5 text-xs leading-[15px]">
        <p className="font-semibold text-bad">Could not load the crews</p>
        <p className="mt-1 text-muted-foreground">{reasonOf(crews.error)}</p>
        <MenuItem closeOnClick={false} className="mt-1.5 justify-center border" onClick={() => { void crews.refetch(); }}>Try again</MenuItem>
      </div>
    );
  }
  if (!crews.data) return <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">Finding crews…</p>;
  return crewRows(crews.data, pick, draft, index).map((row) => (
    <MenuItem key={row.vehicleId} disabled={row.disabled} className="block" onClick={() => onPick({ vehicleId: row.vehicleId, driverId: row.driverId })}>
      <span className="block text-[13px] leading-4 font-semibold">{row.title}</span>
      <span className="mt-0.5 block text-[11px] leading-[14px] text-muted-foreground">{row.line}</span>
      {row.warning && <span className="mt-0.5 block text-[11px] leading-[14px] font-semibold text-warn-ink">{row.warning}</span>}
    </MenuItem>
  ));
}
