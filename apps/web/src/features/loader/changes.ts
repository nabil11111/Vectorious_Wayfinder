import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BRANDS, type LoadingDay } from '@wayfinder/contracts';
import { z } from 'zod';
import { meKey, useMe } from '@/features/auth/api';
import { dismissRefusal, useLoadingDay } from './loading';
import { brandOfShop, clockTime, lineWords, unitsWords } from './words';

// The loader's Plan changed notice (spec 016 rule 9, D-70, D-71). The tablet keeps the last two publications it read,
// in this tab's session storage for this account, depot, demo day and day, and compares them: by vehicle and trip
// number, shop and order, never by the trip and stop ids a save replaces. Got it closes the notice on this tab only;
// nothing is written to the server, and the server still checks every loading write.

// ── What a publication keeps: only what the comparison and its screen need ───────────────────────────────────────
const KeptLine = z.object({ lineId: z.string(), orderId: z.string(), quantity: z.number(), temp: z.enum(['chilled', 'dry']), unit: z.string(), name: z.string() });
const KeptStop = z.object({ seq: z.number(), outletId: z.string(), shopName: z.string(), units: z.number(), lines: z.array(KeptLine) });
const KeptTrip = z.object({
  vehicleId: z.string(), tripNo: z.number(), vehicleType: z.enum(['truck', 'van']), vehicleTemp: z.enum(['reefer', 'ambient']), brand: z.enum(BRANDS).nullable(),
  district: z.string(), driver: z.string().nullable(), leavesAt: z.string(), units: z.number(), stops: z.array(KeptStop),
});
export type KeptTrip = z.infer<typeof KeptTrip>;
const Publication = z.object({ planId: z.string(), revision: z.number(), publishedAt: z.string(), publishedBy: z.string().nullable(), trips: z.array(KeptTrip) });
export type Publication = z.infer<typeof Publication>;

// The publication a loading day holds, its trips in leaving order and their stops in delivery order. null while the
// day has no sent plan.
export function publicationOf(day: LoadingDay): Publication | null {
  if (!day.plan) return null;
  return {
    planId: day.plan.id, revision: day.plan.revision, publishedAt: day.plan.publishedAt, publishedBy: day.plan.publishedBy,
    trips: day.trucks.map((truck) => ({
      vehicleId: truck.vehicleId, tripNo: truck.tripNo, vehicleType: truck.vehicleType, vehicleTemp: truck.vehicleTemp, brand: truck.brand, district: truck.district,
      driver: truck.driver, leavesAt: truck.leavesAt, units: truck.units,
      stops: [...truck.stops].sort((a, b) => a.seq - b.seq).map((stop) => ({
        seq: stop.seq, outletId: stop.outletId, shopName: stop.shopName, units: stop.units,
        lines: stop.lines.map((line) => ({ lineId: line.lineId, orderId: line.orderId, quantity: line.quantity, temp: line.temp, unit: line.unit, name: line.name })),
      })),
    })),
  };
}

// ── The comparison ───────────────────────────────────────────────────────────────────────────────────────────────
// What changed on a trip: its vehicle (a move), its driver, when it leaves, its stops' order, or its goods.
const DETAILS = ['vehicle', 'driver', 'leaves', 'stops', 'goods'] as const;
export type ChangeDetail = (typeof DETAILS)[number];
const ChangeRow = z.object({ kind: z.enum(['moved', 'changed', 'added', 'removed']), before: KeptTrip.nullable(), after: KeptTrip.nullable(), details: z.array(z.enum(DETAILS)) });
export type ChangeRow = z.infer<typeof ChangeRow>;

// A truck on the list by what stays across a save: its vehicle and its trip number.
export const truckKey = (trip: { vehicleId: string; tripNo: number }) => `${trip.vehicleId}#${trip.tripNo}`;
const ordersOf = (trip: KeptTrip) => [...new Set(trip.stops.flatMap((stop) => stop.lines.map((line) => line.orderId)))].sort();
const goodsOf = (trip: KeptTrip) => trip.stops.flatMap((stop) => stop.lines.map((line) => `${stop.outletId}:${line.orderId}:${line.lineId}:${line.quantity}`)).sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);
// Orders a publication puts on more than one trip. Membership is unique, so such a trip is malformed and is never paired.
const repeated = (publication: Publication) => {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const trip of publication.trips) for (const order of ordersOf(trip)) (seen.has(order) ? twice : seen).add(order);
  return twice;
};

function detailsOf(before: KeptTrip, after: KeptTrip): ChangeDetail[] {
  return DETAILS.filter((detail) => {
    if (detail === 'vehicle') return before.vehicleId !== after.vehicleId;
    if (detail === 'driver') return before.driver !== after.driver;
    if (detail === 'leaves') return before.leavesAt !== after.leavesAt;
    if (detail === 'stops') return !same(before.stops.map((stop) => stop.outletId), after.stops.map((stop) => stop.outletId));
    return !same(goodsOf(before), goodsOf(after));
  });
}

// The rows of Plan changed, in the new list's order and then the trips taken off. A trip that kept its vehicle and trip
// number is matched first. A removed and an added trip with exactly the same, nonempty orders are one Moved row; any
// other addition, removal, split or partial move stays its own row.
export function comparePublications(before: Publication, after: Publication): ChangeRow[] {
  const old = new Map(before.trips.map((trip) => [truckKey(trip), trip]));
  const now = new Map(after.trips.map((trip) => [truckKey(trip), trip]));
  const rows: { row: ChangeRow; at: number }[] = [];
  const at = (trip: KeptTrip) => after.trips.indexOf(trip);
  for (const trip of after.trips) {
    const was = old.get(truckKey(trip));
    const details = was ? detailsOf(was, trip) : [];
    if (was && details.length > 0) rows.push({ row: { kind: 'changed', before: was, after: trip, details }, at: at(trip) });
  }
  const removed = before.trips.filter((trip) => !now.has(truckKey(trip)));
  const added = after.trips.filter((trip) => !old.has(truckKey(trip)));
  const twiceBefore = repeated(before);
  const twiceAfter = repeated(after);
  const paired = new Set<KeptTrip>();
  for (const was of removed) {
    const orders = ordersOf(was);
    if (orders.length === 0 || orders.some((order) => twiceBefore.has(order))) continue;
    const trip = added.find((candidate) => !paired.has(candidate) && !ordersOf(candidate).some((order) => twiceAfter.has(order)) && same(ordersOf(candidate), orders));
    if (!trip) continue;
    paired.add(was).add(trip);
    rows.push({ row: { kind: 'moved', before: was, after: trip, details: detailsOf(was, trip) }, at: at(trip) });
  }
  for (const trip of added) if (!paired.has(trip)) rows.push({ row: { kind: 'added', before: null, after: trip, details: [] }, at: at(trip) });
  removed.forEach((was, i) => { if (!paired.has(was)) rows.push({ row: { kind: 'removed', before: was, after: null, details: [] }, at: after.trips.length + i }); });
  return rows.sort((a, b) => a.at - b.at).map(({ row }) => row);
}

// The trucks on the current list that a row names: they get the changed chip. The bell counts the rows.
export const changedKeys = (rows: ChangeRow[]) => new Set(rows.flatMap((row) => (row.after ? [truckKey(row.after)] : [])));

// The order lines a goods change moved: those that left the trip, at the count it had, and those that joined it, at
// the count it has now. A line whose count changed is in both. Shown on the change card, so two trips to the same
// shops that swapped orders never read the same before and after.
export interface LineAt { lineId: string; shopName: string; quantity: number; temp: 'chilled' | 'dry'; unit: string; name: string }
const linesAt = (trip: KeptTrip | null) => new Map<string, LineAt>((trip?.stops ?? []).flatMap((stop) => stop.lines.map((line) => [line.lineId,
  { lineId: line.lineId, shopName: stop.shopName, quantity: line.quantity, temp: line.temp, unit: line.unit, name: line.name }] as const)));
export function goodsChange(row: ChangeRow): { left: LineAt[]; joined: LineAt[] } {
  const before = linesAt(row.before);
  const after = linesAt(row.after);
  return {
    left: [...before.values()].filter((line) => after.get(line.lineId)?.quantity !== line.quantity),
    joined: [...after.values()].filter((line) => before.get(line.lineId)?.quantity !== line.quantity),
  };
}

// What the change page shows: the wait sentence while the plan is back in edit (never the old cards), the
// comparison once there is one, or that nothing is kept.
export function pageOf(snapshot: Snapshot, day: LoadingDay | undefined): 'withdrawn' | 'compare' | 'none' {
  if (snapshot.kept && day && day.day !== null && day.plan === null) return 'withdrawn';
  return snapshot.kept?.changes ? 'compare' : 'none';
}

// The chips of the list on screen: only while that list is the publication the comparison was made for.
export function chipsOf(snapshot: Snapshot, day: LoadingDay | undefined) {
  const kept = snapshot.kept;
  if (!kept?.changes || !day?.plan || day.plan.id !== kept.latest.planId || day.plan.revision !== kept.latest.revision) return new Set<string>();
  return changedKeys(kept.changes);
}

// ── What this tab keeps ──────────────────────────────────────────────────────────────────────────────────────────
const PREFIX = 'wayfinder-plan-changes';
export interface Scope { account: string; depot: string; demoDay: number; day: string }
const keyOf = (scope: Scope) => `${PREFIX}:${scope.account}:${scope.depot}:${scope.demoDay}:${scope.day}`;
const Kept = z.object({
  v: z.literal(1), scope: z.string(), previous: Publication.nullable(), latest: Publication,
  // null until a second publication was read: the first read is the baseline and claims no change.
  changes: z.array(ChangeRow).nullable(),
  // The notice was opened once (the list opens it by itself only once), and Got it closed it.
  opened: z.boolean(), closed: z.boolean(),
});
export type Kept = z.infer<typeof Kept>;
// What the tab holds for the scope on show, and whether keeping it in storage failed, which the screen says.
export interface Snapshot { kept: Kept | null; failed: boolean }

export function createChangeStore(storage: () => Storage | null) {
  let state: Snapshot = { kept: null, failed: false };
  let held: string | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot) => { state = next; for (const listener of listeners) listener(); };

  // A session storage that fails is said on screen, and the comparison carries on in this tab's memory.
  function withStorage(work: (store: Storage) => void, what: string) {
    try {
      const store = storage();
      if (!store) throw new Error('This tablet has no session storage.');
      work(store);
      return true;
    } catch (error) {
      console.warn(`Could not ${what} the plan comparison on this tablet.`, error);
      return false;
    }
  }
  // Entries of other scopes go: another account's, depot's, demo day's or day's comparison is never shown.
  const discard = (keep: string | null) => withStorage((store) => {
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX) && key !== keep) store.removeItem(key);
    }
  }, 'clear');
  function read(key: string): Snapshot {
    let kept: Kept | null = null;
    const ok = withStorage((store) => {
      const text = store.getItem(key);
      if (text === null) return;
      const parsed = Kept.safeParse(JSON.parse(text));
      if (parsed.success && parsed.data.scope === key) kept = parsed.data;
      else store.removeItem(key);
    }, 'read');
    // What could not be read starts again from a first visit: no change is claimed.
    if (!ok) withStorage((store) => store.removeItem(key), 'clear');
    return { kept, failed: !ok };
  }
  function save(kept: Kept) {
    const ok = withStorage((store) => store.setItem(kept.scope, JSON.stringify(kept)), 'keep');
    publish({ kept, failed: state.failed || !ok });
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    // Every read of the loading day passes through here. A first read is the baseline; the same publication again,
    // with loading under way, changes nothing; no plan keeps the last one, in storage only; a new one is compared
    // with the last one this tab read, Got it or not.
    observe(scope: Scope | null, day: LoadingDay) {
      if (!scope) {
        if (held !== null || state.kept) { held = null; discard(null); publish({ kept: null, failed: false }); }
        return;
      }
      const key = keyOf(scope);
      if (held !== key) {
        held = key;
        const ok = discard(key);
        const kept = read(key);
        state = { kept: kept.kept, failed: kept.failed || !ok };
      }
      const latest = publicationOf(day);
      const kept = state.kept;
      if (!latest) { publish(state); return; }
      if (!kept) { save({ v: 1, scope: key, previous: null, latest, changes: null, opened: false, closed: false }); return; }
      if (kept.latest.planId === latest.planId && kept.latest.revision === latest.revision) { publish(state); return; }
      save({ v: 1, scope: key, previous: kept.latest, latest, changes: comparePublications(kept.latest, latest), opened: false, closed: false });
    },
    markOpened() { if (state.kept && !state.kept.opened) save({ ...state.kept, opened: true }); },
    close() { if (state.kept) save({ ...state.kept, opened: true, closed: true }); },
    // Sign-out: nothing of this account stays on the tablet.
    forget() { held = null; discard(null); publish({ kept: null, failed: false }); },
  };
}

// What the trucks list says about the publication on screen: wait while the plan is back in edit, or the notice of a
// newer publication that has not been closed yet.
export function noticeOf(snapshot: Snapshot, day: LoadingDay | undefined): 'withdrawn' | 'changed' | 'unchanged' | null {
  const kept = snapshot.kept;
  if (!kept || !day || day.day === null) return null;
  if (day.plan === null) return 'withdrawn';
  if (kept.changes === null || kept.closed || day.plan.id !== kept.latest.planId || day.plan.revision !== kept.latest.revision) return null;
  return kept.changes.length > 0 ? 'changed' : 'unchanged';
}

// ── The words, kept here rather than in the loader's shared words ────────────────────────────────────────────────
// "Plan changed 02:31 · Ruwan, dispatcher": the publication's own time and sender, or no name for a legacy plan.
export const planChangedLine = (publication: Publication) =>
  `Plan changed ${clockTime(publication.publishedAt)}${publication.publishedBy ? ` · ${publication.publishedBy}, dispatcher` : ''}`;
export const WITHDRAWN = 'The dispatcher took this plan back to edit. Wait for the new loading list.';
export const SENT_AGAIN = 'The plan was sent again. Truck details are unchanged.';
export const NONE_KEPT = 'No plan change is kept on this tablet.';
export const NOT_KEPT = 'Could not keep the plan comparison on this tablet.';
export const CHANGED = 'changed';
export const SEE_CHANGES = 'See what changed';
// A change card's title, "Kalutara · 41 cartons", its truck's line, "leaves 04:36 · Dilshan", and its stops in order.
export const changeTitle = (trip: KeptTrip) => `${trip.district} · ${unitsWords(trip.brand, trip.units)}`;
export const leavesLine = (trip: KeptTrip) => `leaves ${clockTime(trip.leavesAt)}`;
const place = (shopName: string) => { const brand = brandOfShop(shopName); return brand ? shopName.slice(brand.length + 1) : shopName; };
export const stopsLine = (trip: KeptTrip) => trip.stops.map((stop) => place(stop.shopName)).join(', ');
// A moved order line: "5 cartons dry for Borella", "10 boxes · Folded clothing for Maharagama".
export const lineAtWords = (line: LineAt, brand: KeptTrip['brand']) => `${lineWords(line, brand ?? brandOfShop(line.shopName))} for ${place(line.shopName)}`;
export const LEFT_TRIP = 'Left this trip';
export const JOINED_TRIP = 'Joined this trip';

// ── The tablet's store, and the hooks the loader's screens use ──────────────────────────────────────────────────
const store = createChangeStore(() => {
  // A browser that blocks storage throws on reaching it; the store then says it could not keep the comparison.
  try { return window.sessionStorage; } catch (error) { console.warn('This tablet blocks session storage.', error); return null; }
});

export const usePlanChanges = () => useSyncExternalStore(store.subscribe, store.snapshot);
export const markChangesOpened = () => store.markOpened();
export const closeChanges = () => store.close();

// Mounted once by LoaderHome: every read of the loading day goes into the comparison, and signing out forgets it.
export function usePlanWatch() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: day } = useLoadingDay();
  const account = me?.id ?? null;
  useEffect(() => {
    if (!day) return;
    store.observe(account && day.day ? { account, depot: day.depot, demoDay: day.demoDay, day: day.day } : null, day);
  }, [day, account]);
  useEffect(() => qc.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.query.queryKey[0] === meKey[0] && event.query.state.data === null) { store.forget(); dismissRefusal(); }
  }), [qc]);
}
