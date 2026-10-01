import { BOTH_DEPOTS, type OperationsDay, type OperationsMap, type OperationsMapDistrict } from '@wayfinder/contracts';
import { clockTime, whole } from '@/features/loader/words';
import { countOf } from '@/features/store/words';
import { angleAt, pointAt } from '@/lib/map/geometry';
import { tripsOut, type OutTrip } from './trips-out';

// The dashboard's district map (spec 019) as the design's map-fleet-overview.js draws it on Dispatcher · Dashboard
// (53:11540). Every size and offset here is that script's, in the frame's pixels: the card is 520 by 407 and its map
// 340 by 280. Its colours are the --map tokens in index.css. The numbers come from the operations read (D-92) and the
// outlines from fleet-map-shapes.ts.

type Point = readonly [number, number];

// One view of fleet-map-shapes.ts: every district's outline and centre, the view's depots, and a line of samples
// from each depot to each district it serves.
export interface MapShapes {
  districts: readonly { name: string; d: string; centre: Point }[];
  depots: readonly { name: string; at: Point }[];
  connections: readonly { depot: string; district: string; points: readonly Point[] }[];
}

export const CARD_SIZE = { width: 520, height: 407 } as const;

// The view switch as the frame draws it: each button's left edge and width, and where its name starts inside it.
export const VIEWS = [
  { name: 'Peliyagoda', x: 275, width: 88, inset: 11 },
  { name: 'Kandy', x: 366, width: 66, inset: 14 },
  { name: 'Both', x: 435, width: 59, inset: 14 },
] as const;

// Where each district's name sits from its centre, and the depot's name from the depot. The design names only
// Peliyagoda beside its depot; Kandy's depot sits by its district's name.
export const LABEL_OFFSETS: Readonly<Record<string, Point>> = {
  Puttalam: [-36, -19], Kurunegala: [-37, -22], Matale: [-6, -22], Gampaha: [-65, -26], Colombo: [-72, -1], Kalutara: [-61, -3],
  Galle: [-31, 14], Matara: [11, -4], Kandy: [22, -16], Kegalle: [-26, 9], 'Nuwara Eliya': [20, 19], Badulla: [18, -2],
};
export const DEPOT_LABEL_OFFSETS: Readonly<Record<string, Point>> = { Peliyagoda: [-91, -16] };

// The design's spacing of the arrows on one line (rule 2): one alone at 55% of the line's length, two or more evenly
// from 24% to 78%. Each sits on the first of 101 samples along the line that reaches its share of the length, turned
// to point along the line, away from the depot. Spacing is a diagram, not where the truck is.
export function arrowSpots(points: readonly Point[], count: number): { at: [number, number]; rotate: number }[] {
  const samples = Array.from({ length: 101 }, (_, j) => pointAt(points, j / 100));
  const lengths = [0];
  for (let j = 1; j < samples.length; j++) lengths.push(lengths[j - 1] + Math.hypot(samples[j][0] - samples[j - 1][0], samples[j][1] - samples[j - 1][1]));
  return Array.from({ length: count }, (_, i) => {
    const share = count === 1 ? 0.55 : 0.24 + (0.54 * i) / (count - 1);
    const t = Math.max(0, lengths.findIndex((length) => length >= lengths[100] * share)) / 100;
    return { at: pointAt(points, t), rotate: angleAt(points, t) };
  });
}

export interface MapArrow { tripId: string; vehicleId: string; tripNo: number; district: string; at: [number, number]; rotate: number }
export interface MapDrawing {
  districts: { name: string; d: string; served: boolean }[];
  // One line per district the depot has shops in, orange while a truck on the road goes there (rule 1), and one for a
  // district a truck on the road is still out to after its last shop was archived.
  lines: { district: string; points: readonly Point[]; active: boolean }[];
  arrows: MapArrow[];
  // Each served district's name, and every line's, with the dot at its centre where the line ends (rule 4).
  ends: { name: string; centre: Point; label: Point | null }[];
  depots: { name: string; at: Point; label: Point | null }[];
}

const plus = (a: Point, b: Point | undefined): Point | null => (b ? [a[0] + b[0], a[1] + b[1]] : null);

// What the card draws from: the view of the shapes module (a depot, or Both), whose districts it names, the read's time,
// the map's shops by district, the fleet and trips, and the trips on the road. One depot's comes from its read; on both
// depots together (spec 021) it is the two reads added up, never one depot's standing for both.
export interface MapRead {
  view: string; whose: string; name: string; readAt: string; map: OperationsMap;
  counts: { vehiclesTotal: number; tripsTotal: number; vehiclesOut: number }; out: OutTrip[];
}
export const mapReadOf = (day: OperationsDay): MapRead => ({
  view: day.depot.id, whose: `${day.depot.name}'s`, name: day.depot.name, readAt: day.readAt, map: day.map,
  counts: { vehiclesTotal: day.counts.vehiclesTotal, tripsTotal: day.counts.tripsTotal, vehiclesOut: day.counts.vehiclesOut }, out: tripsOut(day),
});
// Both depots' reads as one map: the shops of a district both serve added up, every district's, the fleets, trips and
// trucks out added up, and the read's time the older of the two, so the card never says it is newer than either part.
export function bothMapRead(days: OperationsDay[]): MapRead {
  const byDistrict = new Map<string, OperationsMapDistrict>();
  for (const row of days.flatMap((day) => day.map.districts)) {
    const held = byDistrict.get(row.district);
    byDistrict.set(row.district, held ? {
      district: row.district, shops: held.shops + row.shops,
      shopsDelivered: held.shopsDelivered === null || row.shopsDelivered === null ? null : held.shopsDelivered + row.shopsDelivered,
    } : row);
  }
  const sum = (key: keyof MapRead['counts']) => days.reduce((n, day) => n + day.counts[key], 0);
  return {
    view: BOTH_DEPOTS, whose: days.map((day) => `${day.depot.name}'s`).join(' and '), name: 'both depots',
    readAt: days.map((day) => day.readAt).sort()[0]!,
    map: { shops: days.reduce((n, day) => n + day.map.shops, 0), districts: [...byDistrict.values()].sort((a, b) => a.district.localeCompare(b.district)) },
    counts: { vehiclesTotal: sum('vehiclesTotal'), tripsTotal: sum('tripsTotal'), vehiclesOut: sum('vehiclesOut') },
    out: days.flatMap((day) => tripsOut(day)),
  };
}

// What the map draws for the read: the depot's districts are the ones the read lists, and the trips on the road are
// the ones the "trucks out now" tile counts, ordered by vehicle on each line as the design orders them. A truck the
// chip counts keeps its line and arrow even when its district has no active shop left; the fill, the shop totals and
// Stores delivered stay the active shops'.
export function drawingOf(read: MapRead, shapes: MapShapes): MapDrawing {
  const served = new Set(read.map.districts.map((row) => row.district));
  const out = read.out;
  const drawn = new Set([...served, ...out.map((trip) => trip.district)]);
  const lines = shapes.connections.filter((line) => drawn.has(line.district))
    .map((line) => ({ district: line.district, points: line.points, active: out.some((trip) => trip.district === line.district) }));
  const ended = new Set([...served, ...lines.map((line) => line.district)]);
  const arrows = lines.flatMap((line) => {
    const trips = out.filter((trip) => trip.district === line.district).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo);
    return arrowSpots(line.points, trips.length).map((spot, i) => ({ tripId: trips[i].tripId, vehicleId: trips[i].vehicleId, tripNo: trips[i].tripNo, district: line.district, ...spot }));
  });
  return {
    // A district the view cuts off has no outline to draw.
    districts: shapes.districts.filter((district) => district.d !== '').map((district) => ({ name: district.name, d: district.d, served: served.has(district.name) })),
    lines,
    arrows,
    ends: shapes.districts.filter((district) => ended.has(district.name))
      .map((district) => ({ name: district.name, centre: district.centre, label: plus(district.centre, LABEL_OFFSETS[district.name]) })),
    depots: shapes.depots.map((depot) => ({ name: depot.name, at: depot.at, label: plus(depot.at, DEPOT_LABEL_OFFSETS[depot.name]) })),
  };
}

// The header (rule 3's table): "Live · 07:30" at the read's time, the depot's shops, its fleet, the plan's trips and
// the trucks out now.
export const liveLine = (read: Pick<MapRead, 'readAt'>) => `Live · ${clockTime(read.readAt)}`;
export const statsOf = (read: Pick<MapRead, 'map' | 'counts'>) => ({
  stores: countOf(read.map.shops, 'store'),
  vehicles: countOf(read.counts.vehiclesTotal, 'vehicle'),
  routes: countOf(read.counts.tripsTotal, 'route'),
  active: `${whole(read.counts.vehiclesOut)} active`,
});

// Stores delivered: "29 of 75 stores", then each district by name with "7/24" and a bar. An unknown count is a dash,
// as the tile's is. The design's rows share 204 px, 30 at most, and draw bars when 25 or taller.
export function deliveredList(map: OperationsMap) {
  const known = map.districts.every((row) => row.shopsDelivered !== null);
  const done = map.districts.reduce((n, row) => n + (row.shopsDelivered ?? 0), 0);
  const rowHeight = Math.min(30, 204 / Math.max(1, map.districts.length));
  return {
    total: `${known ? whole(done) : '–'} of ${countOf(map.shops, 'store')}`,
    rows: map.districts.map((row) => ({
      district: row.district, shops: row.shops, delivered: row.shopsDelivered,
      count: `${row.shopsDelivered === null ? '–' : whole(row.shopsDelivered)}/${whole(row.shops)}`,
    })),
    rowHeight,
    bars: rowHeight >= 25,
  };
}
