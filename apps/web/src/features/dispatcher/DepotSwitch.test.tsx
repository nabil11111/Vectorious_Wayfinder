import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { DepotSwitch } from './DepotSwitch';
import { BOTH_LATER, switchDepotMutation } from './depots';

// The top bar's depot switch (spec 020, AC-6) as it is drawn: Peliyagoda and Kandy are buttons with the chosen one
// filled and pressed, a pressed depot shows chosen at once, a switch that failed shows the depot before again, and
// Both stays greyed with its line.

vi.mock('sonner', () => ({ toast: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };

const drawn = (qc: QueryClient, depot = 'Peliyagoda') => renderToStaticMarkup(<QueryClientProvider client={qc}><DepotSwitch depot={depot} /></QueryClientProvider>);
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, name]) => ({ name, attributes }));
// Each depot button by name, and whether it shows pressed.
const pressed = (markup: string) => buttons(markup).filter((button) => button.attributes.includes('aria-pressed='))
  .map((button) => [button.name, button.attributes.includes('aria-pressed="true"')]);

it('AC-6 Peliyagoda and Kandy are buttons with the chosen one filled and pressed, shown from 1280 wide', () => {
  const markup = drawn(new QueryClient());
  expect(pressed(markup)).toEqual([['Peliyagoda', true], ['Kandy', false]]);
  const [peliyagoda, kandy] = buttons(markup);
  expect(peliyagoda.attributes).toContain('bg-secondary');
  expect(kandy.attributes).not.toContain('bg-secondary');
  expect(markup).toMatch(/^<div role="group" aria-label="Depot"[^>]*class="hidden [^"]*xl:flex/);
  expect(pressed(drawn(new QueryClient(), 'Kandy'))).toEqual([['Peliyagoda', false], ['Kandy', true]]);
});

it('AC-6 Both stays greyed and says both depots together come later', () => {
  const both = buttons(drawn(new QueryClient())).find((button) => button.name === 'Both');
  expect(both?.attributes).toContain('aria-disabled="true"');
  expect(both?.attributes).not.toContain('aria-pressed');
  expect(both?.attributes).toContain('text-muted-foreground/65');
  expect(BOTH_LATER).toBe('Both depots together come later.');
});

it('AC-6 the pressed depot shows chosen at once, and a switch that failed shows the depot before again', async () => {
  const qc = new QueryClient();
  let fail: (error: Error) => void = () => undefined;
  // The switch gets no answer when told, and the session, read after it, is still on Peliyagoda.
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/auth/me')
    ? Promise.resolve(Response.json(RUWAN))
    : new Promise<Response>((_, reject) => { fail = reject; }))));
  const going = new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy').catch((error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const markup = drawn(qc);
  expect(pressed(markup)).toEqual([['Peliyagoda', false], ['Kandy', true]]);
  expect(markup).toMatch(/^<div role="group" aria-label="Depot" aria-busy="true"/);

  fail(new TypeError('Failed to fetch'));
  expect(await going).toBeInstanceOf(TypeError);
  expect(pressed(drawn(qc))).toEqual([['Peliyagoda', true], ['Kandy', false]]);
});
