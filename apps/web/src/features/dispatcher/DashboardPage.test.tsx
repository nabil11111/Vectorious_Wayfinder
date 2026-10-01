import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IssueList, Me, OperationsDay } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { issuesKeyOf } from '@/features/live/issues';
import { operationsKey } from '@/features/live/operations';
import { ApiRequestError } from '@/lib/api';
import { FLEET_MAP } from '@/lib/map/fleet-map-shapes';
import { KANDY_DAY, ON_BOTH, PELIYAGODA_DAY, RUWAN, dayOf, issueOf, listOf } from '@/features/dispatcher/both-days.test-data';
import { DashboardPage } from './DashboardPage';

// The dashboard on both depots together (spec 021, AC-5 and AC-7): the tiles add the two depots' reads up as rule 1
// says, Needs you and Trucks out now list both depots' rows each with its depot's chip, Next run has a line per depot,
// and the map card draws the Both view. One depot's failed read shows that depot failed with Try again, the other's rows
// stay, and nothing shows one depot's numbers as both. The account and the app clock are stubbed; the rest is the page
// drawn from what the query cache holds.

const held = vi.hoisted(() => ({ me: undefined as unknown }));
vi.mock('@/features/auth/api', async (original) => ({ ...await original<typeof import('@/features/auth/api')>(), useMe: () => ({ data: held.me }) }));
vi.mock('@/lib/clock', async (original) => ({
  ...await original<typeof import('@/lib/clock')>(),
  useAppClock: () => ({ state: { day: 1 }, at: Date.parse('2026-06-24T09:40:00.000Z'), time: '15:10', waiting: false, failed: false, retry: () => {} }),
}));
vi.mock('@/features/live/operations', async (original) => ({ ...await original<typeof import('@/features/live/operations')>(), useOnline: () => true }));
afterEach(() => { held.me = undefined; });

const failure = () => Promise.reject(new ApiRequestError(500, 'server_error', 'Something went wrong on our side.'));
interface Part { depot: string; day?: OperationsDay | 'failed'; issues?: IssueList | 'failed' }
async function dashboard(me: Me, parts: Part[]) {
  held.me = me;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  for (const part of parts) {
    if (part.day === 'failed') await client.prefetchQuery({ queryKey: operationsKey(me, part.depot), queryFn: failure });
    else if (part.day) client.setQueryData(operationsKey(me, part.depot), part.day);
    if (part.issues === 'failed') await client.prefetchQuery({ queryKey: issuesKeyOf(part.depot), queryFn: failure });
    else if (part.issues) client.setQueryData(issuesKeyOf(part.depot), part.issues);
  }
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/dispatcher']}><DashboardPage /></MemoryRouter></QueryClientProvider>);
  client.clear();
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ') };
}
// The tiles row, each tile's figure and words.
const tiles = (html: string) => {
  const row = html.slice(html.indexOf('<div class="grid grid-cols-2 gap-3'), html.indexOf('aria-labelledby="needs-you"'));
  return [...row.matchAll(/<p class="[^"]*font-heading[^"]*">([^<]*)<\/p><p class="[^"]*">([^<]*)<\/p>/g)].map(([, value, label]) => `${value} ${label}`);
};
// The rows of a list or a table, each as its text, and the depot chip it carries.
// A bound that falls inside a tag cuts at the tag's start.
const rowsOf = (html: string, from: string, to: string, row = '<li') => html.slice(html.indexOf(from), to ? html.lastIndexOf('<', html.indexOf(to)) : undefined).split(row).slice(1)
  .map((row) => row.slice(row.indexOf('>') + 1))
  .map((row) => ({ text: row.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim(), chip: /data-slot="chip"[^>]*>([^<]+)</.exec(row)?.[1] ?? null }));

const flagAtPeliyagoda = issueOf({ n: 1, shop: 'Fresh Nugegoda', vehicleId: 'VEH035', raisedBy: 'Kasun', raisedAt: '2026-06-23T21:03:00.000Z' });
const flagAtKandy = issueOf({ n: 2, shop: 'Fresh Peradeniya', vehicleId: 'VEH045', raisedBy: 'Sunil', raisedAt: '2026-06-23T20:58:00.000Z' });

it('AC-5 on the seeded Wednesday the tiles add the two depots up as rule 1 says', async () => {
  const { html } = await dashboard(ON_BOTH, [
    { depot: 'Peliyagoda', day: PELIYAGODA_DAY(), issues: listOf([]) },
    { depot: 'Kandy', day: KANDY_DAY(), issues: listOf([]) },
  ]);
  expect(tiles(html)).toEqual([
    '0 need you now',
    '0 / 0 stops delivered · no plan out at Kandy',
    '0 / 60 trucks out now',
    '166 orders for Thursday · closes Wed 16:00',
    '24% fuel · 6,945 / 29,260 L this week',
    '4 deferred · no plan out at Kandy',
  ]);
  // One depot alone keeps its own tiles, as before.
  const peliyagoda = await dashboard(RUWAN, [{ depot: 'Peliyagoda', day: PELIYAGODA_DAY(), issues: listOf([]) }]);
  expect(tiles(peliyagoda.html)).toEqual([
    '0 need you now', '0 / 0 stops delivered', '0 / 38 trucks out now', '102 orders for Thursday · closes Wed 16:00', '37% fuel · 6,945 / 18,600 L this week',
    '4 deferred on this plan',
  ]);
});

it('AC-5 Needs you and Trucks out now list both depots\' rows, each with its depot\'s chip, and the counts are both depots\'', async () => {
  const peliyagoda = dayOf({ depot: 'Peliyagoda', orders: 102, fuel: null, deferred: 0, plan: true,
    out: [{ tripId: 1, vehicleId: 'VEH035', district: 'Colombo', driver: 'Dilshan', issueId: flagAtPeliyagoda.id, raisedAt: flagAtPeliyagoda.raisedAt }, { tripId: 2, vehicleId: 'VEH004', district: 'Galle' }] });
  const kandy = dayOf({ depot: 'Kandy', orders: 64, fuel: null, deferred: 0, plan: true,
    out: [{ tripId: 3, vehicleId: 'VEH045', district: 'Kandy', driver: 'Sunil', issueId: flagAtKandy.id, raisedAt: flagAtKandy.raisedAt }] });
  const { html, text } = await dashboard(ON_BOTH, [
    { depot: 'Peliyagoda', day: peliyagoda, issues: listOf([flagAtPeliyagoda]) },
    { depot: 'Kandy', day: kandy, issues: listOf([flagAtKandy]) },
  ]);
  expect(tiles(html).slice(0, 3)).toEqual(['2 need you now', '0 / 0 stops delivered', '3 / 60 trucks out now']);
  expect(text).toContain('Needs you · 2');
  expect(text).toContain('2 problems to answer');
  // Oldest first, whichever depot: Kandy's flag was raised first.
  const problems = rowsOf(html, 'aria-labelledby="needs-you"', 'Next run');
  expect(problems.map((row) => [row.chip, row.text.split(' · ')[0]])).toEqual([['Kandy', 'Fresh Peradeniya'], ['Peliyagoda', 'Fresh Nugegoda']]);
  // Next run: one line per depot, each with its own View plan.
  const runs = rowsOf(html, 'aria-label="Next runs"', 'aria-label="District map"');
  expect(runs.map((row) => [row.chip, row.text])).toEqual([
    ['Peliyagoda', 'Next run · Thu 25 Jun Peliyagoda 102 orders · Orders close Wed 16:00 View plan'],
    ['Kandy', 'Next run · Thu 25 Jun Kandy 64 orders · Orders close Wed 16:00 View plan'],
  ]);
  // Trucks out now: problems first, every row with its depot, in the table and in the phone cards.
  expect(text).toContain('Trucks out now · 3');
  const table = rowsOf(html, '<tbody>', '</tbody>', '<tr');
  expect(table.map((row) => [row.chip, row.text.split(' ')[0]])).toEqual([['Kandy', 'VEH045'], ['Peliyagoda', 'VEH035'], ['Peliyagoda', 'VEH004']]);
  const cards = rowsOf(html, '<ul class="mt-3 space-y-2.5 lg:hidden">', '');
  expect(cards.map((row) => row.chip)).toEqual(['Kandy', 'Peliyagoda', 'Peliyagoda']);
});

it('AC-5 the map card draws the Both view from both reads: 120 stores, 60 vehicles, both depots\' districts and trucks', async () => {
  const peliyagoda = dayOf({ depot: 'Peliyagoda', orders: 102, fuel: null, deferred: 0, plan: true, out: [{ tripId: 1, vehicleId: 'VEH035', district: 'Colombo' }] });
  const kandy = dayOf({ depot: 'Kandy', orders: 64, fuel: null, deferred: 0, plan: true, out: [{ tripId: 3, vehicleId: 'VEH045', district: 'Matale' }] });
  const { html } = await dashboard(ON_BOTH, [{ depot: 'Peliyagoda', day: peliyagoda, issues: listOf([]) }, { depot: 'Kandy', day: kandy, issues: listOf([]) }]);
  const card = html.slice(html.indexOf('aria-label="District map"'), html.indexOf('data-layout="narrow"'));
  for (const words of ['120 stores', '60 vehicles', '2 routes', '2 active', 'Stores delivered', '0 of 120 stores']) expect(card).toContain(words);
  // Both depots' districts as the Both view draws them, not either depot's own view.
  const served = FLEET_MAP.Both.districts.filter((district) => district.served);
  expect(served).toHaveLength(12);
  for (const district of served) expect(card).toContain(`d="${district.d}"`);
  expect(card).not.toContain(`d="${FLEET_MAP.Peliyagoda.districts.find((district) => district.name === 'Colombo')!.d}"`);
  expect([...card.matchAll(/data-line="([^"]+)"/g)].map(([, district]) => district).sort()).toEqual(served.map((district) => district.name).sort());
  expect([...card.matchAll(/data-vehicle="([^"]+)"/g)].map(([, vehicle]) => vehicle)).toEqual(['VEH035', 'VEH045']);
  expect(card).toMatch(/data-line="Colombo"[^>]*class="stroke-map-line"/);
  expect(card).toMatch(/data-line="Matale"[^>]*class="stroke-map-line"/);
  // Both depots' diamonds.
  for (const { at } of FLEET_MAP.Both.depots) expect(card).toContain(`translate(${(at[0] - 5).toFixed(2)} ${(at[1] - 5).toFixed(2)})`);
  expect(card).toContain('aria-label="Peliyagoda&#x27;s and Kandy&#x27;s districts on a schematic map. On the road: VEH035 to Colombo, VEH045 to Matale."');
});

it('AC-7 one depot\'s failed read shows that depot failed with Try again, keeps the other\'s rows, and adds nothing up', async () => {
  const peliyagoda = dayOf({ depot: 'Peliyagoda', orders: 102, fuel: null, deferred: 0, plan: true, out: [{ tripId: 1, vehicleId: 'VEH035', district: 'Colombo', issueId: flagAtPeliyagoda.id }] });
  const { html, text } = await dashboard(ON_BOTH, [
    { depot: 'Peliyagoda', day: peliyagoda, issues: listOf([flagAtPeliyagoda]) },
    { depot: 'Kandy', day: 'failed', issues: 'failed' },
  ]);
  // Kandy's day and its problems say they failed, each with Try again.
  expect(text).toContain('Could not load Kandy\'s day. Something went wrong on our side. Try again');
  expect(text).toContain('Could not load what needs you at Kandy. Something went wrong on our side. Try again');
  // No tile, no map drawing and no count stands for both depots.
  expect(tiles(html)).toEqual([]);
  expect(text).not.toMatch(/Needs you · \d/);
  expect(text).not.toMatch(/Trucks out now · \d/);
  // Peliyagoda's rows stay, with its chip.
  expect(rowsOf(html, 'aria-labelledby="needs-you"', 'aria-label="Next runs"').map((row) => [row.chip, row.text.split(' · ')[0]])).toEqual([['Peliyagoda', 'Fresh Nugegoda']]);
  expect(rowsOf(html, '<tbody>', '</tbody>', '<tr').map((row) => [row.chip, row.text.split(' ')[0]])).toEqual([['Peliyagoda', 'VEH035']]);
  expect(rowsOf(html, 'aria-label="Next runs"', 'aria-labelledby="trucks-out"').map((row) => row.chip)).toEqual(['Peliyagoda']);
});

// The map card's own part: its Map view switch, and whether it draws the map.
const mapCard = (html: string) => {
  const card = html.slice(html.indexOf('aria-label="District map"'), html.indexOf('aria-labelledby="trucks-out"') > 0 ? html.indexOf('aria-labelledby="trucks-out"') : undefined);
  return {
    card,
    views: [...card.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>(Peliyagoda|Kandy|Both)<\/button>/g)].map(([, pressed, name]) => [name, pressed === 'true']),
    drawn: card.includes('role="img"') || /\d+ stores/.test(card),
  };
};

it('AC-7 the map card keeps its depot switch, the only one below 1280, when a depot\'s read failed, and draws nothing', async () => {
  const peliyagoda = dayOf({ depot: 'Peliyagoda', orders: 102, fuel: null, deferred: 0, plan: true });
  const { html } = await dashboard(ON_BOTH, [{ depot: 'Peliyagoda', day: peliyagoda, issues: listOf([]) }, { depot: 'Kandy', day: 'failed', issues: listOf([]) }]);
  const map = mapCard(html);
  expect(html).toContain('aria-label="District map"');
  expect(map.views).toEqual([['Peliyagoda', false], ['Kandy', false], ['Both', true]]);
  expect(map.drawn).toBe(false);
  // One depot whose read failed keeps the switch too.
  const alone = mapCard((await dashboard(RUWAN, [{ depot: 'Peliyagoda', day: 'failed', issues: listOf([]) }])).html);
  expect(alone.views).toEqual([['Peliyagoda', true], ['Kandy', false], ['Both', false]]);
  expect(alone.drawn).toBe(false);
});

it('AC-7 while the days load the map card shows its switch and a grey block in the map\'s place', async () => {
  const { html } = await dashboard(ON_BOTH, [{ depot: 'Peliyagoda', day: PELIYAGODA_DAY(), issues: listOf([]) }, { depot: 'Kandy' }]);
  const map = mapCard(html);
  expect(map.views).toEqual([['Peliyagoda', false], ['Kandy', false], ['Both', true]]);
  expect(map.drawn).toBe(false);
  expect(map.card).toContain('aria-label="Loading the district map"');
  const first = mapCard((await dashboard(RUWAN, [{ depot: 'Peliyagoda' }])).html);
  expect(first.views).toEqual([['Peliyagoda', true], ['Kandy', false], ['Both', false]]);
  expect(first.card).toContain('aria-label="Loading the district map"');
});
