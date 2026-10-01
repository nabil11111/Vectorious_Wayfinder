import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationsDay } from '@wayfinder/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { FLEET_MAP } from '@/lib/map/fleet-map-shapes';
import { switchDepotMutation } from '../depots';
import { FleetMap } from './FleetMap';
import { LABEL_OFFSETS, OCEAN_LABEL, arrowSpots, bothMapRead, deliveredList, drawingOf, liveLine, mapReadOf, statsOf, type MapShapes } from './fleet-map';

// Spec 019's card from plain reads: the header and its numbers (AC-3), the arrows and lines (AC-4) and Stores delivered
// (AC-5), spec 020's view switch and the chosen depot's map (AC-6), and spec 021's Both (AC-5, AC-7). A trip here needs only what the map reads of it:
// its vehicle, trip number, district and whether it is out. They are written as trips without recorded detail, the
// shortest the contract takes.

vi.mock('sonner', () => ({ toast: vi.fn() }));

type Point = readonly [number, number];
const THU = '2026-06-25';
const PLAN = '9a000000-0000-4000-8000-000000000001';
const tripId = (n: number) => `9b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Each depot's districts with its shops in them, and its fleet (outlets.csv, vehicles.csv).
const DEPOT = {
  Peliyagoda: { vehicles: 38, districts: [['Colombo', 24], ['Galle', 9], ['Gampaha', 15], ['Kalutara', 10], ['Kurunegala', 8], ['Matara', 6], ['Puttalam', 3]] },
  Kandy: { vehicles: 22, districts: [['Badulla', 6], ['Kandy', 20], ['Kegalle', 5], ['Matale', 8], ['Nuwara Eliya', 6]] },
} as const;
const PELIYAGODA = DEPOT.Peliyagoda.districts;

interface TripSpec { vehicleId: string; district: string; tripNo?: number; status?: 'out' | 'ready'; earlier?: boolean }
function dayWith(specs: TripSpec[], delivered: Partial<Record<string, number | null>> = {}, depot: keyof typeof DEPOT = 'Peliyagoda'): OperationsDay {
  const trips = specs.map((spec, i) => {
    const out = (spec.status ?? 'out') === 'out';
    return {
      detailRecorded: false, reason: 'legacy_plan', tripId: tripId(i + 1), planId: PLAN, date: spec.earlier ? '2026-06-24' : THU, vehicleId: spec.vehicleId,
      vehicleType: 'truck', vehicleTemp: 'reefer', tripNo: spec.tripNo ?? 1, driver: null, brand: 'Fresh', district: spec.district, status: spec.status ?? 'out',
      openIssueIds: [], stopsTotal: 1, action: 'open', stops: [],
      outRow: out ? { progress: { numerator: null, denominator: 1, percent: null }, nextStop: null, plannedArrival: null, arrivalIsOriginal: false, plannedReturn: null, status: { kind: 'unrecorded' } } : null,
    };
  });
  const group = (rows: typeof trips) => [{ brand: 'Fresh', district: 'Colombo', tripsTotal: rows.length, vehiclesTotal: rows.length, stopsTotal: rows.length, stopsDone: null, trips: rows }];
  const today = trips.filter((trip) => trip.date === THU), earlier = trips.filter((trip) => trip.date !== THU);
  const out = trips.filter((trip) => trip.status === 'out');
  const { vehicles, districts } = DEPOT[depot];
  return OperationsDay.parse({
    depot: { id: depot, name: depot }, demoDay: 1, day: THU, dayChangesAt: '2026-06-25T10:30:00.000Z', readAt: '2026-06-24T22:08:00.000Z',
    plan: { id: PLAN, revision: 0, publishedAt: '2026-06-24T10:30:00.000Z', detailRecorded: false },
    counts: {
      stopsTotal: today.length, stopsDelivered: null, stopsDone: null, partialStops: null, noGoodsStops: null, closedStops: null, tripsTotal: today.length,
      vehiclesOut: new Set(out.map((trip) => trip.vehicleId)).size, vehiclesTotal: vehicles, deferredOrders: 0,
      deliveryProgress: { numerator: null, denominator: today.length, percent: null }, truckProgress: { numerator: out.length, denominator: vehicles, percent: 0 },
    },
    map: {
      shops: districts.reduce((sum, [, shops]) => sum + shops, 0),
      districts: districts.map(([district, shops]) => ({ district, shops, shopsDelivered: delivered[district] === undefined ? 0 : delivered[district] })),
    },
    nextRun: null, fuel: null, brandTotals: [], groups: today.length ? group(today) : [], timeline: null,
    earlierOut: earlier.length ? [{ date: '2026-06-24', brandTotals: [], groups: group(earlier), timeline: { start: '2026-06-23T22:00:00.000Z', end: '2026-06-24T10:00:00.000Z', ticks: [], now: null } }] : [],
    outTripIds: out.map((trip) => trip.tripId), events: [], eventsTruncated: false,
  });
}

// Two straight lines from the depot: 100 px right to Colombo and 80 px up to Gampaha, in 41 samples as the shapes are.
const straight = (from: Point, to: Point): Point[] => Array.from({ length: 41 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / 40, from[1] + ((to[1] - from[1]) * i) / 40] as const);
const SHAPES: MapShapes = {
  districts: [
    { name: 'Colombo', d: 'M190 90L210 90L210 110Z', centre: [200, 100] },
    { name: 'Gampaha', d: 'M90 10L110 10L110 30Z', centre: [100, 20] },
    { name: 'Ratnapura', d: 'M240 240L260 240L260 260Z', centre: [250, 250] },
  ],
  depots: [{ name: 'Peliyagoda', at: [100, 100] }],
  connections: [
    { depot: 'Peliyagoda', district: 'Colombo', points: straight([100, 100], [200, 100]) },
    { depot: 'Peliyagoda', district: 'Gampaha', points: straight([100, 100], [100, 20]) },
  ],
};
// How far along its straight line an arrow sits, as a share of the line's length.
const shareAlong = (points: readonly Point[], at: readonly [number, number]) =>
  Math.hypot(at[0] - points[0][0], at[1] - points[0][1]) / Math.hypot(points[40][0] - points[0][0], points[40][1] - points[0][1]);
// The card as the dashboard draws it, inside the app's query client, which its view switch uses.
const card = (day: OperationsDay, qc = new QueryClient()) => renderToStaticMarkup(<QueryClientProvider client={qc}><FleetMap view={day.depot.id} read={mapReadOf(day)} /></QueryClientProvider>);
// The wide card, as from 640 wide; the narrow one draws the same map again below it.
const wide = (markup: string) => markup.slice(0, markup.indexOf('data-layout="narrow"'));
const narrow = (markup: string) => markup.slice(markup.indexOf('data-layout="narrow"'));
const count = (markup: string, part: string) => markup.split(part).length - 1;
// The view switch's buttons by name, and whether each shows pressed.
const views = (markup: string) => [...markup.matchAll(/<button([^>]*)>(Peliyagoda|Kandy|Both)<\/button>/g)]
  .map(([, attributes, name]) => [name, attributes.includes('aria-pressed="true"') ? 'chosen' : attributes.includes('aria-pressed="false"') ? 'button' : attributes.includes('aria-disabled="true"') ? 'greyed' : 'other']);

describe('the card numbers', () => {
  it('AC-3 the header says Live at the read time and the stats come from the read', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }, { vehicleId: 'VEH004', district: 'Gampaha', status: 'ready' }]);
    expect(liveLine(day)).toBe('Live · 03:38');
    expect(statsOf(mapReadOf(day))).toEqual({ stores: '75 stores', vehicles: '38 vehicles', routes: '2 routes', active: '1 active' });
    const markup = wide(card(day));
    for (const words of ['Live · 03:38', 'Map view', '75 stores', '38 vehicles', '2 routes', '1 active', 'Stores delivered']) expect(markup).toContain(words);
  });

  it('AC-3 one route and one vehicle are singular', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }]);
    expect(statsOf(mapReadOf({ ...day, counts: { ...day.counts, vehiclesTotal: 1 } }))).toMatchObject({ vehicles: '1 vehicle', routes: '1 route', active: '1 active' });
  });
});

describe('the arrows and lines', () => {
  it('AC-4 one trip alone sits at 55% of its line, pointing away from the depot, and lights that line only', () => {
    const drawing = drawingOf(mapReadOf(dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }])), SHAPES);
    expect(drawing.lines.map((line) => [line.district, line.active])).toEqual([['Colombo', true], ['Gampaha', false]]);
    expect(drawing.arrows).toHaveLength(1);
    const [arrow] = drawing.arrows;
    expect(arrow).toMatchObject({ vehicleId: 'VEH035', tripNo: 1, district: 'Colombo' });
    expect(Math.abs(shareAlong(SHAPES.connections[0].points, arrow.at) - 0.55)).toBeLessThanOrEqual(0.011);
    expect(arrow.rotate).toBeCloseTo(90);
  });

  it('AC-4 the read names the depot districts: they are filled as served and named at the design offsets', () => {
    const drawing = drawingOf(mapReadOf(dayWith([])), SHAPES);
    expect(drawing.districts.map((district) => [district.name, district.served])).toEqual([['Colombo', true], ['Gampaha', true], ['Ratnapura', false]]);
    expect(drawing.ends).toEqual([
      { name: 'Colombo', centre: [200, 100], label: [128, 99] },
      { name: 'Gampaha', centre: [100, 20], label: [35, -6] },
    ]);
    expect(drawing.depots).toEqual([{ name: 'Peliyagoda', at: [100, 100], label: [9, 84] }]);
  });

  it('AC-4 several trips on one line spread from 24% to 78% by vehicle, and a later trip carries its badge number', () => {
    const day = dayWith([
      { vehicleId: 'VEH035', district: 'Colombo' }, { vehicleId: 'VEH004', district: 'Colombo', tripNo: 2 }, { vehicleId: 'VEH010', district: 'Colombo' },
      { vehicleId: 'VEH020', district: 'Colombo', status: 'ready' }, { vehicleId: 'VEH030', district: 'Gampaha', earlier: true },
    ]);
    const drawing = drawingOf(mapReadOf(day), SHAPES);
    const colombo = drawing.arrows.filter((arrow) => arrow.district === 'Colombo');
    expect(colombo.map((arrow) => [arrow.vehicleId, arrow.tripNo])).toEqual([['VEH004', 2], ['VEH010', 1], ['VEH035', 1]]);
    colombo.forEach((arrow, i) => expect(Math.abs(shareAlong(SHAPES.connections[0].points, arrow.at) - [0.24, 0.51, 0.78][i])).toBeLessThanOrEqual(0.011));
    // A truck still out from an earlier day is on the road too; the ready one is not.
    const [gampaha] = drawing.arrows.filter((arrow) => arrow.district === 'Gampaha');
    expect(gampaha).toMatchObject({ vehicleId: 'VEH030' });
    expect(gampaha.rotate).toBeCloseTo(0);
    expect(drawing.lines.every((line) => line.active)).toBe(true);
    expect(drawing.arrows).toHaveLength(day.outTripIds.length);
  });

  it('AC-4 the spacing is the design script\'s for one, two and three trips', () => {
    const line = SHAPES.connections[0].points;
    expect(arrowSpots(line, 0)).toEqual([]);
    for (const [trips, shares] of [[1, [0.55]], [2, [0.24, 0.78]], [3, [0.24, 0.51, 0.78]]] as const) {
      const spots = arrowSpots(line, trips);
      expect(spots).toHaveLength(trips);
      spots.forEach((spot, i) => expect(Math.abs(shareAlong(line, spot.at) - shares[i])).toBeLessThanOrEqual(0.011));
    }
  });

  it('AC-4 with nothing out every line is muted, no arrow is drawn and the chip says 0 active', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo', status: 'ready' }]);
    const drawing = drawingOf(mapReadOf(day), SHAPES);
    expect(drawing.arrows).toEqual([]);
    expect(drawing.lines.some((line) => line.active)).toBe(false);
    expect(statsOf(mapReadOf(day)).active).toBe('0 active');
  });

  it('AC-4 the card draws one arrow per trip on the road, the badge on a later trip, and orange only on its line', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }, { vehicleId: 'VEH004', district: 'Colombo', tripNo: 2 }, { vehicleId: 'VEH010', district: 'Galle' }]);
    const markup = wide(card(day));
    expect(count(markup, 'data-vehicle=')).toBe(3);
    expect(count(markup, 'data-badge=')).toBe(1);
    expect(markup).toMatch(/data-badge="VEH004"/);
    // Orange (--map-line) on Colombo and Galle, muted on the depot's five other districts.
    expect(count(markup, 'class="stroke-map-line"')).toBe(2);
    expect(count(markup, 'class="stroke-map-line-muted"')).toBe(5);
    expect(markup).toMatch(/data-line="Galle"[^>]*class="stroke-map-line"/);
  });

  it('AC-4 a truck still out to a district with no active shop left keeps its line and arrow', () => {
    // Every Gampaha shop was archived while yesterday's truck is still out there: the chip counts it, so the map draws it.
    const day = dayWith([{ vehicleId: 'VEH030', district: 'Gampaha', earlier: true }]);
    const archived = { ...day, map: { shops: day.map.shops - 15, districts: day.map.districts.filter((row) => row.district !== 'Gampaha') } };
    const drawing = drawingOf(mapReadOf(archived), SHAPES);
    expect(drawing.lines.map((line) => [line.district, line.active])).toEqual([['Colombo', false], ['Gampaha', true]]);
    expect(drawing.arrows.map((arrow) => arrow.vehicleId)).toEqual(['VEH030']);
    expect(drawing.arrows).toHaveLength(archived.counts.vehiclesOut);
    // The line still ends at its named dot, but the district is no longer filled as served nor listed.
    expect(drawing.ends.map((end) => end.name)).toEqual(['Colombo', 'Gampaha']);
    expect(drawing.districts.find((district) => district.name === 'Gampaha')?.served).toBe(false);
    expect(deliveredList(archived.map).rows.map((row) => row.district)).not.toContain('Gampaha');
  });

  it('AC-4 on the real shapes, Puttalam with no active shop and a truck still out keeps its orange line and arrow', () => {
    const day = dayWith([{ vehicleId: 'VEH032', district: 'Puttalam', earlier: true }]);
    const archived = { ...day, map: { shops: day.map.shops - 3, districts: day.map.districts.filter((row) => row.district !== 'Puttalam') } };
    const markup = wide(card(archived));
    expect(count(markup, 'data-vehicle=')).toBe(archived.counts.vehiclesOut);
    expect(markup).toMatch(/data-line="Puttalam"[^>]*class="stroke-map-line"/);
    // The totals stay the active shops'.
    expect(markup).toContain('0 of 72 stores');
    expect(markup).not.toContain('0/3');
  });

  it('AC-4 every district a depot serves has the design\'s place for its name', () => {
    for (const view of ['Peliyagoda', 'Kandy'] as const) {
      expect(FLEET_MAP[view].connections.map((line) => line.district).filter((district) => !LABEL_OFFSETS[district])).toEqual([]);
    }
  });
});

describe('Stores delivered', () => {
  it('AC-5 lists the depot districts by name with delivered of total and the total of stores', () => {
    const day = dayWith([], { Colombo: 2 });
    const list = deliveredList(day.map);
    expect(list.total).toBe('2 of 75 stores');
    expect(list.rows.map((row) => [row.district, row.count])).toEqual([
      ['Colombo', '2/24'], ['Galle', '0/9'], ['Gampaha', '0/15'], ['Kalutara', '0/10'], ['Kurunegala', '0/8'], ['Matara', '0/6'], ['Puttalam', '0/3'],
    ]);
    expect(list.bars).toBe(true);
    const markup = wide(card(day));
    expect(count(markup, 'role="meter"')).toBe(7);
    expect(markup).toContain('aria-valuenow="2"');
  });

  it('AC-5 unknown counts show a dash, as the tile does', () => {
    const day = dayWith([], Object.fromEntries(PELIYAGODA.map(([district]) => [district, null])));
    const list = deliveredList(day.map);
    expect(list.total).toBe('– of 75 stores');
    expect(list.rows[0]).toMatchObject({ count: '–/24', delivered: null });
  });
});

describe('the view switch and the chosen depot (spec 020)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('AC-7 Peliyagoda, Kandy and Both are buttons with the depot on show chosen, at every width', () => {
    const markup = card(dayWith([]));
    for (const layout of [wide(markup), narrow(markup)]) {
      expect(views(layout)).toEqual([['Peliyagoda', 'chosen'], ['Kandy', 'button'], ['Both', 'button']]);
      expect(layout).toMatch(/<button[^>]*aria-pressed="true"[^>]*class="[^"]*bg-map-chosen[^"]*"[^>]*>Peliyagoda<\/button>/);
      expect(layout).toMatch(/<button[^>]*aria-pressed="false"[^>]*class="[^"]*bg-map-option text-map-option-ink(?!\/)[^"]*"[^>]*>Kandy<\/button>/);
      expect(layout).toMatch(/<button[^>]*aria-pressed="false"[^>]*class="[^"]*bg-map-option text-map-option-ink(?!\/)[^"]*"[^>]*>Both<\/button>/);
    }
  });

  it('AC-7 the card on both depots\' read draws the Both view with Both chosen, at every width', () => {
    const markup = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><FleetMap view="Both" read={bothMapRead([dayWith([]), dayWith([], {}, 'Kandy')])} /></QueryClientProvider>);
    for (const layout of [wide(markup), narrow(markup)]) {
      expect(views(layout)).toEqual([['Peliyagoda', 'button'], ['Kandy', 'button'], ['Both', 'chosen']]);
      expect(layout).toMatch(/<button[^>]*aria-pressed="true"[^>]*class="[^"]*bg-map-chosen[^"]*"[^>]*>Both<\/button>/);
    }
    for (const district of FLEET_MAP.Both.districts.filter((each) => each.d !== '')) expect(wide(markup)).toContain(`d="${district.d}"`);
  });

  it('AC-6 the card draws the chosen depot: Kandy\'s frame from the shapes module, its lines and its list, with Kandy chosen', () => {
    const day = dayWith([{ vehicleId: 'VEH041', district: 'Matale' }, { vehicleId: 'VEH045', district: 'Kandy', tripNo: 2 }], { Kandy: 3 }, 'Kandy');
    const markup = card(day);
    expect(views(wide(markup))).toEqual([['Peliyagoda', 'button'], ['Kandy', 'chosen'], ['Both', 'button']]);
    expect(views(narrow(markup))).toEqual([['Peliyagoda', 'button'], ['Kandy', 'chosen'], ['Both', 'button']]);

    const drawn = wide(markup);
    const kandy = drawingOf(mapReadOf(day), FLEET_MAP.Kandy);
    for (const district of kandy.districts) expect(drawn).toContain(`d="${district.d}"`);
    expect(drawn).not.toContain(FLEET_MAP.Peliyagoda.districts.find((district) => district.name === 'Colombo')!.d);
    expect([...drawn.matchAll(/data-line="([^"]+)"/g)].map(([, district]) => district)).toEqual(['Badulla', 'Kandy', 'Kegalle', 'Matale', 'Nuwara Eliya']);
    expect(drawn).toMatch(/data-line="Matale"[^>]*class="stroke-map-line"/);
    expect(drawn).toMatch(/data-line="Badulla"[^>]*class="stroke-map-line-muted"/);
    expect(count(drawn, 'data-vehicle=')).toBe(2);
    // The depot's diamond sits on Kandy, and the design names it by its district's name, not beside it.
    expect(kandy.depots).toEqual([{ name: 'Kandy', at: [175.72, 161.03], label: null }]);
    expect(drawn).toContain('translate(170.72 156.03)');
    expect(drawn).toContain('aria-label="Kandy&#x27;s districts on a schematic map. On the road: VEH045 trip 2 to Kandy, VEH041 to Matale."');
    expect(drawn).toContain('45 stores');
    expect(drawn).toContain('22 vehicles');
    expect(drawn).toContain('3 of 45 stores');
    expect(drawn).toContain('3/20');
  });

  it('AC-6 a depot pressed on either switch shows chosen on the card at once', async () => {
    const qc = new QueryClient();
    // Only a signed-in dispatcher has the switch.
    qc.setQueryData(meKey, { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    void new MutationObserver(qc, switchDepotMutation(qc)).mutate('Kandy');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const markup = card(dayWith([]), qc);
    for (const layout of [wide(markup), narrow(markup)]) expect(views(layout)).toEqual([['Peliyagoda', 'button'], ['Kandy', 'chosen'], ['Both', 'button']]);
    // Both pressed shows chosen at once too.
    const toBoth = new QueryClient();
    toBoth.setQueryData(meKey, { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null });
    void new MutationObserver(toBoth, switchDepotMutation(toBoth)).mutate('Both');
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const layout of [wide(card(dayWith([]), toBoth)), narrow(card(dayWith([]), toBoth))]) expect(views(layout)).toEqual([['Peliyagoda', 'button'], ['Kandy', 'button'], ['Both', 'chosen']]);
  });
});

describe('the credit', () => {
  it('AC-8 the card credits OpenStreetMap', () => {
    const markup = wide(card(dayWith([])));
    expect(markup).toContain('Schematic district routes · not GPS');
    expect(markup).toMatch(/<a[^>]*href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>© OpenStreetMap contributors<\/a>/);
  });
});

describe('both depots together (spec 021)', () => {
  it('AC-5 the Both read adds the two depots up: shops by district, fleets, trips and trucks out, at the older read time', () => {
    const peliyagoda = { ...dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }], { Colombo: 2 }), readAt: '2026-06-24T22:08:00.000Z' };
    const kandy = { ...dayWith([{ vehicleId: 'VEH045', district: 'Kandy', tripNo: 2 }], { Kandy: 3 }, 'Kandy'), readAt: '2026-06-24T22:05:00.000Z' };
    const both = bothMapRead([peliyagoda, kandy]);
    expect(both).toMatchObject({ view: 'Both', whose: 'Peliyagoda\'s and Kandy\'s', readAt: '2026-06-24T22:05:00.000Z', counts: { vehiclesTotal: 60, tripsTotal: 2, vehiclesOut: 2 } });
    expect(statsOf(both)).toEqual({ stores: '120 stores', vehicles: '60 vehicles', routes: '2 routes', active: '2 active' });
    expect(liveLine(both)).toBe('Live · 03:35');
    expect(both.out.map((trip) => trip.vehicleId)).toEqual(['VEH035', 'VEH045']);
    const list = deliveredList(both.map);
    expect(list.total).toBe('5 of 120 stores');
    expect(list.rows.map((row) => row.district)).toEqual(['Badulla', 'Colombo', 'Galle', 'Gampaha', 'Kalutara', 'Kandy', 'Kegalle', 'Kurunegala', 'Matale', 'Matara', 'Nuwara Eliya', 'Puttalam']);
    // The Both view draws every district either depot serves, and both depots' trucks on their lines.
    const drawing = drawingOf(both, FLEET_MAP.Both);
    expect(drawing.lines.filter((line) => line.active).map((line) => line.district)).toEqual(['Colombo', 'Kandy']);
    expect(drawing.arrows.map((arrow) => [arrow.vehicleId, arrow.tripNo])).toEqual([['VEH035', 1], ['VEH045', 2]]);
    expect(drawing.depots.map((depot) => depot.name)).toEqual(['Peliyagoda', 'Kandy']);
  });

  it('AC-5 a district both depots serve adds up, and a count either did not record stays unknown', () => {
    const one = dayWith([], { Colombo: 2 });
    const other = { ...one, map: { shops: 4, districts: [{ district: 'Colombo', shops: 4, shopsDelivered: 1 }] } };
    expect(bothMapRead([one, other]).map.districts.find((row) => row.district === 'Colombo')).toEqual({ district: 'Colombo', shops: 28, shopsDelivered: 3 });
    const unrecorded = { ...one, map: { shops: 4, districts: [{ district: 'Colombo', shops: 4, shopsDelivered: null }] } };
    expect(bothMapRead([one, unrecorded]).map.districts.find((row) => row.district === 'Colombo')).toEqual({ district: 'Colombo', shops: 28, shopsDelivered: null });
  });
});

// The vertices of the shapes module's district paths, ring by ring (M, L, H, V and Z, absolute and relative).
function ringsOf(d: string): Point[][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const rings: Point[][] = [];
  let at: Point = [0, 0];
  let command = '';
  for (let i = 0; i < tokens.length;) {
    if (/[A-Za-z]/.test(tokens[i]!)) {
      command = tokens[i++]!;
      if (command === 'Z' || command === 'z') { at = rings[rings.length - 1]![0]!; continue; }
    }
    const [baseX, baseY] = command === command.toLowerCase() ? at : [0, 0];
    const next = () => Number(tokens[i++]);
    switch (command.toUpperCase()) {
      case 'M': at = [baseX + next(), baseY + next()]; rings.push([at]); command = command === 'm' ? 'l' : 'L'; break;
      case 'L': at = [baseX + next(), baseY + next()]; rings[rings.length - 1]!.push(at); break;
      case 'H': at = [baseX + next(), at[1]]; rings[rings.length - 1]!.push(at); break;
      case 'V': at = [at[0], baseY + next()]; rings[rings.length - 1]!.push(at); break;
      default: throw new Error(`Unexpected path command ${command}`);
    }
  }
  return rings;
}
const inRing = ([x, y]: Point, ring: Point[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

describe('the sea\'s name (Q-10)', () => {
  // "INDIAN OCEAN" in 7 px Inter capitals is about 51 px long, on a 10 px line from the y the card puts it at.
  const LABEL = { width: 52, height: 10 };

  it('Q-10 "INDIAN OCEAN" sits wholly on the sea in every view that names it, inside the frame', () => {
    for (const view of ['Peliyagoda', 'Both'] as const) {
      const [x, y] = OCEAN_LABEL[view]!;
      expect([x >= 0, y >= 0, x + LABEL.width <= 340, y + LABEL.height <= 280]).toEqual([true, true, true, true]);
      const rings = FLEET_MAP[view].districts.flatMap((district) => ringsOf(district.d));
      const land: Point[] = [];
      for (let dy = 0; dy <= LABEL.height; dy += 1) {
        for (let dx = 0; dx <= LABEL.width; dx += 1) if (rings.some((ring) => inRing([x + dx, y + dy], ring))) land.push([x + dx, y + dy]);
      }
      expect({ view, land }).toEqual({ view, land: [] });
    }
  });

  it('Q-10 the card writes it at its own view\'s place, and not on Kandy\'s inland view', () => {
    const at = (markup: string) => /<text x="([^"]+)" y="([^"]+)" font-size="7" class="fill-map-ocean">INDIAN OCEAN<\/text>/.exec(markup)?.slice(1).map(Number);
    // Kandy's view is the hill country with a strip of the west coast, too little sea for the name, so it has none.
    expect(OCEAN_LABEL.Kandy).toBeNull();
    expect(wide(card(dayWith([], {}, 'Kandy')))).not.toContain('INDIAN OCEAN');
    const peliyagoda = at(wide(card(dayWith([]))));
    expect(peliyagoda?.[0]).toBe(OCEAN_LABEL.Peliyagoda![0]);
    expect(peliyagoda![1]).toBeGreaterThan(OCEAN_LABEL.Peliyagoda![1]);
    expect(peliyagoda![1]).toBeLessThan(OCEAN_LABEL.Peliyagoda![1] + LABEL.height);
  });
});
