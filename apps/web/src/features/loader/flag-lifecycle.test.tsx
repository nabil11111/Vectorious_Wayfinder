import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { LoadingDay, LoadingTruck } from '@wayfinder/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlagPage } from './FlagPage';

// A mounted hook/tree harness, with keyed instances and unmount cleanup. It retains hook state on rerender
// and drives the actual form handlers; network, router and presentation primitives are stand-ins.
const state = vi.hoisted(() => ({
  day: undefined as unknown as LoadingDay, owner: 'loader-a', depot: 'Peliyagoda', run: 1,
  frame: '', slot: 0, changed: false, seen: new Set<string>(), slots: new Map<string, unknown[]>(),
  effects: [] as (() => void)[], cleanups: new Map<string, (() => void)[]>(),
  predicate: undefined as undefined | ((args: unknown) => boolean), blocked: false, destination: '', navigated: [] as string[],
  send: vi.fn(), discard: undefined as undefined | { open: boolean; onKeep: () => void; onDiscard: () => void },
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const slot = (initial: () => unknown) => {
    const slots = state.slots.get(state.frame)!;
    const index = state.slot++;
    if (index >= slots.length) slots[index] = initial();
    return { slots, index };
  };
  return { ...react,
    useState: (initial: unknown) => {
      const { slots, index } = slot(() => typeof initial === 'function' ? initial() : initial);
      return [slots[index], (next: unknown) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
        state.changed = true;
      }];
    },
    useRef: (initial: unknown) => { const { slots, index } = slot(() => ({ current: initial })); return slots[index]; },
    useId: () => 'count-fix',
    useEffect: (effect: () => void | (() => void)) => {
      const frame = state.frame;
      state.effects.push(() => {
        const cleanup = effect();
        if (cleanup) state.cleanups.set(frame, [...(state.cleanups.get(frame) ?? []), cleanup]);
      });
    },
  };
});
vi.mock('./loading', () => ({ useLoadingDay: () => ({ data: state.day, isError: false }),
  useLoaderWrites: () => ({ phase: 'idle', out: null, refused: null, send: state.send, holding: () => false }) }));
vi.mock('@/features/auth/api', () => ({
  useMe: () => ({ data: { id: state.owner, depotId: state.depot } }),
  useLogout: () => ({ isError: false }), askBeforeSignOut: () => () => {},
}));
vi.mock('@/lib/clock', () => ({ useAppClock: () => ({ state: { day: state.run } }) }));
vi.mock('./ticks', () => ({ useTicks: () => ({ isTicked: () => false }) }));
vi.mock('@/components/ui/button', () => ({ Button: 'button', buttonVariants: () => '' }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: 'span' }));
vi.mock('@/lib/dirty-form', async (original) => ({ ...await original<typeof import('@/lib/dirty-form')>(),
  DiscardDraft: (props: NonNullable<typeof state.discard>) => { state.discard = props; return null; },
}));
vi.mock('./parts/ui', () => ({ Card: 'section', ActionBar: 'footer', TickBox: 'span',
  Refused: 'p', LeaveUnsent: 'p', NotSaved: 'p', SendingFirst: 'p' }));
vi.mock('react-router', () => ({
  Link: 'a', useParams: () => ({ tripId: 'trip' }), useSearchParams: () => [new URLSearchParams('stop=stop')],
  useNavigate: () => (to: string) => {
    const args = { currentLocation: { pathname: '/loader/trucks/trip/flag', search: '?stop=stop' }, nextLocation: { pathname: to, search: '' } };
    if (state.predicate?.(args)) { state.blocked = true; state.destination = to; }
    else state.navigated.push(to);
  },
  Navigate: ({ to }: { to: string }) => { state.navigated.push(to); return null; },
  useBlocker: (predicate: typeof state.predicate) => {
    state.predicate = predicate;
    return { state: state.blocked ? 'blocked' : 'unblocked', reset: () => { state.blocked = false; },
      proceed: () => { state.navigated.push(state.destination); state.blocked = false; } };
  },
}));

const truck = (): LoadingTruck => ({ tripId: 'trip', revision: 2, vehicleId: 'VEH038', vehicleType: 'van', vehicleTemp: 'ambient',
  tripNo: 1, brand: 'Fresh', district: 'Colombo', status: 'loading', leavesAt: '2026-06-24T23:06:00.000Z', readyAt: null,
  driver: 'Dilshan', weightCapKg: 1200, volumeCapM3: 9, units: 14, on: { units: 0, kg: 0, m3: 0 }, short: 0, wontFit: 0, outOn: null, issues: [],
  stops: [{ id: 'stop', seq: 1, outletId: 'OUT001', shopName: 'Fresh Nugegoda', loaded: false, units: 14, going: 14, short: 0, wontFit: 0,
    lines: [12, 2].map((quantity, index) => ({ lineId: `line-${index}`, orderId: 'order', temp: 'dry', productId: `product-${index}`,
      name: `Dry ${index}`, unit: 'carton', quantity, going: quantity, short: 0, wontFit: 0 })) }],
});
type Host = ReactElement<Record<string, unknown>>;
let hosts: Host[] = [];
function render(node: ReactNode, path = 'root'): void {
  if (Array.isArray(node)) { node.forEach((child, index) => render(child, `${path}/${index}`)); return; }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  const id = `${path}:${String(node.key ?? '')}:${typeof node.type === 'function' ? node.type.name : String(node.type)}`;
  if (typeof node.type === 'function') {
    state.seen.add(id);
    if (!state.slots.has(id)) state.slots.set(id, []);
    const previous = state.frame;
    const previousSlot = state.slot;
    state.frame = id; state.slot = 0;
    const result = (node.type as (props: unknown) => ReactNode)(node.props);
    state.frame = previous; state.slot = previousSlot;
    render(result, id);
  } else {
    hosts.push(node);
    render(node.props.children as ReactNode, id);
  }
}
function draw() {
  for (let pass = 0; pass < 10; pass++) {
    state.changed = false; state.seen.clear(); hosts = []; state.discard = undefined;
    render(<FlagPage />);
    for (const key of state.slots.keys()) if (!state.seen.has(key)) {
      state.cleanups.get(key)?.forEach((cleanup) => cleanup());
      state.cleanups.delete(key); state.slots.delete(key);
    }
    state.effects.splice(0).forEach((effect) => effect());
    if (!state.changed) return;
  }
  throw new Error('The mounted form did not settle.');
}
const find = (type: string, matches: (props: Host['props']) => boolean = () => true) => {
  const node = hosts.find((host) => host.type === type && matches(host.props));
  expect(node, `Missing ${type}`).toBeDefined(); return node!.props;
};
const press = (props: Host['props']) => { (props.onClick as () => void)(); draw(); };
function enterDraft(invalid = true) {
  draw();
  press(find('button', (props) => props['aria-pressed'] === false));
  (find('input').onChange as (event: unknown) => void)({ currentTarget: { value: '4' } }); draw();
  press(find('button', (props) => props.role === 'radio' && props.children === 'Damaged'));
  (find('textarea').onChange as (event: unknown) => void)({ target: { value: 'Keep this dock report' } }); draw();
  if (invalid) {
    press(find('button', (props) => props['aria-pressed'] === false));
    (find('input').onChange as (event: unknown) => void)({ currentTarget: { value: '-' } }); draw();
  }
}
function retained() {
  expect(find('textarea').value).toBe('Keep this dock report');
  expect(find('button', (props) => props.role === 'radio' && props.children === 'Damaged')['aria-checked']).toBe(true);
  expect(find('input').value).toBe('-');
  // The other line's lowered count is still in the rendered quantity journey.
  expect(hosts.some((host) => Array.isArray(host.props.children) && host.props.children[0] === '4')).toBe(true);
}
beforeEach(() => {
  state.day = { depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: null, trucks: [truck()], left: [] };
  state.owner = 'loader-a'; state.depot = 'Peliyagoda'; state.run = 1;
  state.slots.clear(); state.cleanups.clear(); state.effects = []; state.blocked = false; state.navigated = []; state.send.mockClear();
  vi.stubGlobal('window', new EventTarget());
});
describe('mounted loader report during background loading changes', () => {
  it.each(['ready', 'missing', 'stop removed', 'lines changed', 'day moved'] as const)('retains the entire draft when %s and asks before explicit leave', (change) => {
    enterDraft();
    if (change === 'ready') state.day.trucks = [{ ...truck(), status: 'ready' }];
    if (change === 'missing') state.day.trucks = [];
    if (change === 'stop removed') state.day.trucks = [{ ...truck(), stops: [] }];
    if (change === 'lines changed') state.day.trucks[0]!.stops[0]!.lines = [];
    if (change === 'day moved') state.day.day = '2026-06-26';
    draw(); retained(); expect(state.navigated).toEqual([]);
    press(find('button', (props) => props.children === 'Leave report'));
    expect(state.discard?.open).toBe(true);
    state.discard!.onKeep(); draw(); retained(); expect(state.navigated).toEqual([]);
    press(find('button', (props) => props.children === 'Leave report'));
    state.discard!.onDiscard(); draw(); expect(state.navigated).toEqual(['/loader']);
  });
  it('blocks even a stale send handler after the truck becomes ready', () => {
    enterDraft(false);
    const send = find('button', (props) => props.children === 'Send to dispatcher');
    expect(send.disabled).toBe(false);
    state.day.trucks = [{ ...truck(), status: 'ready' }]; draw();
    const stale = find('button', (props) => props.children === 'Send to dispatcher');
    expect(stale.disabled).toBe(true); (stale.onClick as () => void)(); expect(state.send).not.toHaveBeenCalled();
  });
  it.each(['account', 'depot', 'reset'] as const)('clears unsent fields on a changed %s scope', (change) => {
    enterDraft();
    if (change === 'account') state.owner = 'loader-b';
    if (change === 'depot') { state.depot = 'Kandy'; state.day.depot = 'Kandy'; }
    if (change === 'reset') { state.run = 2; state.day.demoDay = 2; }
    draw();
    expect(find('textarea').value).toBe('');
    expect(hosts.filter((host) => host.type === 'input')).toHaveLength(0);
    expect(find('button', (props) => props.role === 'radio' && props.children === 'Short')['aria-checked']).toBe(true);
  });
});
