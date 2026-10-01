import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IssueList, Me, OperationsDay } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { ON_BOTH, RUWAN, dayOf, issueOf, listOf } from '@/features/dispatcher/both-days.test-data';
import { issuesKeyOf } from './issues';
import { LiveDayPage } from './LiveDayPage';
import { operationsKey } from './operations';

// Live day on both depots together (spec 021, AC-6 and AC-7): Peliyagoda's part and then Kandy's, each under its
// depot's name with the page's own layout, and the header's counts the two added up. A problem's card answers for its
// own depot. One depot's failed read shows only that depot's part failed, with Try again; the other part stays and no
// count stands for both. The account and the app clock are stubbed; the rest is the page drawn from the query cache.

const held = vi.hoisted(() => ({ me: undefined as unknown }));
vi.mock('@/features/auth/api', async (original) => ({ ...await original<typeof import('@/features/auth/api')>(), useMe: () => ({ data: held.me }) }));
vi.mock('@/lib/clock', async (original) => ({
  ...await original<typeof import('@/lib/clock')>(),
  useAppClock: () => ({ state: { day: 1 }, at: Date.parse('2026-06-24T09:40:00.000Z'), time: '15:10', waiting: false, failed: false, retry: () => {} }),
}));
vi.mock('./operations', async (original) => ({ ...await original<typeof import('./operations')>(), useOnline: () => true }));
afterEach(() => { held.me = undefined; });

const failure = () => Promise.reject(new ApiRequestError(500, 'server_error', 'Something went wrong on our side.'));
interface Part { depot: string; day: OperationsDay | 'failed'; issues: IssueList }
async function liveDay(me: Me, parts: Part[]) {
  held.me = me;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  for (const part of parts) {
    if (part.day === 'failed') await client.prefetchQuery({ queryKey: operationsKey(me, part.depot), queryFn: failure });
    else client.setQueryData(operationsKey(me, part.depot), part.day);
    client.setQueryData(issuesKeyOf(part.depot), part.issues);
  }
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/dispatcher/live']}><LiveDayPage /></MemoryRouter></QueryClientProvider>);
  client.clear();
  return html;
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ').trim();
// Each depot's part: its heading and what it holds, in the page's order.
const partsOf = (html: string) => html.split('<section aria-labelledby="part-').slice(1).map((part) => ({ depot: part.slice(0, part.indexOf('"')), text: textOf(part.slice(part.indexOf('>') + 1)) }));
// The header's counts, under the title.
const countsOf = (html: string) => textOf(html.slice(html.indexOf('<div class="mt-2.5">'), html.indexOf('</div>', html.indexOf('<div class="mt-2.5">'))));

const flag = issueOf({ n: 1, shop: 'Fresh Nugegoda', vehicleId: 'VEH035', raisedBy: 'Kasun', raisedAt: '2026-06-23T21:03:00.000Z' });
const refusal = issueOf({ n: 2, shop: 'Fresh Peradeniya', vehicleId: 'VEH045', raisedBy: 'Sunil', raisedAt: '2026-06-23T23:48:00.000Z', refused: true });
const peliyagoda = () => dayOf({ depot: 'Peliyagoda', orders: 102, fuel: null, deferred: 0, plan: true, stops: { delivered: 1, total: 3 },
  out: [{ tripId: 1, vehicleId: 'VEH035', district: 'Colombo', driver: 'Dilshan', issueId: flag.id }, { tripId: 2, vehicleId: 'VEH004', district: 'Colombo', driver: 'Nuwan' }] });
const kandy = () => dayOf({ depot: 'Kandy', orders: 64, fuel: null, deferred: 0, plan: true, stops: { delivered: 1, total: 2 },
  out: [{ tripId: 3, vehicleId: 'VEH045', district: 'Kandy', driver: 'Sunil', issueId: refusal.id }] });

it('AC-6 Live day shows Peliyagoda\'s part and then Kandy\'s under their names, and the header adds the two up', async () => {
  const html = await liveDay(ON_BOTH, [{ depot: 'Peliyagoda', day: peliyagoda(), issues: listOf([flag]) }, { depot: 'Kandy', day: kandy(), issues: listOf([refusal]) }]);
  const parts = partsOf(html);
  expect(parts.map((part) => part.depot)).toEqual(['Peliyagoda', 'Kandy']);
  const [atPeliyagoda, atKandy] = parts;
  expect(atPeliyagoda!.text).toMatch(/^Peliyagoda Live · updated 15:10 /);
  expect(atKandy!.text).toMatch(/^Kandy Live · updated 15:10 /);
  // Each part holds its own depot's trucks and problems, and none of the other's.
  for (const words of ['VEH035 Dilshan', 'VEH004 Nuwan', 'Fresh Nugegoda', 'Needs you · 1']) expect(atPeliyagoda!.text).toContain(words);
  for (const words of ['VEH045', 'Fresh Peradeniya']) expect(atPeliyagoda!.text).not.toContain(words);
  for (const words of ['VEH045 Sunil', 'Fresh Peradeniya', 'Needs you · 1']) expect(atKandy!.text).toContain(words);
  for (const words of ['VEH035', 'VEH004', 'Fresh Nugegoda']) expect(atKandy!.text).not.toContain(words);
  // A problem answers for its own depot: Kandy's refusal goes back to Kandy.
  expect(atKandy!.text).toContain('Bring them back to Kandy');
  expect(html).not.toContain('back to Both');
  // The header's counts: trucks out of all 60, stops delivered of both depots' and both depots' problems.
  expect(countsOf(html)).toBe('3 / 60 trucks out 2 / 5 delivered 2 need you');
  expect(textOf(html)).toMatch(/^Live day · Wed 24 Jun /);
});

it('AC-6 on one depot Live day keeps its one layout, with no depot heading', async () => {
  const html = await liveDay(RUWAN, [{ depot: 'Peliyagoda', day: peliyagoda(), issues: listOf([flag]) }]);
  expect(partsOf(html)).toEqual([]);
  expect(textOf(html)).toMatch(/^Live day · Wed 24 Jun Live · updated 15:10 /);
  expect(countsOf(html)).toBe('2 / 38 trucks out 1 / 3 delivered 1 needs you');
});

it('AC-7 one depot\'s failed read shows only its part failed with Try again, and the other part stays', async () => {
  const html = await liveDay(ON_BOTH, [{ depot: 'Peliyagoda', day: peliyagoda(), issues: listOf([flag]) }, { depot: 'Kandy', day: 'failed', issues: listOf([refusal]) }]);
  const [atPeliyagoda, atKandy] = partsOf(html);
  expect(atKandy!.depot).toBe('Kandy');
  expect(atKandy!.text).toContain('Could not load the day. Something went wrong on our side. Try again');
  expect(atPeliyagoda!.text).toContain('VEH035 Dilshan');
  expect(atPeliyagoda!.text).not.toContain('Could not load');
  // No count stands for both while one depot's day is missing.
  expect(countsOf(html)).toBe('');
  expect(textOf(html)).not.toContain('trucks out');
});
