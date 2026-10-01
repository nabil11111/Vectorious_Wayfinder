import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { DispatcherHome } from './DispatcherHome';
import { switchDepotMutation } from './depots';

// The dispatcher's area while a depot switch is on its way (spec 020, AC-6, the Switching state): the pressed depot
// shows chosen at once, and the loading state stands in place of the page until the switch answers, so no page shows
// the depot before under a switch that says the depot pressed. A switch that fails brings the page back as it was. The
// shell and the dashboard are stand-ins: the shell draws its bar and the page, and the dashboard shows the read it holds.

// What the shell was last handed: the page to draw, and the place the line under the name says.
const shell = vi.hoisted(() => ({ children: undefined as unknown, place: undefined as string | undefined }));
vi.mock('sonner', () => ({ toast: vi.fn() }));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ bar, place, children }: { bar?: ReactNode; place?: string; children: ReactNode }) => {
    shell.children = children;
    shell.place = place;
    return <div>{bar}<main>{children}</main></div>;
  },
}));
vi.mock('@/features/live/Bell', () => ({ Bell: () => null }));
vi.mock('./DashboardPage', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  return {
    DashboardPage: function DashboardPage() {
      const { data } = useQuery<{ orders: number }>({ queryKey: ['operations', 'u1', 'Peliyagoda'], enabled: false });
      return <p data-page="">{data ? `Peliyagoda · ${data.orders} orders` : 'Loading the day'}</p>;
    },
  };
});
afterEach(() => vi.unstubAllGlobals());

const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };

function screenOf() {
  const qc = new QueryClient();
  qc.setQueryData(meKey, RUWAN);
  qc.setQueryData(['operations', 'u1', 'Peliyagoda'], { orders: 102 });
  return qc;
}
const drawn = (qc: QueryClient) => renderToStaticMarkup(
  <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={['/dispatcher']}>
      <Routes><Route path="/dispatcher/*" element={<DispatcherHome />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);
// The top bar's depot shown chosen.
const chosen = (markup: string) => markup.match(/<button[^>]*aria-pressed="true"[^>]*>([^<]+)<\/button>/)?.[1];
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
// The key of the element that holds the routed page: a new key is a new page, with nothing of the one before.
function pageKey(qc: QueryClient) {
  drawn(qc);
  const parts = (Array.isArray(shell.children) ? shell.children : [shell.children]) as unknown[];
  const page = parts.find((part): part is ReactElement<{ hidden?: boolean }> => isValidElement(part) && (part.props as { hidden?: boolean }).hidden !== undefined);
  return page?.key ?? null;
}

it('AC-7 the line under the name says the depot, and Dispatcher · Both depots on both together', () => {
  drawn(screenOf());
  expect(shell.place).toBe('Peliyagoda');
  const qc = screenOf();
  qc.setQueryData(meKey, { ...RUWAN, depotId: 'Both' });
  const markup = drawn(qc);
  expect(shell.place).toBe('Both depots');
  expect(chosen(markup)).toBe('Both');
});

it('AC-7 a pending switch to Both shows the loading state for both depots, with Both chosen', async () => {
  const qc = screenOf();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  void new MutationObserver(qc, switchDepotMutation(qc)).mutate('Both');
  await settled();
  const markup = drawn(qc);
  expect(chosen(markup)).toBe('Both');
  expect(markup).toMatch(/<main><div role="status" aria-label="Switching to both depots"/);
  expect(markup).toMatch(/<div hidden="" class="contents"><p data-page="">Peliyagoda · 102 orders<\/p><\/div>/);
});

it('AC-6 the page shows as it is with no switch on its way', () => {
  const markup = drawn(screenOf());
  expect(markup).toContain('<p data-page="">Peliyagoda · 102 orders</p>');
  expect(markup).not.toMatch(/<div hidden=""/);
  expect(markup).not.toContain('Switching to');
  expect(chosen(markup)).toBe('Peliyagoda');
});

it('AC-6 a pending switch shows the loading state instead of the page, with the depot pressed chosen', async () => {
  const qc = screenOf();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  void new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy');
  await settled();

  const markup = drawn(qc);
  expect(chosen(markup)).toBe('Kandy');
  expect(markup).toMatch(/<main><div role="status" aria-label="Switching to Kandy"/);
  // The page stays as it was but hidden, so Peliyagoda's day shows under no switch that says Kandy.
  expect(markup).toMatch(/<div hidden="" class="contents"><p data-page="">Peliyagoda · 102 orders<\/p><\/div>/);
});

it('AC-6 once the switch goes through, the page comes back with its own loading state and nothing read before', async () => {
  const qc = screenOf();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} removeEventListener() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...RUWAN, depotId: 'Kandy' })));
  await new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy');

  const markup = drawn(qc);
  expect(chosen(markup)).toBe('Kandy');
  expect(markup).not.toContain('Switching to');
  expect(markup).toContain('<div class="contents"><p data-page="">Loading the day</p></div>');
  vi.restoreAllMocks();
});

it('AC-6 a failed switch brings the same page back, as it was before the press', async () => {
  const qc = screenOf();
  const before = drawn(qc);
  let fail: (error: Error) => void = () => undefined;
  // The switch gets no answer when told, and the session, read after it, is still on Peliyagoda.
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/auth/me')
    ? Promise.resolve(Response.json(RUWAN))
    : new Promise<Response>((_, reject) => { fail = reject; }))));
  const going = new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy').catch((error: unknown) => error);
  await settled();
  const pending = drawn(qc);
  expect(pending).toContain('aria-label="Switching to Kandy"');
  expect(pending).toMatch(/<div hidden=""[^>]*><p data-page="">/);

  fail(new TypeError('Failed to fetch'));
  expect(await going).toBeInstanceOf(TypeError);
  expect(drawn(qc)).toBe(before);
});

it('AC-6 the routed page belongs to the depot on show: the same page through a pending or failed switch, a new one after it goes through', async () => {
  const qc = screenOf();
  expect(pageKey(qc)).toBe('Peliyagoda');

  let fail: (error: Error) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/auth/me')
    ? Promise.resolve(Response.json(RUWAN))
    : new Promise<Response>((_, reject) => { fail = reject; }))));
  const failing = new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy').catch((error: unknown) => error);
  await settled();
  expect(pageKey(qc)).toBe('Peliyagoda');
  fail(new TypeError('Failed to fetch'));
  await failing;
  expect(pageKey(qc)).toBe('Peliyagoda');

  // Live day's answered problem, a selection or an open card: none of the page before stays once the switch goes through.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} removeEventListener() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...RUWAN, depotId: 'Kandy' })));
  await new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy');
  expect(pageKey(qc)).toBe('Kandy');
  vi.restoreAllMocks();
});
