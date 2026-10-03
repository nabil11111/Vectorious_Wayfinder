import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlanBoard } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it, vi } from 'vitest';
import { boardKey, dayKey } from './board';
import { ViewPlanPage } from './ViewPlanPage';

// Q-19: once a truck starts loading, a sent plan can no longer go back to edit (spec 012, rule 3), and View plan says
// so where "Back to edit" was, in the server's own sentence, whatever day the board is on by then. View plan is drawn
// from the day's board and the board on show, as the server would draw it. These fixtures live in the test only.

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useSyncExternalStore: <T,>(subscribe: (change: () => void) => () => void, snapshot: () => T, serverSnapshot?: () => T) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot ?? snapshot) };
});

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

function viewPlan(day: PlanBoard, current: PlanBoard): string {
  const qc = new QueryClient();
  qc.setQueryData(dayKey(THU), day);
  qc.setQueryData(boardKey, current);
  const router = createMemoryRouter([{ path: '/dispatcher/plan/:date', element: <ViewPlanPage /> }], { initialEntries: [`/dispatcher/plan/${THU}`] });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

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
