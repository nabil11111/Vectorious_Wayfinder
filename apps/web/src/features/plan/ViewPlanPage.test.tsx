import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me, PlanBoard } from '@wayfinder/contracts';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { nameDepot } from '@/lib/api';
import { boardKey, dayKey } from './board';
import { ViewPlanPage } from './ViewPlanPage';

// Q-19: once a truck starts loading, a sent plan can no longer go back to edit (spec 012, rule 3), and View plan says
// so where "Back to edit" was, in the server's own sentence, whatever day the board is on by then. View plan is drawn
// from the day's board and the board on show, as the server would draw it. These fixtures live in the test only.

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react,
    useState: (initial: unknown) => {
      const value = held.busy && initial === null ? (held.busy = false, 'unsend') : initial;
      const [state, set] = react.useState(value);
      return [state, (next: unknown) => { held.updates.push(next); set(next); }];
    },
    useSyncExternalStore: <T,>(subscribe: (change: () => void) => () => void, snapshot: () => T, serverSnapshot?: () => T) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot ?? snapshot),
  };
});
const held = vi.hoisted(() => ({ busy: false, updates: [] as unknown[], withdraw: null as null | (() => void), navigate: vi.fn() }));
vi.mock('react-router', async original => ({ ...await original<typeof import('react-router')>(), useNavigate: () => held.navigate }));
vi.mock('@/components/ui/button', async original => {
  const lib = await original<typeof import('@/components/ui/button')>();
  return { ...lib, Button: (props: ComponentProps<typeof lib.Button>) => {
    if (props.children === 'Withdraw plan and edit') held.withdraw = () => props.onClick?.({} as never);
    return <lib.Button {...props} />;
  } };
});
afterEach(() => { held.busy = false; held.updates = []; held.withdraw = null; held.navigate.mockClear(); vi.unstubAllGlobals(); });

const THU = '2026-06-25';
const FRI = '2026-06-26';
const LOCKED = 'Loading has started, so this plan cannot go back to edit.';

const MOVED = 'Trucks for Thu 25 Jun leave from 03:30, so its plan can no longer go back to edit.';

// Thursday's plan, sent at Wed 16:36, as the board answers for a date: it can go back to edit, or the server says why
// it cannot.
function sentThursday(canUnsend: boolean, lockedReason: string | null = canUnsend ? null : LOCKED): PlanBoard {
  return {
    depot: 'Peliyagoda', demoDay: 1, day: { date: THU, cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
    plan: { mixBrands: false, trips: [], deferrals: [], id: '0c000000-0000-4000-8000-000000000001', revision: 3, status: 'published', savedAt: '2026-06-24T11:05:00.000Z', sentAt: '2026-06-24T11:06:00.000Z', canUnsend, lockedReason },
    dropped: [], check: null, orders: [], shops: [], vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
  };
}
// The board on show, which is the day being planned: Thursday until Thu 03:30, then Friday.
const onShow = (date: string): PlanBoard => ({ ...sentThursday(false), day: { date, cutoffAt: '2026-06-24T10:30:00.000Z', open: true } });

function drawPlan(day: PlanBoard, current: PlanBoard) {
  const qc = new QueryClient();
  const me: Me = { id: '1f0c2c55-6a39-4d55-9d1e-0c8f3f6c0a01', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
  qc.setQueryData(meKey, me); nameDepot('Peliyagoda');
  qc.setQueryData(dayKey(THU), day);
  qc.setQueryData(boardKey, current);
  const router = createMemoryRouter([{ path: '/dispatcher/plan/:date', element: <ViewPlanPage /> }], { initialEntries: [`/dispatcher/plan/${THU}`] });
  const html = renderToStaticMarkup(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return { html, qc, router };
}
const viewPlan = (day: PlanBoard, current: PlanBoard) => drawPlan(day, current).html;

it('Q-19 says loading has started where "Back to edit" was, once a truck of the sent plan is loading', () => {
  const html = viewPlan(sentThursday(false), onShow(THU));
  expect(html).toContain(LOCKED);
  expect(html).not.toContain('Back to edit');
  expect(html).toContain('✓ Sent');
});

it('U4 names withdrawal and explains its effect while no truck has started', () => {
  const html = viewPlan(sentThursday(true), onShow(THU));
  expect(html).toContain('Withdraw plan and edit');
  expect(html).toContain('Takes this plan back from loaders and drivers until you send it again.');
  expect(html).not.toContain(LOCKED);
});

it('U4 draft Back to edit remains a navigation action without withdrawal wording', () => {
  const draft = sentThursday(true); draft.plan.status = 'draft'; draft.plan.sentAt = null;
  const html = viewPlan(draft, onShow(THU));
  expect(html).toContain('← Back to edit');
  expect(html).not.toContain('Withdraw plan');
  expect(html).not.toContain('Takes this plan back');
});

it('Q-19 still says loading has started once the board has moved past the plan\'s day, as Thursday\'s look back did not', () => {
  const html = viewPlan(sentThursday(false), onShow(FRI));
  expect(html).toContain(LOCKED);
  expect(html).not.toContain('Back to edit');
});

it('Q-19 says why a sent plan no truck loaded cannot go back to edit once its day has left the board', () => {
  const html = viewPlan(sentThursday(false, MOVED), onShow(FRI));
  expect(html).toContain(MOVED);
  expect(html).not.toContain(LOCKED);
  expect(html).not.toContain('Back to edit');
});

it('U4 withdrawal uses the existing unsend write and opens edit only after it succeeds', async () => {
  const board = sentThursday(true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...board, plan: { ...board.plan, status: 'draft' } }), { status: 200 })));
  drawPlan(board, onShow(THU)); held.withdraw!();
  await vi.waitFor(() => expect(held.navigate).toHaveBeenCalledWith('/dispatcher/plan'));
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(url).toBe(`/api/v1/plans/${THU}/unsend`);
  expect(JSON.parse(String(init!.body))).toEqual({ planId: board.plan.id, revision: 3 });
});
it('U5 a server withdrawal refusal stays on View plan and reaches its visible error state', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'started', message: LOCKED } }), { status: 409 })));
  const shown = drawPlan(sentThursday(true), onShow(THU)); held.withdraw!();
  await vi.waitFor(() => expect(held.updates).toContain(LOCKED));
  expect(shown.router.state.location.pathname).toBe(`/dispatcher/plan/${THU}`);
  expect(held.navigate).not.toHaveBeenCalled();
});
it('U5 a late withdrawal response for the previous depot cannot navigate the new owner', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const board = sentThursday(true); const shown = drawPlan(board, onShow(THU)); held.withdraw!();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  shown.qc.setQueryData(meKey, { ...shown.qc.getQueryData<Me>(meKey)!, depotId: 'Kandy' });
  finish(new Response(JSON.stringify({ ...board, plan: { ...board.plan, status: 'draft' } }), { status: 200 }));
  await vi.waitFor(() => expect(held.updates.filter(value => value === null).length).toBeGreaterThanOrEqual(3));
  expect(shown.router.state.location.pathname).toBe(`/dispatcher/plan/${THU}`);
  expect(held.navigate).not.toHaveBeenCalled();
});
it('U4 withdrawing has explicit busy wording and a disabled action', () => {
  held.busy = true;
  const html = viewPlan(sentThursday(true), onShow(THU));
  expect(html).toContain('Withdrawing…');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Withdrawing/);
});
