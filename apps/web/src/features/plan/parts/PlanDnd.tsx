import { useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import type { DraftPlan } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import type { BoardScreen, Undo } from '../board';
import {
  announcements, BoardChange, boardKeyboardCoordinates, draggedOf, keysOf, landDrop, landingCollision, landingOf, pressOf, screenReaderInstructions,
} from './dragging';
import type { Dragged, DragData } from './drops';
import type { Pick } from './PickTruck';

// The plan board's drag and drop (spec 023): the board's columns inside one drag context. The pointer picks a row up
// once it has moved a few pixels, so a click and the rows' menus work as before, and the keyboard picks it up from its
// handle with Space or Enter. A finished drag is the change its button makes, sent through the board's own change
// with its Undo, and an order dropped in the empty middle opens the truck picker.
export function PlanDnd({ screen, change, onStartTrip, children }: {
  screen: BoardScreen;
  change: (next: DraftPlan, undo?: Undo) => void;
  onStartTrip: (pick: Pick) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );
  const [dragged, setDragged] = useState<Dragged | null>(null);
  return (
    <BoardChange.Provider value={change}>
      <DndContext
        sensors={sensors}
        collisionDetection={landingCollision}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={({ active }) => setDragged(draggedOf(active) ?? null)}
        onDragCancel={() => setDragged(null)}
        onDragEnd={({ active, over }) => {
          setDragged(null);
          landDrop(screen.draft, draggedOf(active), landingOf(over), { change, start: onStartTrip });
        }}
      >
        {children}
        <DragOverlay dropAnimation={null}>{dragged && <DragCard dragged={dragged} />}</DragOverlay>
      </DndContext>
    </BoardChange.Provider>
  );
}

// The small card that follows the pointer, naming what is dragged.
function DragCard({ dragged }: { dragged: Dragged }) {
  return (
    <div className="w-60 cursor-grabbing rounded-[10px] bg-card px-3 py-2 shadow-lg ring-1 ring-foreground/10">
      <p className="truncate text-xs leading-[15px] font-semibold">{dragged.kind === 'stop' ? `Stop ${dragged.index + 1} · ${dragged.label}` : dragged.label}</p>
      {dragged.kind === 'orders' && <p className="mt-0.5 truncate text-[11px] leading-[14px] text-muted-foreground">{dragged.detail}</p>}
    </div>
  );
}

// An unplanned row that can be dragged: by the pointer from anywhere on it, and by the keyboard from its grip, which
// shows on hover and on focus at the row's left edge. While nothing can move (movable false) it has no grip.
export function DragRow({ id, dragged, movable, children }: { id: string; dragged: Dragged; movable: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id, data: { dragged } satisfies DragData, disabled: !movable });
  return (
    <div ref={setNodeRef} onPointerDown={pressOf(listeners)} className={cn('group/drag relative', isDragging && 'opacity-40')}>
      {movable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          onKeyDown={keysOf(listeners)}
          aria-label={`Move ${dragged.label}`}
          className="absolute top-1 -left-3.5 flex h-5 w-3.5 cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none group-hover/drag:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}
