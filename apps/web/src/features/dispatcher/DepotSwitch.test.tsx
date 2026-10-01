import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { DepotSwitch } from './DepotSwitch';
import { switchDepotMutation } from './depots';

// The top bar's depot switch (spec 020, AC-6; spec 021, AC-7) as it is drawn: Peliyagoda, Kandy and Both are buttons
// with the chosen one filled and pressed, a pressed choice shows chosen at once, and a switch that failed shows the
// choice before again.

vi.mock('sonner', () => ({ toast: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };

const drawn = (qc: QueryClient, depot = 'Peliyagoda') => renderToStaticMarkup(<QueryClientProvider client={qc}><DepotSwitch depot={depot} /></QueryClientProvider>);
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, name]) => ({ name, attributes }));
// Each depot button by name, and whether it shows pressed.
const pressed = (markup: string) => buttons(markup).filter((button) => button.attributes.includes('aria-pressed='))
  .map((button) => [button.name, button.attributes.includes('aria-pressed="true"')]);

it('AC-7 Peliyagoda, Kandy and Both are buttons with the chosen one filled and pressed, shown from 1280 wide', () => {
  const markup = drawn(new QueryClient());
  expect(pressed(markup)).toEqual([['Peliyagoda', true], ['Kandy', false], ['Both', false]]);
  const [peliyagoda, kandy, both] = buttons(markup);
  expect(peliyagoda.attributes).toContain('bg-secondary');
  expect(kandy.attributes).not.toContain('bg-secondary');
  expect(both.attributes).not.toContain('bg-secondary');
  expect(both.attributes).not.toContain('aria-disabled');
  expect(markup).toMatch(/^<div role="group" aria-label="Depot"[^>]*class="hidden [^"]*xl:flex/);
  expect(pressed(drawn(new QueryClient(), 'Kandy'))).toEqual([['Peliyagoda', false], ['Kandy', true], ['Both', false]]);
  // On both depots together Both is the one filled.
  const onBoth = drawn(new QueryClient(), 'Both');
  expect(pressed(onBoth)).toEqual([['Peliyagoda', false], ['Kandy', false], ['Both', true]]);
  expect(buttons(onBoth)[2]!.attributes).toContain('bg-secondary');
});

it('AC-7 Both pressed shows chosen at once, and a switch to Both that failed shows the depot before again', async () => {
  const qc = new QueryClient();
  qc.setQueryData(meKey, RUWAN);
  let fail: (error: Error) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/auth/me')
    ? Promise.resolve(Response.json(RUWAN))
    : new Promise<Response>((_, reject) => { fail = reject; }))));
  const going = new MutationObserver(qc, switchDepotMutation(qc)).mutate('Both').catch((error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledWith('/api/v1/me/depot', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ depotId: 'Both' }) }));
  expect(pressed(drawn(qc))).toEqual([['Peliyagoda', false], ['Kandy', false], ['Both', true]]);

  fail(new TypeError('Failed to fetch'));
  expect(await going).toBeInstanceOf(TypeError);
  expect(pressed(drawn(qc))).toEqual([['Peliyagoda', true], ['Kandy', false], ['Both', false]]);
});

it('AC-6 the pressed depot shows chosen at once, and a switch that failed shows the depot before again', async () => {
  const qc = new QueryClient();
  // Only a signed-in dispatcher has the switch.
  qc.setQueryData(meKey, RUWAN);
  let fail: (error: Error) => void = () => undefined;
  // The switch gets no answer when told, and the session, read after it, is still on Peliyagoda.
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/auth/me')
    ? Promise.resolve(Response.json(RUWAN))
    : new Promise<Response>((_, reject) => { fail = reject; }))));
  const going = new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy').catch((error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const markup = drawn(qc);
  expect(pressed(markup)).toEqual([['Peliyagoda', false], ['Kandy', true], ['Both', false]]);
  expect(markup).toMatch(/^<div role="group" aria-label="Depot" aria-busy="true"/);

  fail(new TypeError('Failed to fetch'));
  expect(await going).toBeInstanceOf(TypeError);
  expect(pressed(drawn(qc))).toEqual([['Peliyagoda', true], ['Kandy', false], ['Both', false]]);
});
