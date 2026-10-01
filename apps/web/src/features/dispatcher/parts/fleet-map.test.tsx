import { renderToStaticMarkup } from 'react-dom/server';
import { OperationsDay } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { FLEET_MAP } from '@/lib/map/fleet-map-shapes';
import { youPlan } from '../depots';
import { FleetMap } from './FleetMap';
import { LABEL_OFFSETS, arrowSpots, deliveredList, drawingOf, liveLine, statsOf, type MapShapes } from './fleet-map';

// Spec 019's card from plain reads: the header and its numbers (AC-3), the arrows and lines (AC-4), Stores delivered
// (AC-5) and the view switch (AC-6). A trip here needs only what the map reads of it: its vehicle, trip number,
// district and whether it is out. They are written as trips without recorded detail, the shortest the contract takes.

type Point = readonly [number, number];
const THU = '2026-06-25';
const PLAN = '9a000000-0000-4000-8000-000000000001';
const tripId = (n: number) => `9b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PELIYAGODA = [['Colombo', 24], ['Galle', 9], ['Gampaha', 15], ['Kalutara', 10], ['Kurunegala', 8], ['Matara', 6], ['Puttalam', 3]] as const;

interface TripSpec { vehicleId: string; district: string; tripNo?: number; status?: 'out' | 'ready'; earlier?: boolean }
function dayWith(specs: TripSpec[], delivered: Partial<Record<string, number | null>> = {}): OperationsDay {
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
  return OperationsDay.parse({
    depot: { id: 'Peliyagoda', name: 'Peliyagoda' }, demoDay: 1, day: THU, dayChangesAt: '2026-06-25T10:30:00.000Z', readAt: '2026-06-24T22:08:00.000Z',
    plan: { id: PLAN, revision: 0, publishedAt: '2026-06-24T10:30:00.000Z', detailRecorded: false },
    counts: {
      stopsTotal: today.length, stopsDelivered: null, stopsDone: null, partialStops: null, noGoodsStops: null, closedStops: null, tripsTotal: today.length,
      vehiclesOut: new Set(out.map((trip) => trip.vehicleId)).size, vehiclesTotal: 38, deferredOrders: 0,
      deliveryProgress: { numerator: null, denominator: today.length, percent: null }, truckProgress: { numerator: out.length, denominator: 38, percent: 0 },
    },
    map: { shops: 75, districts: PELIYAGODA.map(([district, shops]) => ({ district, shops, shopsDelivered: delivered[district] === undefined ? 0 : delivered[district] })) },
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
// The wide card, as from 640 wide; the narrow one draws the same map again below it.
const wide = (markup: string) => markup.slice(0, markup.indexOf('data-layout="narrow"'));
const count = (markup: string, part: string) => markup.split(part).length - 1;

describe('the card numbers', () => {
  it('AC-3 the header says Live at the read time and the stats come from the read', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }, { vehicleId: 'VEH004', district: 'Gampaha', status: 'ready' }]);
    expect(liveLine(day)).toBe('Live · 03:38');
    expect(statsOf(day)).toEqual({ stores: '75 stores', vehicles: '38 vehicles', routes: '2 routes', active: '1 active' });
    const markup = wide(renderToStaticMarkup(<FleetMap day={day} />));
    for (const words of ['Live · 03:38', 'Map view', '75 stores', '38 vehicles', '2 routes', '1 active', 'Stores delivered']) expect(markup).toContain(words);
  });

  it('AC-3 one route and one vehicle are singular', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }]);
    expect(statsOf({ ...day, counts: { ...day.counts, vehiclesTotal: 1 } })).toMatchObject({ vehicles: '1 vehicle', routes: '1 route', active: '1 active' });
  });
});

describe('the arrows and lines', () => {
  it('AC-4 one trip alone sits at 55% of its line, pointing away from the depot, and lights that line only', () => {
    const drawing = drawingOf(dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }]), SHAPES);
    expect(drawing.lines.map((line) => [line.district, line.active])).toEqual([['Colombo', true], ['Gampaha', false]]);
    expect(drawing.arrows).toHaveLength(1);
    const [arrow] = drawing.arrows;
    expect(arrow).toMatchObject({ vehicleId: 'VEH035', tripNo: 1, district: 'Colombo' });
    expect(Math.abs(shareAlong(SHAPES.connections[0].points, arrow.at) - 0.55)).toBeLessThanOrEqual(0.011);
    expect(arrow.rotate).toBeCloseTo(90);
  });

  it('AC-4 the read names the depot districts: they are filled as served and named at the design offsets', () => {
    const drawing = drawingOf(dayWith([]), SHAPES);
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
    const drawing = drawingOf(day, SHAPES);
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
    const drawing = drawingOf(day, SHAPES);
    expect(drawing.arrows).toEqual([]);
    expect(drawing.lines.some((line) => line.active)).toBe(false);
    expect(statsOf(day).active).toBe('0 active');
  });

  it('AC-4 the card draws one arrow per trip on the road, the badge on a later trip, and orange only on its line', () => {
    const day = dayWith([{ vehicleId: 'VEH035', district: 'Colombo' }, { vehicleId: 'VEH004', district: 'Colombo', tripNo: 2 }, { vehicleId: 'VEH010', district: 'Galle' }]);
    const markup = wide(renderToStaticMarkup(<FleetMap day={day} />));
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
    const drawing = drawingOf(archived, SHAPES);
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
    const markup = wide(renderToStaticMarkup(<FleetMap day={archived} />));
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
    const markup = wide(renderToStaticMarkup(<FleetMap day={day} />));
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

describe('the view switch', () => {
  it('AC-6 shows the dispatcher depot chosen and greys the others, which say whose depot this is', () => {
    const markup = wide(renderToStaticMarkup(<FleetMap day={dayWith([])} />));
    expect(markup).toMatch(/<span[^>]*aria-current="true"[^>]*>Peliyagoda<\/span>/);
    for (const other of ['Kandy', 'Both']) expect(markup).toMatch(new RegExp(`<button[^>]*aria-disabled="true"[^>]*>${other}</button>`));
    expect(youPlan('Peliyagoda')).toBe('You plan Peliyagoda');
  });

  it('AC-8 the card credits OpenStreetMap', () => {
    const markup = wide(renderToStaticMarkup(<FleetMap day={dayWith([])} />));
    expect(markup).toContain('Schematic district routes · not GPS');
    expect(markup).toMatch(/<a[^>]*href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>© OpenStreetMap contributors<\/a>/);
  });
});
