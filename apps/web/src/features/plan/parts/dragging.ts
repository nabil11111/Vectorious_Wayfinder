import { createContext, type KeyboardEvent, type PointerEvent } from 'react';
import {
  closestCenter, closestCorners, getFirstCollision, KeyboardCode, pointerWithin, useDroppable,
  type Active, type Announcements, type CollisionDetection, type DraggableSyntheticListeners, type KeyboardCoordinateGetter, type Over, type ScreenReaderInstructions,
} from '@dnd-kit/core';
import type { DraftPlan } from '@wayfinder/contracts';
import { editable, type BoardScreen, type Undo } from '../board';
import { canLand, dropOf, type Called, type Dragged, type DragData, type DropData, type Landing } from './drops';
import type { Pick } from './PickTruck';

// How the plan board's drag and drop runs with dnd-kit (spec 023, D-98): what can move, how a finished drag becomes
// its change, the keyboard's moves, the words a screen reader hears, and how a place to land shows. What each drop
// changes is drops.ts's.

// Something can be dragged while the board can change: its day open, its plan a draft, and no split, join, send or
// build on its way (rule 4).
export const movable = (screen: BoardScreen) => editable(screen.board) && !screen.acting;

// A drop that lands while the board holds still, or once its plan cannot change, is cancelled: dnd-kit says it was put
// back, and nothing changes (rule 4).
export const dropLocked = (screen: BoardScreen) => !movable(screen);

// Puts back the drag in hand, as Escape does: both of dnd-kit's sensors, the pointer's and the keyboard's, cancel on an
// Escape keydown on the page.
export function putBack(page: EventTarget) {
  page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

// The board's change, for a part that shows a drop's Undo line without a change of its own to call: a card in Done.
export const BoardChange = createContext<((next: DraftPlan, undo?: Undo) => void) | null>(null);

export const draggedOf = (active: Active | null) => (active?.data.current as DragData | undefined)?.dragged;

// The pointer's handler for a row that can be dragged: a press in a field inside it (the split or defer form) types or
// picks there and starts no drag.
export const pressOf = (listeners: DraggableSyntheticListeners) => (event: PointerEvent<HTMLElement>) => {
  if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
  listeners?.onPointerDown?.(event);
};

// The keyboard's handler for a handle: Space or Enter on it picks the row up.
export const keysOf = (listeners: DraggableSyntheticListeners) => (event: KeyboardEvent<HTMLElement>) => {
  listeners?.onKeyDown?.(event);
};
export const landingOf = (over: Over | null) => (over?.data.current as DropData | undefined)?.landing;

// A finished drag: its change of the draft with its Undo, or the truck picker. Put back, or dropped where it cannot go
// or where it changes nothing, it does nothing.
export function landDrop(plan: DraftPlan, dragged: Dragged | undefined, landing: Landing | undefined, apply: {
  change: (next: DraftPlan, undo: Undo) => void;
  start: (pick: Pick) => void;
  called: Called;
}) {
  if (!dragged || !landing) return;
  const drop = dropOf(plan, dragged, landing, apply.called);
  if (drop?.kind === 'change') apply.change(drop.plan, drop.undo);
  else if (drop?.kind === 'start') apply.start(drop.pick);
}

// The place under the pointer. The keyboard has no pointer, so it takes the place nearest to where it moved the drag.
export const landingCollision: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args));

const ARROWS: string[] = [KeyboardCode.Down, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Left];

// The arrow keys move a picked-up order or stop to the nearest place to land in the arrow's direction: the next stop
// along the list, a trip's card, Unplanned orders. The drag is centred on that place, so the collision the board then
// takes (the closest centre) picks the same place, however tall the dragged row is, such as a stop with its split form
// open.
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, collisionRect, droppableRects, droppableContainers, over } = args.context;
  if (!ARROWS.includes(event.code)) return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;
  const ahead = droppableContainers.getEnabled().filter((entry) => {
    const rect = droppableRects.get(entry.id);
    if (!rect) return false;
    if (event.code === KeyboardCode.Down) return collisionRect.top < rect.top;
    if (event.code === KeyboardCode.Up) return collisionRect.top > rect.top;
    if (event.code === KeyboardCode.Right) return collisionRect.left < rect.left;
    return collisionRect.left > rect.left;
  });
  const collisions = closestCorners({ active, collisionRect, droppableRects, droppableContainers: ahead, pointerCoordinates: null });
  let id = getFirstCollision(collisions, 'id');
  if (id === over?.id && collisions.length > 1) id = collisions[1]!.id;
  const rect = id == null ? undefined : droppableRects.get(id);
  return rect ? { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top + (rect.height - collisionRect.height) / 2 } : undefined;
};

// Each step of a drag in words, for a screen reader.
const placeOf = (over: Over | null) => over?.data.current as DropData | undefined;
export const announcements: Announcements = {
  onDragStart: ({ active }) => {
    const dragged = draggedOf(active);
    return dragged && `Picked up ${dragged.label}. Move it with the arrow keys, drop it with Space or Enter, or press Escape to put it back.`;
  },
  onDragOver: ({ active, over }) => {
    const dragged = draggedOf(active);
    const place = placeOf(over);
    if (!dragged) return undefined;
    if (!place) return `${dragged.label} is over no place to drop it.`;
    return canLand(dragged, place.landing) ? `${dragged.label} is over ${place.name}.` : `${dragged.label} cannot go on ${place.name}.`;
  },
  onDragEnd: ({ active, over }) => {
    const dragged = draggedOf(active);
    const place = placeOf(over);
    if (!dragged) return undefined;
    return place && canLand(dragged, place.landing) ? `${dragged.label} dropped on ${place.name}.` : `${dragged.label} put back.`;
  },
  onDragCancel: ({ active }) => {
    const dragged = draggedOf(active);
    return dragged && `${dragged.label} put back.`;
  },
};

export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: 'To pick up an order or a stop, press Space or Enter. Move it with the arrow keys onto a trip\'s stops, a trip\'s card in Done or Unplanned orders, then press Space or Enter to drop it, or Escape to put it back.',
};

// How a place to land shows while something is dragged: outlined when it can take it, and filled with the brand's
// light tint while it is under the drag, teal for Fresh as the board's Fresh chips are.
export function landingLook(dragged: Dragged | undefined, landing: Landing, over: boolean) {
  if (!dragged || !canLand(dragged, landing)) return '';
  const fresh = (dragged.kind === 'orders' ? dragged.group.brand : dragged.brand) === 'Fresh';
  if (!over) return 'outline-2 outline-dashed -outline-offset-2 outline-foreground/20';
  return fresh ? 'outline-2 outline-dashed -outline-offset-2 outline-good bg-good-tint' : 'outline-2 outline-dashed -outline-offset-2 outline-foreground/40 bg-muted';
}

// A place to land: its node, and how it looks now.
export function useLanding(id: string, landing: Landing, name: string) {
  const { setNodeRef, isOver, active } = useDroppable({ id, data: { landing, name } satisfies DropData });
  return { setNodeRef, look: landingLook(draggedOf(active), landing, isOver) };
}
