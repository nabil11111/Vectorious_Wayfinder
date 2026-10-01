import { tripFigures, type DriverTrip, type OperationsFigures, type OperationsProgress, type OperationsTrip } from '@wayfinder/contracts';
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

export function stopCounts(rows: OperationsTrip[]) {
  const stopsTotal = rows.reduce((n, row) => n + row.stopsTotal, 0);
  const unknown = stopsTotal > 0 && rows.some(row => !row.detailRecorded);
  const stops = rows.flatMap(row => row.detailRecorded ? row.trip.stops : []);
  const delivered = (stop: DriverTrip['stops'][number]) => stop.lines.reduce((n, line) => n + (line.delivered ?? 0), 0);
  const goods = stops.filter(stop => stop.outcome === 'delivered' || stop.outcome === 'refused');
  return { stopsTotal, stopsDelivered: unknown ? null : goods.filter(stop => delivered(stop) > 0).length,
    stopsDone: unknown ? null : stops.filter(stop => stop.outcome !== null).length,
    partialStops: unknown ? null : goods.filter(stop => delivered(stop) > 0 && stop.outcome === 'refused' && stop.lines.some(line => (line.loaded ?? 0) > (line.delivered ?? 0))).length,
    noGoodsStops: unknown ? null : goods.filter(stop => delivered(stop) === 0).length,
    closedStops: unknown ? null : stops.filter(stop => stop.outcome === 'closed').length };
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
