import type { LoadingDay, LoadingTruck } from '@wayfinder/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { changedKeys, comparePublications, createChangeStore, goodsChange, noticeOf, pageOf, publicationOf, truckKey, type Scope } from './changes';

// Spec 016 rule 9 (D-70, D-71): the loader's tablet compares two publications it has read. These fixtures live in the
// test only. Trips and stops get new ids on every publication, as a save replaces them; orders and lines keep theirs.

type Line = [orderId: string, lineId: string, quantity: number, temp?: 'chilled' | 'dry'];
type Stop = [outletId: string, shopName: string, lines: Line[]];
interface TripSpec { vehicleId: string; tripNo?: number; leavesAt: string; driver: string | null; district: string; stops: Stop[] }

function truck(spec: TripSpec): LoadingTruck {
  const stops = spec.stops.map(([outletId, shopName, lines], i) => {
    const out = lines.map(([orderId, lineId, quantity, temp = 'chilled']) => ({
      lineId, orderId, temp, productId: `fresh-${temp}-carton`, name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', quantity, going: quantity, short: 0,
    }));
    const units = out.reduce((sum, line) => sum + line.quantity, 0);
    return { id: crypto.randomUUID(), seq: i + 1, outletId, shopName, loaded: false, units, going: units, short: 0, lines: out };
  });
  const units = stops.reduce((sum, stop) => sum + stop.units, 0);
  return {
    tripId: crypto.randomUUID(), revision: 0, vehicleId: spec.vehicleId, vehicleType: 'truck', vehicleTemp: 'reefer', tripNo: spec.tripNo ?? 1, brand: 'Fresh', district: spec.district,
    status: 'planned', leavesAt: spec.leavesAt, readyAt: null, driver: spec.driver, weightCapKg: 3990, volumeCapM3: 21.1, units, on: { units: 0, kg: 0, m3: 0 }, short: 0,
    // The loader's list carries its stops last stop first.
    stops: [...stops].reverse(), issues: [], outOn: null,
  };
}
const PLAN = crypto.randomUUID();
function published(revision: number, trips: TripSpec[], at = '2026-06-24T21:01:00.000Z'): LoadingDay {
  return { depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: { id: PLAN, revision, publishedAt: at, publishedBy: 'Ruwan' }, trucks: trips.map(truck), left: [] };
}
const withdrawn = (): LoadingDay => ({ depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25', plan: null, trucks: [], left: [] });

// The README's trip, VEH035 with Nugegoda's three orders and Wellawatte's two: 118 cartons.
const NUGEGODA: Stop = ['OUT001', 'Fresh Nugegoda', [['o1', 'l1', 12], ['o2', 'l2', 8], ['o3', 'l3', 4, 'dry']]];
const WELLAWATTE: Stop = ['OUT002', 'Fresh Wellawatte', [['o4', 'l4', 48], ['o5', 'l5', 46, 'dry']]];
const veh035 = (changes: Partial<TripSpec> = {}): TripSpec => ({ vehicleId: 'VEH035', leavesAt: '2026-06-24T23:06:00.000Z', driver: 'Dilshan', district: 'Colombo', stops: [NUGEGODA, WELLAWATTE], ...changes });
// The frame's depot (85:71921): VEH002's 41 cartons for Kalutara, and the trucks around it.
const KALUTARA: Stop = ['OUT042', 'Fresh Kalutara', [['o6', 'l6', 25], ['o7', 'l7', 16, 'dry']]];
const others: TripSpec[] = [
  { vehicleId: 'VEH004', leavesAt: '2026-06-24T22:10:00.000Z', driver: 'Chaminda', district: 'Colombo', stops: [['OUT004', 'Fresh Borella', [['o8', 'l8', 38]]]] },
  { vehicleId: 'VEH011', leavesAt: '2026-06-24T22:10:00.000Z', driver: 'Mahesh', district: 'Puttalam', stops: [['OUT075', 'Fresh Puttalam', [['o9', 'l9', 22, 'dry']]]] },
];
const veh002 = (changes: Partial<TripSpec> = {}): TripSpec => ({ vehicleId: 'VEH002', leavesAt: '2026-06-24T22:00:00.000Z', driver: 'Lasantha', district: 'Kalutara', stops: [KALUTARA], ...changes });
const compare = (before: LoadingDay, after: LoadingDay) => comparePublications(publicationOf(before)!, publicationOf(after)!);

describe('AC-21 publication comparison pairs whole trip moves once by exact orders', () => {
  it('finds nothing when a resend only made new trip and stop ids', () => {
    expect(compare(published(2, [veh035(), ...others]), published(4, [veh035(), ...others]))).toEqual([]);
  });

  it('pairs the removed and the added trip with exactly the same orders as one Moved row, bell 1, chipped on the new trip only', () => {
    const before = published(2, [veh002(), ...others]);
    const after = published(4, [veh002({ vehicleId: 'VEH001' }), ...others]);
    const rows = compare(before, after);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'moved', before: { vehicleId: 'VEH002', units: 41 }, after: { vehicleId: 'VEH001', units: 41 }, details: ['vehicle'] });
    const chips = changedKeys(rows);
    expect([...chips]).toEqual([truckKey({ vehicleId: 'VEH001', tripNo: 1 })]);
    expect(chips.has(truckKey({ vehicleId: 'VEH002', tripNo: 1 }))).toBe(false);
    expect(chips.has(truckKey({ vehicleId: 'VEH004', tripNo: 1 }))).toBe(false);
  });

  it('names a leave-time-only change as one row with the two times, the same stops and 118 cartons', () => {
    const rows = compare(published(2, [veh035()]), published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'changed', details: ['leaves'], before: { leavesAt: '2026-06-24T23:06:00.000Z', units: 118 }, after: { leavesAt: '2026-06-24T23:10:00.000Z', units: 118 } });
    expect(rows[0]!.after!.stops.map((stop) => stop.shopName)).toEqual(['Fresh Nugegoda', 'Fresh Wellawatte']);
  });

  it('separates driver, stop order and quantity changes', () => {
    expect(compare(published(2, [veh035()]), published(4, [veh035({ driver: 'Chaminda' })]))[0]!.details).toEqual(['driver']);
    expect(compare(published(2, [veh035()]), published(4, [veh035({ stops: [WELLAWATTE, NUGEGODA] })]))[0]!.details).toEqual(['stops']);
    const fewer: Stop = ['OUT002', 'Fresh Wellawatte', [['o4', 'l4', 48], ['o5', 'l5', 40, 'dry']]];
    expect(compare(published(2, [veh035()]), published(4, [veh035({ stops: [NUGEGODA, fewer] })]))[0]!.details).toEqual(['goods']);
    // A move that also changed the leaving time says both.
    const moved = compare(published(2, [veh002()]), published(4, [veh002({ vehicleId: 'VEH001', leavesAt: '2026-06-24T22:05:00.000Z' })]));
    expect(moved).toMatchObject([{ kind: 'moved', details: ['vehicle', 'leaves'] }]);
  });

  it('keeps a partial move as separate rows, and never pairs trips by equal quantities or shops', () => {
    const partial = compare(published(2, [veh002()]), published(4, [
      veh002({ stops: [['OUT042', 'Fresh Kalutara', [['o6', 'l6', 25]]]] }),
      veh002({ vehicleId: 'VEH001', stops: [['OUT042', 'Fresh Kalutara', [['o7', 'l7', 16, 'dry']]]] }),
    ]));
    expect(partial.map((row) => row.kind).sort()).toEqual(['added', 'changed']);
    expect(partial.find((row) => row.kind === 'changed')!.details).toEqual(['goods']);
    const lookalike = compare(published(2, [veh002()]), published(4, [veh002({ vehicleId: 'VEH009', stops: [['OUT042', 'Fresh Kalutara', [['o10', 'l10', 25], ['o11', 'l11', 16, 'dry']]]] })]));
    expect(lookalike.map((row) => row.kind).sort()).toEqual(['added', 'removed']);
    expect(changedKeys(lookalike)).toEqual(new Set([truckKey({ vehicleId: 'VEH009', tripNo: 1 })]));
  });

  it('names the order lines that left and joined, with their quantities, when goods move between trips to the same shop', () => {
    const borella = (lines: Line[]): Stop => ['OUT004', 'Fresh Borella', lines];
    const before = published(2, [
      { vehicleId: 'VEH004', leavesAt: '2026-06-24T22:10:00.000Z', driver: 'Chaminda', district: 'Colombo', stops: [borella([['o1', 'l1', 10], ['o2', 'l2', 5, 'dry']])] },
      { vehicleId: 'VEH005', leavesAt: '2026-06-24T22:15:00.000Z', driver: 'Nuwan', district: 'Colombo', stops: [borella([['o3', 'l3', 5, 'dry']])] },
    ]);
    const after = published(4, [
      { vehicleId: 'VEH004', leavesAt: '2026-06-24T22:10:00.000Z', driver: 'Chaminda', district: 'Colombo', stops: [borella([['o1', 'l1', 10], ['o3', 'l3', 5, 'dry']])] },
      { vehicleId: 'VEH005', leavesAt: '2026-06-24T22:15:00.000Z', driver: 'Nuwan', district: 'Colombo', stops: [borella([['o2', 'l2', 5, 'dry']])] },
    ]);
    const rows = compare(before, after);
    // The same shops and the same units on each truck: only the lines tell the two publications apart.
    expect(rows.map((row) => [row.after!.vehicleId, row.details])).toEqual([['VEH004', ['goods']], ['VEH005', ['goods']]]);
    expect(rows[0]!.before!.units).toBe(rows[0]!.after!.units);
    expect(goodsChange(rows[0]!)).toEqual({
      left: [{ lineId: 'l2', shopName: 'Fresh Borella', quantity: 5, temp: 'dry', unit: 'carton', name: 'Dry carton' }],
      joined: [{ lineId: 'l3', shopName: 'Fresh Borella', quantity: 5, temp: 'dry', unit: 'carton', name: 'Dry carton' }],
    });
    // A line whose quantity changed leaves at the old count and joins at the new one.
    const fewer: Stop = ['OUT002', 'Fresh Wellawatte', [['o4', 'l4', 48], ['o5', 'l5', 40, 'dry']]];
    const changed = compare(published(2, [veh035()]), published(4, [veh035({ stops: [NUGEGODA, fewer] })]))[0]!;
    expect(goodsChange(changed)).toMatchObject({ left: [{ lineId: 'l5', quantity: 46 }], joined: [{ lineId: 'l5', quantity: 40 }] });
  });

  it('does not pair a trip whose orders the publication lists twice', () => {
    const rows = compare(published(2, [veh002()]), published(4, [veh002({ vehicleId: 'VEH001' }), veh002({ vehicleId: 'VEH003' })]));
    expect(rows.map((row) => row.kind).sort()).toEqual(['added', 'added', 'removed']);
  });
});

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failWrites = false;
  failReads = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { if (this.failReads) throw new DOMException('Blocked', 'SecurityError'); return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { if (this.failWrites) throw new DOMException('Full', 'QuotaExceededError'); this.values.set(key, String(value)); }
}

const scope: Scope = { account: 'loader-kasun', depot: 'Peliyagoda', demoDay: 1, day: '2026-06-25' };
let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); });
const kept = () => [...storage.values.keys()].filter((key) => key.startsWith('wayfinder-plan-changes'));

describe('AC-22 withdrawal reload got it and scope changes preserve or clear comparison', () => {
  it('keeps the old list only in storage while the plan is back in edit, then compares on resend', () => {
    const store = createChangeStore(() => storage);
    const first = published(2, [veh035()]);
    store.observe(scope, first);
    expect(store.snapshot().kept).toMatchObject({ changes: null, latest: { planId: PLAN, revision: 2 } });
    expect(noticeOf(store.snapshot(), first)).toBeNull();

    const back = withdrawn();
    store.observe(scope, back);
    // The day itself has no trucks while withdrawn; the kept publication waits in storage and the screen says to wait.
    expect(back.trucks).toEqual([]);
    expect(noticeOf(store.snapshot(), back)).toBe('withdrawn');
    expect(kept()).toHaveLength(1);

    const resent = published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })], '2026-06-24T21:01:30.000Z');
    store.observe(scope, resent);
    expect(store.snapshot().kept).toMatchObject({ previous: { revision: 2 }, latest: { revision: 4, publishedBy: 'Ruwan' }, opened: false, closed: false });
    expect(store.snapshot().kept!.changes).toHaveLength(1);
    expect(noticeOf(store.snapshot(), resent)).toBe('changed');
  });

  it('survives a reload of the tab, and Got it keeps the bell and chips', () => {
    const store = createChangeStore(() => storage);
    store.observe(scope, published(2, [veh035()]));
    store.observe(scope, published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]));
    store.markOpened();

    const reloaded = createChangeStore(() => storage);
    const again = published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]);
    reloaded.observe(scope, again);
    expect(reloaded.snapshot().kept).toMatchObject({ opened: true, closed: false });
    expect(reloaded.snapshot().kept!.changes).toHaveLength(1);

    reloaded.close();
    expect(reloaded.snapshot().kept).toMatchObject({ opened: true, closed: true });
    expect(reloaded.snapshot().kept!.changes).toHaveLength(1);
    expect(changedKeys(reloaded.snapshot().kept!.changes!)).toEqual(new Set(['VEH035#1']));
    // Got it does not touch the list: it is the read's.
    expect(noticeOf(reloaded.snapshot(), again)).toBeNull();
  });

  it('lets a newer publication replace the comparison, against the last one this tab saw, Got it or not', () => {
    const store = createChangeStore(() => storage);
    store.observe(scope, published(2, [veh035()]));
    store.observe(scope, published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]));
    store.close();
    store.observe(scope, published(6, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z', driver: 'Chaminda' })]));
    expect(store.snapshot().kept).toMatchObject({ previous: { revision: 4 }, latest: { revision: 6 }, closed: false, opened: false });
    expect(store.snapshot().kept!.changes).toMatchObject([{ kind: 'changed', details: ['driver'] }]);
  });

  it('says an identical resend was sent again, with no changed chip', () => {
    const store = createChangeStore(() => storage);
    store.observe(scope, published(2, [veh035()]));
    const same = published(4, [veh035()]);
    store.observe(scope, same);
    expect(store.snapshot().kept!.changes).toEqual([]);
    expect(noticeOf(store.snapshot(), same)).toBe('unchanged');
    expect(changedKeys(store.snapshot().kept!.changes!).size).toBe(0);
  });

  it('clears the comparison for another account, depot, day or demo generation, and on sign-out', () => {
    for (const other of [{ account: 'loader-other' }, { depot: 'Kandy' }, { day: '2026-06-26' }, { demoDay: 2 }]) {
      storage = new MemoryStorage();
      const store = createChangeStore(() => storage);
      store.observe(scope, published(2, [veh035()]));
      store.observe(scope, published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]));
      const next = { ...scope, ...other };
      store.observe(next, { ...published(8, [veh035({ leavesAt: '2026-06-24T23:20:00.000Z' })]), day: next.day, demoDay: next.demoDay });
      // The new scope starts from its own first read, and the old scope's entry is gone.
      expect(store.snapshot().kept).toMatchObject({ changes: null, previous: null, latest: { revision: 8 } });
      expect(kept()).toHaveLength(1);
    }
    const store = createChangeStore(() => storage);
    store.observe(scope, published(2, [veh035()]));
    store.forget();
    expect(kept()).toEqual([]);
    expect(store.snapshot().kept).toBeNull();
  });
});

describe('AC-22 the change page while the plan is back in edit', () => {
  it('says to wait while the plan is withdrawn, instead of the old cards, and compares again on resend', () => {
    const store = createChangeStore(() => storage);
    store.observe(scope, published(2, [veh035()]));
    expect(pageOf(store.snapshot(), published(2, [veh035()]))).toBe('none');
    const resent = published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]);
    store.observe(scope, resent);
    expect(pageOf(store.snapshot(), resent)).toBe('compare');
    // The loader is on the change page when the dispatcher takes the plan back again.
    const back = withdrawn();
    store.observe(scope, back);
    expect(pageOf(store.snapshot(), back)).toBe('withdrawn');
    const again = published(6, [veh035({ leavesAt: '2026-06-24T23:20:00.000Z' })]);
    store.observe(scope, again);
    expect(pageOf(store.snapshot(), again)).toBe('compare');
    expect(store.snapshot().kept).toMatchObject({ previous: { revision: 4 }, latest: { revision: 6 } });
    // A tab that never read a publication has nothing to compare, withdrawn or not.
    expect(pageOf({ kept: null, failed: false }, back)).toBe('none');
  });
});

describe('AC-23 first visit progress and storage failure cannot invent a change', () => {
  it('takes a first read as the baseline and ignores loading progress on the same publication', () => {
    const store = createChangeStore(() => storage);
    const first = published(2, [veh035(), ...others]);
    store.observe(scope, first);
    expect(store.snapshot().kept!.changes).toBeNull();
    // Kasun starts VEH035 and loads a stop, and VEH004 leaves the list once it drove out: the same publication.
    const loading = structuredClone(first);
    loading.trucks[0]!.status = 'loading';
    loading.trucks[0]!.stops[0]!.loaded = true;
    loading.trucks[0]!.on = { units: 94, kg: 650, m3: 3.5 };
    loading.trucks = loading.trucks.filter((t) => t.vehicleId !== 'VEH004');
    store.observe(scope, loading);
    expect(store.snapshot().kept).toMatchObject({ changes: null, latest: { revision: 2 } });
    expect(noticeOf(store.snapshot(), loading)).toBeNull();
  });

  it('says it could not keep the comparison when storage fails, and still compares in this tab', () => {
    storage.failWrites = true;
    const store = createChangeStore(() => storage);
    const first = published(2, [veh035()]);
    store.observe(scope, first);
    expect(store.snapshot()).toMatchObject({ failed: true, kept: { changes: null } });
    const resent = published(4, [veh035({ leavesAt: '2026-06-24T23:10:00.000Z' })]);
    store.observe(scope, resent);
    expect(store.snapshot().failed).toBe(true);
    expect(store.snapshot().kept!.changes).toHaveLength(1);
    // The list on screen is the read's own; nothing here changes it.
    expect(resent.trucks).toHaveLength(1);
  });

  it('starts from a first visit when what was kept cannot be read, without claiming a change', () => {
    storage.setItem(`wayfinder-plan-changes:${scope.account}:${scope.depot}:${scope.demoDay}:${scope.day}`, '{"v":1,"broken');
    const store = createChangeStore(() => storage);
    store.observe(scope, published(4, [veh035()]));
    expect(store.snapshot().kept).toMatchObject({ changes: null, previous: null });
    const blocked = new MemoryStorage();
    blocked.failReads = true;
    const other = createChangeStore(() => blocked);
    other.observe(scope, published(4, [veh035()]));
    expect(other.snapshot()).toMatchObject({ failed: true, kept: { changes: null } });
  });
});
