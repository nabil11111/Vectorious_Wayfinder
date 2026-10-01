import { tripFigures, type DriverTrip, type OperationsFigures, type OperationsMap, type OperationsProgress, type OperationsTrip } from '@wayfinder/contracts';
import { percent } from '../plans/board-day';

export const progress = (numerator: number | null, denominator: number): OperationsProgress => ({ numerator, denominator, percent: numerator === null ? null : percent(numerator, denominator) });

// Until ready the loader's On so far is meaningful, but a final loaded/short total is not.
export function figuresOf(trip: DriverTrip): OperationsFigures {
  const figures = tripFigures(trip);
  if (trip.status !== 'planned' && trip.status !== 'loading') return figures;
  const unfinished = <T extends { loaded: number; short: number }>(row: T): Omit<T, 'loaded' | 'short'> & { loaded: null; short: null } => ({ ...row, loaded: null, short: null });
  const temperatures = (row: typeof figures.byTemp) => ({ chilled: unfinished(row.chilled), dry: unfinished(row.dry) });
  return { ...unfinished(figures), byTemp: temperatures(figures.byTemp), byStop: figures.byStop.map(stop => ({ ...unfinished(stop), byTemp: temperatures(stop.byTemp), byLine: stop.byLine.map(unfinished) })) };
}

type Stop = DriverTrip['stops'][number];
const deliveredUnits = (stop: Stop) => stop.lines.reduce((n, line) => n + (line.delivered ?? 0), 0);
const endedWithGoods = (stop: Stop) => stop.outcome === 'delivered' || stop.outcome === 'refused';

// Goods were handed over at a stop: it ended delivered, or refused with something delivered. The "stops delivered"
// tile and the map's shops delivered (spec 019 rule 3) both count with this one test, so they can never disagree.
export const goodsHandedOver = (stop: Stop) => endedWithGoods(stop) && deliveredUnits(stop) > 0;

// The stops of the given trips with what happened at them, or null when one of the trips kept no detail (a plan sent
// before the driver's piece): then nothing about the day's deliveries is known.
function knownStops(rows: OperationsTrip[]): Stop[] | null {
  const unknown = rows.some(row => row.stopsTotal > 0) && rows.some(row => !row.detailRecorded);
  return unknown ? null : rows.flatMap(row => row.detailRecorded ? row.trip.stops : []);
}

export function stopCounts(rows: OperationsTrip[]) {
  const stopsTotal = rows.reduce((n, row) => n + row.stopsTotal, 0);
  const stops = knownStops(rows);
  if (stops === null) return { stopsTotal, stopsDelivered: null, stopsDone: null, partialStops: null, noGoodsStops: null, closedStops: null };
  return { stopsTotal, stopsDelivered: stops.filter(goodsHandedOver).length,
    stopsDone: stops.filter(stop => stop.outcome !== null).length,
    partialStops: stops.filter(stop => goodsHandedOver(stop) && stop.outcome === 'refused' && stop.lines.some(line => (line.loaded ?? 0) > (line.delivered ?? 0))).length,
    noGoodsStops: stops.filter(stop => endedWithGoods(stop) && deliveredUnits(stop) === 0).length,
    closedStops: stops.filter(stop => stop.outcome === 'closed').length };
}

// The dashboard's district map (spec 019): each of the depot's districts by name with its active shops, and how many
// of them had at least one stop on the day's plan and goods handed over at every one (rule 3). Shops with no stop
// today stay in the total. Unknown in every district while the day's stops are, as the tile's count is.
export function districtMap(shops: { id: string; district: string }[], rows: OperationsTrip[]): OperationsMap {
  const stops = knownStops(rows);
  const delivered = (shopId: string) => {
    const own = (stops ?? []).filter(stop => stop.outletId === shopId);
    return own.length > 0 && own.every(goodsHandedOver);
  };
  const districts = [...new Set(shops.map(shop => shop.district))].sort().map(district => {
    const own = shops.filter(shop => shop.district === district);
    return { district, shops: own.length, shopsDelivered: stops === null ? null : own.filter(shop => delivered(shop.id)).length };
  });
  return { shops: shops.length, districts };
}

export const compareTrips = (a: OperationsTrip, b: OperationsTrip) =>
  (a.detailRecorded ? a.schedule.leavesAt : '~').localeCompare(b.detailRecorded ? b.schedule.leavesAt : '~') || a.vehicleId.localeCompare(b.vehicleId) || a.tripNo - b.tripNo;

export function groupTrips(rows: OperationsTrip[]) {
  const brands = ['Fresh', 'Style', 'Tech', null] as const;
  const totals = (trips: OperationsTrip[]) => {
    const { stopsTotal, stopsDone } = stopCounts(trips);
    return { tripsTotal: trips.length, vehiclesTotal: new Set(trips.map(trip => trip.vehicleId)).size, stopsTotal, stopsDone };
  };
  const brandTotals = brands.filter(brand => rows.some(row => row.brand === brand)).map(brand => {
    const total = totals(rows.filter(row => row.brand === brand));
    return { brand, ...total, progress: progress(total.stopsDone, total.stopsTotal) };
  });
  const groups = brandTotals.flatMap(({ brand }) => {
    const own = rows.filter(row => row.brand === brand);
    // The planner uses district text order after brand priority.
    return [...new Set(own.map(row => row.district))].sort().map(district => {
      const trips = own.filter(row => row.district === district).sort(compareTrips);
      return { brand, district, ...totals(trips), trips };
    });
  });
  return { brandTotals, groups };
}

export function nextDemand(rows: { id: string; deliveryDate: string; status: string }[], membership: Set<string>, watched: string, next: string, published: boolean): number {
  return new Set(rows.filter(row => row.deliveryDate <= next && (published || row.deliveryDate > watched)
    && !['draft', 'split', 'cancelled'].includes(row.status)
    && (row.status === 'placed' || row.status === 'deferred' || membership.has(row.id))).map(row => row.id)).size;
}
