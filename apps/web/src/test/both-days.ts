import { Issue, IssueList, OperationsDay, type Me } from '@wayfinder/contracts';

// Test support for spec 021: two depots' reads that differ in every figure, so a test can tell a sum from either
// depot's own number and a row of one depot from a row of the other. The figures follow the seeded Wednesday: Peliyagoda
// with its 102 orders for Thursday and 6,945 of 18,600 L of fuel, Kandy with 64 orders and none of its 10,660 L used.

export const WED = '2026-06-24';
export const THU = '2026-06-25';
export const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
export const ON_BOTH: Me = { ...RUWAN, depotId: 'Both' };

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLAN = uuid(900);

export type DepotName = 'Peliyagoda' | 'Kandy';
// Each depot's districts and shops (outlets.csv) and its fleet (vehicles.csv).
export const DEPOT_DISTRICTS: Record<DepotName, [string, number][]> = {
  Peliyagoda: [['Colombo', 24], ['Galle', 9], ['Gampaha', 15], ['Kalutara', 10], ['Kurunegala', 8], ['Matara', 6], ['Puttalam', 3]],
  Kandy: [['Badulla', 6], ['Kandy', 20], ['Kegalle', 5], ['Matale', 8], ['Nuwara Eliya', 6]],
};
const FLEET: Record<DepotName, number> = { Peliyagoda: 38, Kandy: 22 };

export interface OutSpec { tripId: number; vehicleId: string; district: string; driver?: string; issueId?: string; raisedAt?: string }
export interface DaySpec {
  depot: DepotName;
  orders: number;
  fuel: { litres: number; quota: number } | null;
  deferred: number;
  plan: boolean;
  out?: OutSpec[];
  // Delivered and in all, of the watched day's stops; null when the plan's stops were not recorded.
  stops?: { delivered: number | null; total: number };
  readAt?: string;
}

// A depot's watched day, Wednesday, as the operations read sends it: its trips on the road are written as trips
// without recorded detail, the shortest the contract takes.
export function dayOf(spec: DaySpec): OperationsDay {
  const out = spec.out ?? [];
  const trips = out.map((trip) => ({
    detailRecorded: false, reason: 'legacy_plan', tripId: uuid(trip.tripId), planId: PLAN, date: WED, vehicleId: trip.vehicleId,
    vehicleType: 'truck', vehicleTemp: 'reefer', tripNo: 1, driver: trip.driver ? { id: uuid(trip.tripId + 500), name: trip.driver } : null, brand: 'Fresh',
    district: trip.district, status: 'out', openIssueIds: trip.issueId ? [trip.issueId] : [], stopsTotal: 1, action: trip.issueId ? 'decide' : 'open',
    stops: [{ id: uuid(trip.tripId + 700), seq: 1, outletId: 'OUT001', shopName: `Fresh ${trip.district}`, }],
    outRow: {
      progress: { numerator: null, denominator: 1, percent: null }, nextStop: null, plannedArrival: null, arrivalIsOriginal: false, plannedReturn: null,
      status: trip.issueId
        ? { kind: 'open_problem', issueId: trip.issueId, issueKind: 'loading', summary: 'Short', raisedAt: trip.raisedAt ?? '2026-06-23T21:03:00.000Z' }
        : { kind: 'unrecorded' },
    },
  }));
  const stops = spec.stops ?? { delivered: 0, total: 0 };
  const vehicles = FLEET[spec.depot];
  const districts = DEPOT_DISTRICTS[spec.depot];
  const percent = (value: number, total: number) => (total ? Math.round((value * 100) / total) : 0);
  const vehiclesOut = new Set(out.map((trip) => trip.vehicleId)).size;
  return OperationsDay.parse({
    depot: { id: spec.depot, name: spec.depot }, demoDay: 1, day: WED, dayChangesAt: '2026-06-24T10:30:00.000Z', readAt: spec.readAt ?? '2026-06-24T09:40:00.000Z',
    plan: spec.plan ? { id: PLAN, revision: 0, publishedAt: '2026-06-23T11:30:00.000Z', detailRecorded: false } : null,
    counts: {
      stopsTotal: stops.total, stopsDelivered: stops.delivered, stopsDone: stops.delivered, partialStops: stops.delivered === null ? null : 0,
      noGoodsStops: stops.delivered === null ? null : 0, closedStops: stops.delivered === null ? null : 0, tripsTotal: trips.length, vehiclesOut, vehiclesTotal: vehicles,
      deferredOrders: spec.deferred,
      deliveryProgress: { numerator: stops.delivered, denominator: stops.total, percent: stops.delivered === null ? null : percent(stops.delivered, stops.total) },
      truckProgress: { numerator: vehiclesOut, denominator: vehicles, percent: percent(vehiclesOut, vehicles) },
    },
    map: { shops: districts.reduce((sum, [, shops]) => sum + shops, 0), districts: districts.map(([district, shops]) => ({ district, shops, shopsDelivered: 0 })) },
    nextRun: { date: THU, cutoffAt: '2026-06-24T10:30:00.000Z', orders: spec.orders },
    fuel: spec.fuel ? { isoYear: 2026, isoWeek: 26, litres: spec.fuel.litres, quotaLitres: spec.fuel.quota, percent: spec.fuel.quota ? percent(spec.fuel.litres, spec.fuel.quota) : null } : null,
    brandTotals: trips.length ? [{ brand: 'Fresh', tripsTotal: trips.length, vehiclesTotal: vehiclesOut, stopsTotal: trips.length, stopsDone: null, progress: { numerator: null, denominator: trips.length, percent: null } }] : [],
    groups: trips.length ? [{ brand: 'Fresh', district: trips[0]!.district, tripsTotal: trips.length, vehiclesTotal: vehiclesOut, stopsTotal: trips.length, stopsDone: null, trips }] : [],
    timeline: null, earlierOut: [], outTripIds: trips.map((trip) => trip.tripId), events: [], eventsTruncated: false,
  });
}

// The seeded Wednesday before any plan for Thursday: Peliyagoda's 102 orders with its 4 carried over and its sent plan
// for Wednesday, Kandy's 64 with no plan out.
export const PELIYAGODA_DAY = () => dayOf({ depot: 'Peliyagoda', orders: 102, fuel: { litres: 6945, quota: 18600 }, deferred: 4, plan: true });
export const KANDY_DAY = () => dayOf({ depot: 'Kandy', orders: 64, fuel: { litres: 0, quota: 10660 }, deferred: 0, plan: false });

export interface IssueSpec { n: number; shop: string; vehicleId: string; raisedBy: string; raisedAt: string; hasPhoto?: boolean; refused?: boolean }
// A loader's open flag: 2 of 8 chilled cartons short at the dock; or with refused, a driver's: the shop took 6 of 8
// chilled cartons and refused 2 as damaged.
export function issueOf(spec: IssueSpec): Issue {
  const refused = spec.refused ?? false;
  return Issue.parse({
    id: uuid(spec.n), revision: 0, kind: refused ? 'refused' : 'loading', reason: refused ? 'damaged' : 'short', status: 'open', raisedBy: spec.raisedBy,
    raisedAt: spec.raisedAt, note: null, decision: null, decidedBy: null, decidedAt: null, hasPhoto: spec.hasPhoto ?? false, short: 2, cold: null, replacement: null,
    trip: { id: uuid(spec.n + 100), vehicleId: spec.vehicleId, tripNo: 1, leavesAt: '2026-06-23T23:06:00.000Z', status: refused ? 'out' : 'loading', driver: refused ? spec.raisedBy : null, stopsLeft: 1 },
    stop: { id: uuid(spec.n + 200), seq: 1, outletId: 'OUT001', shopName: spec.shop, arrivedAt: refused ? '2026-06-23T23:40:00.000Z' : null, doneAt: refused ? '2026-06-23T23:48:00.000Z' : null,
      loadedAt: refused ? '2026-06-23T21:01:00.000Z' : null, flaggedAtDock: !refused },
    lines: [{ lineId: uuid(spec.n + 300), orderId: uuid(spec.n + 400), temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 8,
      counted: 6, loaded: refused ? 8 : null, delivered: refused ? 6 : null, received: null }],
  });
}
export const listOf = (issues: Issue[]): IssueList => IssueList.parse({ day: WED, replaceOn: THU, issues });
