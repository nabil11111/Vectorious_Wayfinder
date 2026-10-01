import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ON_BOTH, RUWAN, THU } from '@/test/both-days';
import { ViewPlanLink } from './ViewPlanLink';

// View plan on a line of one depot (spec 021): on both depots together a plan belongs to one depot, so the button
// switches to that line's depot and opens its View plan; on one depot it is the plain link it always was. The switch
// itself, its loading state and its failure are spec 020's, tested with the switch.

const held = vi.hoisted(() => ({ me: undefined as unknown, navigate: vi.fn(), choose: vi.fn() }));
vi.mock('@/features/auth/api', async (original) => ({ ...await original<typeof import('@/features/auth/api')>(), useMe: () => ({ data: held.me }) }));
vi.mock('react-router', async (original) => ({ ...await original<typeof import('react-router')>(), useNavigate: () => held.navigate }));
vi.mock('../depots', () => ({ useSwitchDepot: () => ({ chosen: 'Both', switching: false, choose: held.choose }) }));
afterEach(() => { held.navigate.mockReset(); held.choose.mockReset(); });

it('AC-5 on both depots View plan switches to its line\'s depot and opens that depot\'s View plan', () => {
  held.me = ON_BOTH;
  const button = ViewPlanLink({ date: THU, depot: 'Kandy', className: 'plan' }) as ReactElement<{ onClick: () => void }>;
  expect(renderToStaticMarkup(button)).toBe('<button type="button" class="plan">View plan</button>');
  button.props.onClick();
  expect(held.navigate).toHaveBeenCalledWith('/dispatcher/plan/2026-06-25');
  expect(held.choose).toHaveBeenCalledWith('Kandy');
});

it('AC-5 on one depot View plan is the link it was, and switches nothing', () => {
  held.me = RUWAN;
  const markup = renderToStaticMarkup(<MemoryRouter><ViewPlanLink date={THU} depot="Peliyagoda" className="plan" /></MemoryRouter>);
  expect(markup).toBe('<a class="plan" href="/dispatcher/plan/2026-06-25" data-discover="true">View plan</a>');
  expect(held.choose).not.toHaveBeenCalled();
});
