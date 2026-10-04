import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { Issue, Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { clockKey } from '@/lib/clock';
import { IssueCard } from './IssueCard';
import { issuesKeyOf } from './issues';

// Retain keyed React hook state and run effect cleanup while driving the real card, viewer and click handlers.
// DOM focus/scroll and query observers are stand-ins; the byte requests and owner subscriptions are real.
const mounted = vi.hoisted(() => ({ frame: '', slot: 0, changed: false, qc: undefined as unknown,
  seen: new Set<string>(), slots: new Map<string, unknown[]>(), effects: [] as (() => void)[],
  cleanups: new Map<string, Map<number, () => void>>() }));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const slot = (initial: () => unknown) => {
    const values = mounted.slots.get(mounted.frame)!;
    const index = mounted.slot++;
    if (index >= values.length) values[index] = initial();
    return { values, index };
  };
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return { ...react,
    useState: (initial: unknown) => {
      const { values, index } = slot(() => typeof initial === 'function' ? initial() : initial);
      return [values[index], (next: unknown) => { values[index] = typeof next === 'function' ? next(values[index]) : next; mounted.changed = true; }];
    },
    useRef: (initial: unknown) => { const { values, index } = slot(() => ({ current: initial })); return values[index]; },
    useMemo: (factory: () => unknown, deps: unknown[]) => {
      const { values, index } = slot(() => ({ deps: undefined, value: undefined }));
      const held = values[index] as { deps?: unknown[]; value: unknown };
      if (!same(held.deps, deps)) { held.deps = deps; held.value = factory(); }
      return held.value;
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const { values, index } = slot(() => undefined);
      const frame = mounted.frame;
      if (same(values[index] as unknown[], deps)) return;
      values[index] = deps;
      mounted.effects.push(() => {
        mounted.cleanups.get(frame)?.get(index)?.();
        const cleanup = effect();
        if (!mounted.cleanups.has(frame)) mounted.cleanups.set(frame, new Map());
        if (cleanup) mounted.cleanups.get(frame)!.set(index, cleanup);
        else mounted.cleanups.get(frame)!.delete(index);
      });
    },
  };
});
vi.mock('@tanstack/react-query', async (original) => ({ ...await original<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => mounted.qc,
  useQuery: ({ queryKey, select }: { queryKey: readonly unknown[]; select?: (data: unknown) => unknown }) => {
    const data = (mounted.qc as QueryClient).getQueryData(queryKey);
    return { data: data && select ? select(data) : data };
  },
}));
vi.mock('@/components/ui/button', () => ({ Button: 'button', buttonVariants: () => '' }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: 'span' }));
vi.mock('@/features/lookup/parts/ui', () => ({ CloseButton: ({ label, onClick }: { label: string; onClick: () => void }) => <button aria-label={label} onClick={onClick}>Close</button> }));

const ME: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const issue = (kind: 'receipt' | 'refused'): Issue => ({
  id: 'problem-1', revision: 0, kind, reason: 'damaged', status: 'open', raisedBy: 'Malinda', raisedAt: '2026-06-25T03:26:00.000Z',
  note: 'One carton damaged', decision: null, decidedBy: null, decidedAt: null, hasPhoto: true, short: 1, cold: null, replacement: null,
  trip: { id: 'trip', vehicleId: 'VEH001', tripNo: 1, leavesAt: '2026-06-24T23:00:00.000Z', status: 'out', driver: 'Saman', stopsLeft: 1 },
  stop: { id: 'stop', seq: 1, outletId: 'OUT001', shopName: 'Fresh Nugegoda', arrivedAt: null, doneAt: null, loadedAt: null, flaggedAtDock: false },
  lines: [{ lineId: 'line', orderId: 'order', temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', quantity: 6, counted: 5, loaded: 6, delivered: 6, received: 5, reason: 'damaged' }],
});
type Host = ReactElement<Record<string, unknown>>;
let hosts: Host[];
let elements: Map<string, FakeElement>;
class FakeElement {
  focus = vi.fn(() => { (document as unknown as { activeElement: unknown }).activeElement = this; });
  scrollIntoView = vi.fn();
}
let qc: QueryClient;
let release: (response: Response) => void;
const decide = vi.fn();
function render(node: ReactNode, path = 'root'): void {
  if (Array.isArray(node)) { node.forEach((child, i) => render(child, `${path}/${i}`)); return; }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  const id = `${path}:${String(node.key ?? '')}:${typeof node.type === 'function' ? node.type.name : String(node.type)}`;
  if (typeof node.type === 'function') {
    mounted.seen.add(id);
    if (!mounted.slots.has(id)) mounted.slots.set(id, []);
    const previous = mounted.frame; const index = mounted.slot;
    mounted.frame = id; mounted.slot = 0;
    const result = (node.type as (props: unknown) => ReactNode)(node.props);
    mounted.frame = previous; mounted.slot = index;
    render(result, id);
  } else {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    const ref = node.props.ref as { current: unknown } | undefined;
    if (ref) ref.current = elements.get(id);
    hosts.push({ ...node, props: { ...node.props, element: elements.get(id) } });
    render(node.props.children as ReactNode, id);
  }
}
function draw(value: Issue | null, depot = 'Peliyagoda') {
  for (let pass = 0; pass < 10; pass++) {
    mounted.changed = false; mounted.seen.clear(); hosts = [];
    render(value && <IssueCard issue={value} depot={depot} answering={{ sending: null, failed: null, refused: null, sent: null, decide }} time />);
    for (const key of mounted.slots.keys()) if (!mounted.seen.has(key)) {
      mounted.cleanups.get(key)?.forEach((cleanup) => cleanup());
      mounted.cleanups.delete(key); mounted.slots.delete(key);
    }
    mounted.effects.splice(0).forEach((effect) => effect());
    if (!mounted.changed) return;
  }
  throw new Error('The mounted card did not settle.');
}
const find = (match: (props: Host['props']) => boolean) => {
  const host = hosts.find((node) => match(node.props));
  expect(host).toBeDefined();
  return host!.props;
};
function click(props: Host['props']) { (props.element as FakeElement).focus(); (props.onClick as () => void)(); }
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  qc = new QueryClient(); mounted.qc = qc;
  qc.setQueryData(meKey, ME); qc.setQueryData(clockKey, { day: 1 });
  qc.setQueryData(issuesKeyOf('Peliyagoda'), { issues: [], replaceOn: '2026-06-26' });
  mounted.slots.clear(); mounted.cleanups.clear(); mounted.effects = []; elements = new Map(); decide.mockClear();
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { requestAnimationFrame: (callback: () => void) => callback() }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => { draw(null); qc.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['receipt', 'refused'] as const)('retains a %s answer through loading, retry, Escape and Close, restoring the photo trigger focus', async (kind) => {
  const value = issue(kind); draw(value);
  const lastRadio = hosts.filter((node) => node.props.role === 'radio').at(-1)!.props;
  click(lastRadio); draw(value);
  const picked = hosts.filter((node) => node.props.role === 'radio').at(-1)!.props;
  expect(picked['aria-checked']).toBe(true);
  const trigger = find((props) => props.children === 'View photo');
  click(trigger); draw(value);
  expect(find((props) => props['aria-label'] === 'Loading the photo')).toBeDefined();
  const region = find((props) => String(props['aria-label']).startsWith('Photo ·'));
  expect(document.activeElement).toBe(region.element);
  release(Response.json({ error: { code: 'unavailable', message: 'Try later.' } }, { status: 503 }));
  await settled(); draw(value);
  click(find((props) => props.children === 'Try again')); draw(value);
  release(new Response(new Blob(['image'], { type: 'image/jpeg' }))); await settled(); draw(value);
  expect(hosts.some((host) => host.type === 'img' && host.props.src === 'blob:photo')).toBe(true);
  const stopPropagation = vi.fn();
  (find((props) => String(props['aria-label']).startsWith('Photo ·')).onKeyDown as (event: unknown) => void)({ key: 'Escape', stopPropagation });
  draw(value);
  expect(stopPropagation).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(trigger.element);
  expect(hosts.some((host) => String(host.props['aria-label']).startsWith('Photo ·'))).toBe(false);
  click(find((props) => props.children === 'View photo')); draw(value);
  click(find((props) => props['aria-label'] === 'Close the photo')); draw(value);
  expect(document.activeElement).toBe(trigger.element);
  expect(hosts.filter((node) => node.props.role === 'radio').at(-1)!.props['aria-checked']).toBe(true);
  click(find((props) => props.children === (kind === 'receipt' ? 'Send to shop' : 'Send to driver and shop')));
  expect(decide).toHaveBeenCalledWith(value, kind === 'receipt' ? 'no_replacement' : 'send_replacements');
});

it.each(['account', 'depot', 'reset', 'replacement', 'unmount'] as const)('cleans up the mounted viewer on %s and cannot show a late photo', async (change) => {
  const value = issue('receipt'); draw(value);
  click(find((props) => props.children === 'View photo')); draw(value);
  const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal as AbortSignal;
  if (change === 'account') qc.setQueryData(meKey, { ...ME, id: 'u2' });
  if (change === 'depot') qc.setQueryData(meKey, { ...ME, depotId: 'Kandy' });
  if (change === 'reset') qc.setQueryData(clockKey, { day: 2 });
  draw(change === 'unmount' ? null : change === 'replacement' ? { ...value, id: 'problem-2' } : value, change === 'depot' ? 'Kandy' : 'Peliyagoda');
  expect(signal.aborted).toBe(true);
  release(new Response(new Blob(['old image']))); await settled();
  draw(change === 'unmount' ? null : change === 'replacement' ? { ...value, id: 'problem-2' } : value, change === 'depot' ? 'Kandy' : 'Peliyagoda');
  expect(hosts.some((host) => host.props.src === 'blob:photo')).toBe(false);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
