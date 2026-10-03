import type { BoardOrder, DraftDeferral } from '@wayfinder/contracts';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { placesOf, planOf } from '../draft';
import { OrderLists } from './OrderLists';
import { StopRow } from './StopRow';
import { indexOf } from './lookup';
import { BOARD, id, order } from './usability.fixture';

// Keep the list's three hook slots mounted across actual button handlers; children render through React.
const held = vi.hoisted(() => ({ drawing: false, slot: 0, values: [] as unknown[], buttons: [] as { label: string; disabled?: boolean; click: () => void }[], form: null as null | { orders: BoardOrder[]; code?: string; reason?: string; onDefer: (values: DraftDeferral[]) => void } }));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => {
    if (!held.drawing) return react.useState(initial);
    const slot = held.slot++; if (!(slot in held.values)) held.values[slot] = initial;
    return [held.values[slot], (next: unknown) => { held.values[slot] = next; }];
  } };
});
vi.mock('./dragging', async original => ({ ...await original<typeof import('./dragging')>(), useLanding: () => ({ setNodeRef: () => undefined, look: '' }) }));
vi.mock('./PlanDnd', () => ({ DragRow: ({ children }: { children: ReactNode }) => children }));
vi.mock('./CrewMenu', () => ({ CrewMenu: () => <button>Start a trip</button> }));
vi.mock('@/components/ui/button', async original => {
  const lib = await original<typeof import('@/components/ui/button')>();
  return { ...lib, Button: (props: ComponentProps<typeof lib.Button>) => {
    held.buttons.push({ label: String(props.children), disabled: props.disabled, click: () => props.onClick?.({} as never) });
    return <lib.Button {...props} />;
  } };
});
vi.mock('./DeferForm', async original => {
  const lib = await original<typeof import('./DeferForm')>();
  return { DeferForm: (props: Parameters<typeof lib.DeferForm>[0]) => { held.form = props; return <lib.DeferForm {...props} />; } };
});

function mount(board = BOARD, acting = false) {
  let draft = planOf(board);
  const change = vi.fn(next => { draft = next; });
  const draw = (view?: 'groups' | 'list') => {
    if (view) held.values[0] = view;
    held.buttons = []; held.form = null; held.slot = 0; held.drawing = true;
    const screen: BoardScreen = { board, draft, saving: 'saved', refused: null, acting, undo: null, history: { undo: null, redo: null } };
    const tree = OrderLists({ screen, index: indexOf(board), places: placesOf(draft), open: draft.trips[0] ?? null, outlined: null, change, onCrew: vi.fn(), onFindSlot: vi.fn(), onJoin: vi.fn() });
    held.drawing = false; return renderToStaticMarkup(tree);
  };
  return { draw, change };
}
afterEach(() => { held.values = []; held.drawing = false; held.form = null; held.buttons = []; });

it('U1/U3 grouped and list rows show the same whole-shop summary and visible Defer controls', () => {
  const list = mount();
  for (const view of ['groups', 'list'] as const) {
    const html = list.draw(view);
    expect(html).toContain('4 orders · 1 on trips · 2 waiting · 1 deferred · includes 1 carried over');
    expect(html).toMatch(/<button[^>]*>Defer<\/button>/);
    expect(html).toContain('The reefer is full.'); expect(html).toContain('Edit reason'); expect(html).toContain('>Undo<');
  }
});
it('U3 visible shop/group/carried defer opens the original reason form and commits through the original change', () => {
  const list = mount(); list.draw();
  // First Defer belongs to the carried row and retains the original shop sentence.
  held.buttons.find(button => button.label === 'Defer')!.click();
  expect(list.draw()).toContain('The reefer was full.');
  expect(held.form?.orders.map(o => o.id)).toEqual([id(4)]);
  held.form!.onDefer([{ orderId: id(4), code: 'window', reason: 'The delivery window cannot be met.' }]);
  const html = list.draw();
  expect(html).toContain('4 orders · 1 on trips · 1 waiting · 2 deferred · includes 1 carried over');
  expect(html).toContain('The delivery window cannot be met.');
  // Whole group excludes carried/deferred/on-trip demand, just as before.
  held.buttons.find(button => button.label === 'Defer all 2')!.click(); list.draw();
  expect(held.form?.orders.map(o => o.id)).toEqual([id(2), id(5)]);
  expect(list.change).toHaveBeenCalledTimes(1);
});
it('U3 deferred edit opens its actual code and reason; busy drafts disable visible Defer', () => {
  const list = mount(); list.draw(); held.buttons.find(button => button.label === 'Edit reason')!.click();
  list.draw(); expect(held.form).toMatchObject({ code: 'over_capacity', reason: 'The reefer is full.' });
  const busy = mount(BOARD, true); busy.draw();
  expect(held.buttons.filter(button => button.label.startsWith('Defer')).every(button => button.disabled)).toBe(true);
});
it('U3 a visible shop Defer selects only that shop’s waiting orders', () => {
  const list = mount(); list.draw();
  held.buttons.filter(button => button.label === 'Defer')[1]!.click();
  list.draw(); expect(held.form?.orders.map(o => o.id)).toEqual([id(2)]);
});
it('U3 trip-stop Defer buttons invoke the original per-order callback and honor the drag lock', () => {
  const onDefer = vi.fn(); const orders = BOARD.orders.slice(0, 2);
  const draw = (movable: boolean) => renderToStaticMarkup(<StopRow seq={1} shop={BOARD.shops[0]!} orders={orders} time={null} longWait={false} why={[]} first last
    drag={{ id: 'stop-1', name: 'Fresh Nugegoda', movable, dragged: { kind: 'stop', tripKey: 'VEH004-1', index: 0, label: 'Fresh Nugegoda', brand: 'Fresh' }, landing: { kind: 'stops', tripKey: 'VEH004-1', at: 0 } }}
    onMove={vi.fn()} onTakeStopOff={vi.fn()} onTakeOff={vi.fn()} onSplit={vi.fn()} onJoin={vi.fn()} onDefer={onDefer} />);
  draw(true);
  const actions = held.buttons.filter(button => button.label.startsWith('Defer'));
  expect(actions).toHaveLength(2); actions[1]!.click(); expect(onDefer).toHaveBeenCalledWith(orders[1]);
  held.buttons = []; draw(false);
  expect(held.buttons.every(button => button.disabled)).toBe(true);
});
it('U1 split parts are explicit on available rows in both views', () => {
  const board = { ...BOARD, orders: [order(11, { splitFrom: id(10), originalUnits: 24 }), order(12, { splitFrom: id(10), originalUnits: 24 })],
    plan: { ...BOARD.plan, trips: [{ ...BOARD.plan.trips[0]!, stops: [{ outletId: 'OUT001', orderIds: [id(11)] }] }], deferrals: [] } };
  const list = mount(board);
  for (const view of ['groups', 'list'] as const) expect(list.draw(view)).toContain('2 split parts · 1 on trips · 1 waiting · 0 deferred');
});
