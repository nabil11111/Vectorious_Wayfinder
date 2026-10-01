import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanBoardPage } from '@/features/plan/PlanBoardPage';
import { ViewPlanPage } from '@/features/plan/ViewPlanPage';
import { ON_BOTH, RUWAN } from '@/features/dispatcher/both-days.test-data';
import { PICK_A_DEPOT, PickDepot } from './PickDepot';

// The plan board and View plan on both depots together (spec 021, AC-6, D-96): a plan belongs to one depot, so each
// asks which depot to plan, with Peliyagoda and Kandy, and reads no board at all (the server refuses a plan route on
// Both). Pressing a depot switches to it, where the page shows that depot's board; the switch itself, its loading state
// and its failure are spec 020's. On one depot the pages read and show their board as before.

const held = vi.hoisted(() => ({ me: undefined as unknown, choose: vi.fn(), mocked: false }));
vi.mock('@/features/auth/api', async (original) => ({ ...await original<typeof import('@/features/auth/api')>(), useMe: () => ({ data: held.me }) }));
vi.mock('../depots', async (original) => {
  const actual = await original<typeof import('../depots')>();
  return { ...actual, useSwitchDepot: (depot: string) => (held.mocked ? { chosen: depot, switching: false, choose: held.choose } : actual.useSwitchDepot(depot)) };
});
vi.mock('sonner', () => ({ toast: vi.fn() }));
afterEach(() => { held.choose.mockReset(); held.mocked = false; });

function page(me: Me, path: string) {
  held.me = me;
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/dispatcher/plan" element={<PlanBoardPage />} /><Route path="/dispatcher/plan/:date" element={<ViewPlanPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const reads = client.getQueryCache().getAll().map((query) => query.queryKey);
  client.clear();
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), reads };
}
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(([, name]) => name);

it('AC-6 on both depots the plan board asks for a depot to plan, with Peliyagoda and Kandy, and reads no board', () => {
  expect(PICK_A_DEPOT).toBe('A plan belongs to one depot. Pick the depot to plan:');
  const board = page(ON_BOTH, '/dispatcher/plan');
  expect(board.text).toBe(`Plan board ${PICK_A_DEPOT} Peliyagoda Kandy`);
  expect(buttons(board.html)).toEqual(['Peliyagoda', 'Kandy']);
  expect(board.reads).toEqual([]);
});

it('AC-6 on both depots View plan asks the same for its day, and reads no plan', () => {
  const view = page(ON_BOTH, '/dispatcher/plan/2026-06-25');
  expect(view.text).toBe(`View plan · Thu 25 Jun ${PICK_A_DEPOT} Peliyagoda Kandy`);
  expect(buttons(view.html)).toEqual(['Peliyagoda', 'Kandy']);
  expect(view.reads).toEqual([]);
});

it('AC-6 on one depot the plan board and View plan read their board as before', () => {
  // The board's own drawing keeps its draft in a store a server drawing cannot read, so here its page is asked which
  // body it draws: the board's, not the picker.
  held.me = RUWAN;
  const board = PlanBoardPage() as ReactElement;
  expect(board.type).not.toBe(PickDepot);
  expect((board.type as { name: string }).name).toBe('OneDepotBoard');
  const view = page(RUWAN, '/dispatcher/plan/2026-06-25');
  expect(view.html).toContain('aria-label="Loading the plan"');
  expect(view.reads).toContainEqual(['plans', '2026-06-25']);
});

// The elements a drawing holds, without drawing the components inside it.
function elementsOf(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node as ReactElement<{ children?: ReactNode; onClick?: () => void }>, ...elementsOf(node.props.children)];
}

it('AC-6 pressing a depot switches to it, through the same switch as the top bar\'s', () => {
  held.me = ON_BOTH;
  held.mocked = true;
  const press = (name: string) => elementsOf(PickDepot({ title: 'Plan board' })).find((element) => element.props.children === name)!.props.onClick!();
  press('Kandy');
  expect(held.choose).toHaveBeenCalledWith('Kandy');
  press('Peliyagoda');
  expect(held.choose).toHaveBeenLastCalledWith('Peliyagoda');
});
