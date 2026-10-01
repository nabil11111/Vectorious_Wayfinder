import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { Active, ClientRect, DroppableContainer, DroppableContainers, Over, UniqueIdentifier } from '@dnd-kit/core';
import { PlanBoard, type DraftTrip } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { placesOf, planOf } from '../draft';
import { BuildPanel } from './BuildPanel';
import { DoneList } from './DoneList';
import { announcements, BoardChange, boardKeyboardCoordinates, dropLocked, landDrop, landingCollision, putBack } from './dragging';
import type { Dragged, DropData, Landing } from './drops';
import { indexOf } from './lookup';
import { OrderLists } from './OrderLists';
import { TripPanel } from './TripPanel';

// Spec 023's drag and drop as the board draws and runs it: grips on the unplanned orders and a handle on each stop
// while the board can change (AC-6), the empty middle's drop area (AC-4), a finished drag made into its change (AC-1,
// AC-3), each step said in words for a screen reader and the keyboard's moves (AC-6), and a card's own Undo line
// (AC-5). The board is made up: VEH035 runs Fresh Nugegoda and Fresh Wellawatte, VEH002 Fresh Galle Fort, and Fresh
// Dehiwala is unplanned.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [NUGEGODA, WELLAWATTE, GALLE, DEHIWALA] = [uuid(1), uuid(2), uuid(51), uuid(5)] as [string, string, string, string];
const shop = (id: string, name: string, district: string) => ({
  id, name, brand: 'Fresh', district, dockType: 'street', parking: 'normal', windowOpen: 180, windowClose: 480, mallOpen: null, mallClose: null, unloadMin: 15,
});
const order = (id: string, outletId: string) => ({
  id, outletId, temp: 'chilled', deliveryDate: '2026-06-25', lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
  carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null,
});
const TRIPS: DraftTrip[] = [
  { vehicleId: 'VEH035', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT001', orderIds: [NUGEGODA] }, { outletId: 'OUT002', orderIds: [WELLAWATTE] }] },
  { vehicleId: 'VEH002', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT051', orderIds: [GALLE] }] },
];
const boardWith = (trips: DraftTrip[]) => PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips, deferrals: [], id: uuid(100), revision: 3, status: 'draft', savedAt: '2026-06-24T10:31:00.000Z', sentAt: null, canUnsend: false },
  dropped: [], check: null, orders: [order(NUGEGODA, 'OUT001'), order(WELLAWATTE, 'OUT002'), order(GALLE, 'OUT051'), order(DEHIWALA, 'OUT005')],
  shops: [shop('OUT001', 'Fresh Nugegoda', 'Colombo'), shop('OUT002', 'Fresh Wellawatte', 'Colombo'), shop('OUT005', 'Fresh Dehiwala', 'Colombo'), shop('OUT051', 'Fresh Galle Fort', 'Galle')],
  vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});
const BOARD = boardWith(TRIPS);
const INDEX = indexOf(BOARD);
const screenOf = (board: PlanBoard, change: Partial<BoardScreen> = {}): BoardScreen => ({ board, draft: planOf(board), saving: 'saved', refused: null, acting: false, undo: null, ...change });

const orderLists = (screen: BoardScreen, open: DraftTrip | null = null) => renderToStaticMarkup(
  <OrderLists screen={screen} index={INDEX} places={placesOf(screen.draft)} open={open} outlined={null} change={() => undefined} onStartTrip={() => undefined} onFindSlot={() => undefined} onJoin={() => undefined} />,
);
const tripPanel = (screen: BoardScreen) => renderToStaticMarkup(
  <TripPanel
    screen={screen} index={INDEX} trip={screen.draft.trips[0]!} group={null}
    change={() => undefined} act={async () => null} onSwap={() => undefined} onRemoved={() => undefined} onDone={() => undefined} onAddStop={() => undefined} onJoin={() => undefined}
  />,
);
// Each draggable's handle by its name: "draggable" for an order, "sortable" for a stop in its list.
const handles = (markup: string) => [...markup.matchAll(/<button type="button"[^>]*aria-roledescription="(?:draggable|sortable)"[^>]*>/g)].map(([button]) => button.match(/aria-label="([^"]*)"/)?.[1]);

it('spec 023 AC-6 gives every unplanned order, shop and group a grip, and each stop its number as a handle', () => {
  expect(handles(orderLists(screenOf(BOARD)))).toEqual(['Move Fresh · Colombo', 'Move Fresh Dehiwala']);
  expect(handles(tripPanel(screenOf(BOARD)))).toEqual(['Move stop 1, Fresh Nugegoda', 'Move stop 2, Fresh Wellawatte']);
});

it('spec 023 AC-6 lets nothing be dragged while the board holds still or the plan cannot change', () => {
  const holding = screenOf(BOARD, { acting: true });
  expect(handles(orderLists(holding))).toEqual([]);
  expect(handles(tripPanel(holding))).toEqual([]);
  const sent = boardWith(TRIPS);
  const published = { ...sent, plan: { ...sent.plan, status: 'published' as const } };
  expect(handles(orderLists(screenOf(published)))).toEqual([]);
  expect(handles(tripPanel(screenOf(published)))).toEqual([]);
  // The stop's number stays as it was.
  expect(tripPanel(holding)).toMatch(/<span class="[^"]*rounded-full[^"]*">1<\/span>/);
});

it('spec 023 AC-4 the empty middle offers the build and a drop area in place of "Start a blank trip"', () => {
  const empty = boardWith([]);
  const markup = renderToStaticMarkup(<MemoryRouter><BuildPanel screen={screenOf(empty)} act={async () => null} onBuilding={() => undefined} /></MemoryRouter>);
  expect(markup).toContain('>Build the suggested plan</button>');
  expect(markup).toContain('or drag an order here to start a trip');
  expect(markup).not.toContain('Start a blank trip');
});

const dehiwala: Dragged = { kind: 'orders', orders: [BOARD.orders[3]!], group: { brand: 'Fresh', district: 'Colombo' }, label: 'Fresh Dehiwala', detail: '12 cartons chilled' };
const stopTwo: Landing = { kind: 'stops', tripKey: 'VEH035-1', at: 1 };

it('spec 023 AC-1 makes a finished drag its change of the draft, with its Undo, or opens the truck picker', () => {
  const change = vi.fn();
  const start = vi.fn();
  landDrop(planOf(BOARD), dehiwala, stopTwo, { change, start });
  expect(change).toHaveBeenCalledOnce();
  const [plan, undo] = change.mock.calls[0]!;
  expect(plan.trips[0].stops.map((s: { outletId: string }) => s.outletId)).toEqual(['OUT001', 'OUT005', 'OUT002']);
  expect(undo).toMatchObject({ line: 'Fresh Dehiwala added to VEH035', tripKey: 'VEH035-1' });
  landDrop(planOf(BOARD), dehiwala, { kind: 'middle' }, { change, start });
  expect(start).toHaveBeenCalledWith({ kind: 'start', group: dehiwala.group, orders: dehiwala.orders, startWith: dehiwala.orders, dropped: 'Fresh Dehiwala' });
  // Put back, or dropped where it cannot land: nothing happens.
  landDrop(planOf(BOARD), dehiwala, undefined, { change, start });
  landDrop(planOf(BOARD), dehiwala, { kind: 'unplanned' }, { change, start });
  expect(change).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
});

// dnd-kit's own records of what is dragged and what it is over.
const active = (dragged: Dragged) => ({ id: 'drag', data: { current: { dragged } } }) as unknown as Active;
const over = (landing: Landing, name: string) => ({ id: name, data: { current: { landing, name } satisfies DropData } }) as unknown as Over;

it('spec 023 AC-6 says each step of a drag in words', () => {
  expect(announcements.onDragStart({ active: active(dehiwala) })).toBe('Picked up Fresh Dehiwala. Move it with the arrow keys, drop it with Space or Enter, or press Escape to put it back.');
  expect(announcements.onDragOver({ active: active(dehiwala), over: over(stopTwo, 'stop 2 of VEH035') })).toBe('Fresh Dehiwala is over stop 2 of VEH035.');
  expect(announcements.onDragOver({ active: active(dehiwala), over: over({ kind: 'unplanned' }, 'Unplanned orders') })).toBe('Fresh Dehiwala cannot go on Unplanned orders.');
  expect(announcements.onDragOver({ active: active(dehiwala), over: null })).toBe('Fresh Dehiwala is over no place to drop it.');
  expect(announcements.onDragEnd({ active: active(dehiwala), over: over(stopTwo, 'stop 2 of VEH035') })).toBe('Fresh Dehiwala dropped on stop 2 of VEH035.');
  expect(announcements.onDragEnd({ active: active(dehiwala), over: null })).toBe('Fresh Dehiwala put back.');
  expect(announcements.onDragCancel({ active: active(dehiwala), over: over(stopTwo, 'stop 2 of VEH035') })).toBe('Fresh Dehiwala put back.');
});

// Places to land, side by side as the board lays them out: Unplanned orders on the left, the middle, then two cards
// in Done, one under the other.
const rect = (left: number, top: number, width = 200, height = 60): ClientRect => ({ left, top, width, height, right: left + width, bottom: top + height });
const PLACES: [UniqueIdentifier, ClientRect][] = [['unplanned', rect(0, 0, 300, 800)], ['middle', rect(400, 300)], ['card:VEH035-1', rect(900, 100)], ['card:VEH002-1', rect(900, 200)]];
const containers = PLACES.map(([id]) => ({ id, key: id, disabled: false, data: { current: undefined }, node: { current: null }, rect: { current: null } }) as DroppableContainer);
const droppableContainers = Object.assign(new Map(containers.map((c) => [c.id, c])), { getEnabled: () => containers, toArray: () => containers, getNodeFor: () => undefined }) as unknown as DroppableContainers;
const press = (code: string, at: ClientRect, overId: UniqueIdentifier | null) => boardKeyboardCoordinates({ code, preventDefault: () => undefined } as unknown as KeyboardEvent, {
  active: 'order:dehiwala', currentCoordinates: { x: at.left, y: at.top },
  context: {
    active: active(dehiwala), collisionRect: at, droppableRects: new Map(PLACES), droppableContainers,
    over: overId === null ? null : ({ id: overId } as Over),
  } as never,
});

it('spec 023 AC-6 moves a picked-up order with the arrow keys to the next place it can land that way', () => {
  // From its row in Unplanned orders, right goes to the middle, then to the nearer card, and down to the next card.
  expect(press('ArrowRight', rect(20, 300), 'unplanned')).toEqual({ x: 400, y: 300 });
  expect(press('ArrowRight', rect(400, 300), 'middle')).toEqual({ x: 900, y: 200 });
  expect(press('ArrowUp', rect(900, 200), 'card:VEH002-1')).toEqual({ x: 900, y: 100 });
  expect(press('ArrowDown', rect(900, 100), 'card:VEH035-1')).toEqual({ x: 900, y: 200 });
  // Nowhere further that way, and any other key, moves nothing.
  expect(press('ArrowRight', rect(900, 200), 'card:VEH002-1')).toBeUndefined();
  expect(press('KeyA', rect(20, 300), 'unplanned')).toBeUndefined();
});

// The open trip's stops, one under the other: stop 1 with its split form open, so its row is 300 tall, then stops 2
// and 3 at 40 each.
const STOPS: [UniqueIdentifier, ClientRect][] = [['stop:VEH035-1:OUT001', rect(0, 0, 500, 300)], ['stop:VEH035-1:OUT002', rect(0, 300, 500, 40)], ['stop:VEH035-1:OUT003', rect(0, 340, 500, 40)]];
const stopContainers = STOPS.map(([id]) => ({ id, key: id, disabled: false, data: { current: undefined }, node: { current: null }, rect: { current: null } }) as DroppableContainer);
const stopMap = Object.assign(new Map(stopContainers.map((c) => [c.id, c])), { getEnabled: () => stopContainers, toArray: () => stopContainers, getNodeFor: () => undefined }) as unknown as DroppableContainers;
const tallStop = { id: 'stop:VEH035-1:OUT001', data: { current: { dragged: { kind: 'stop', tripKey: 'VEH035-1', index: 0, label: 'Fresh Nugegoda', brand: 'Fresh' } } } } as unknown as Active;

it('spec 023 AC-6 moves a picked-up stop past a shorter one with Down, where its own row is taller, and lands it there', () => {
  const at = rect(0, 0, 500, 300);
  const moved = boardKeyboardCoordinates({ code: 'ArrowDown', preventDefault: () => undefined } as unknown as KeyboardEvent, {
    active: tallStop.id, currentCoordinates: { x: 0, y: 0 },
    context: { active: tallStop, collisionRect: at, droppableRects: new Map(STOPS), droppableContainers: stopMap, over: { id: tallStop.id } as Over } as never,
  });
  // The tall row is centred on stop 2, so the collision the board takes after the move picks stop 2, not stop 1 again.
  expect(moved).toEqual({ x: 0, y: 170 });
  const collisions = landingCollision({ active: tallStop, collisionRect: rect(moved!.x, moved!.y, 500, 300), droppableRects: new Map(STOPS), droppableContainers: stopContainers, pointerCoordinates: null });
  expect(collisions[0]?.id).toBe('stop:VEH035-1:OUT002');
});

it('spec 023 AC-6 cancels a drop that lands while the board holds still, and puts back a drag in hand when it starts holding', () => {
  expect(dropLocked(screenOf(BOARD))).toBe(false);
  expect(dropLocked(screenOf(BOARD, { acting: true }))).toBe(true);
  const sent = boardWith(TRIPS);
  expect(dropLocked(screenOf({ ...sent, plan: { ...sent.plan, status: 'published' } }))).toBe(true);
  // Put back as Escape does: both of dnd-kit's sensors cancel on it, on the page's document.
  class Key extends Event { code: string; key: string; constructor(type: string, init: KeyboardEventInit) { super(type, init); this.code = init.code ?? ''; this.key = init.key ?? ''; } }
  vi.stubGlobal('KeyboardEvent', Key);
  try {
    const page = new EventTarget();
    const heard: { code: string; bubbles: boolean }[] = [];
    page.addEventListener('keydown', (event) => heard.push({ code: (event as Key).code, bubbles: event.bubbles }));
    putBack(page);
    expect(heard).toEqual([{ code: 'Escape', bubbles: true }]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('spec 023 AC-5 shows the Undo line of a drop on a trip\'s card in that card', () => {
  const plan = planOf(BOARD);
  const screen = screenOf(BOARD, { undo: { before: plan, line: 'Fresh Dehiwala added to VEH002', tripKey: 'VEH002-1', seq: 1, revision: 4 } });
  const markup = renderToStaticMarkup(<BoardChange.Provider value={() => undefined}><DoneList screen={screen} index={INDEX} openKey="VEH035-1" onOpen={() => undefined} /></BoardChange.Provider>);
  expect(markup).toMatch(/<div role="status"[^>]*><p[^>]*>Fresh Dehiwala added to VEH002<\/p><button[^>]*>Undo<\/button><\/div>/);
});
