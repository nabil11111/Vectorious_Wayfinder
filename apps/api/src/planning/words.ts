import type { EngineVehicle, Minutes, PlanTrip } from './types';

// How the checker writes times, amounts, orders and vehicles in its messages, so every rule reads the same.

// '03:30' to 210. Used by the code that prepares the checker's input, and by tests.
export function toMinutes(clock: string): Minutes {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) throw new Error(`Not a time of day: ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// 210 to '03:30'. A trip that runs past midnight reads as 24:10, never wrapping back to 00:10.
export function toClock(minutes: Minutes): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const trim = (n: number, decimals: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: decimals });

// 1242 to '1,242 kg', 331.2 to '331.2 kg'.
export const kg = (n: number) => `${trim(n, 1)} kg`;
// 22.8 to '22.8 m³', 1.776 to '1.776 m³'.
export const m3 = (n: number) => `${trim(n, 3)} m³`;
// 63.6 to '63.6 litres'.
export const litres = (n: number) => `${trim(n, 1)} litres`;

// What a sentence calls an order: '276 kg chilled order for Fresh Nugegoda'. A Fresh shop has a chilled and a
// dry order most days, and a split order leaves two for one shop (D-17), so the shop alone does not say which.
// It comes with no "a" or "an", because 800 kg would need the other one. The sentence puts "the" in front.
export const orderCalled = (kilos: number, chilled: boolean, shop: string) => `${kg(kilos)} ${chilled ? 'chilled' : 'dry'} order for ${shop}`;

// What a sentence calls a vehicle: by its driver when its trip has one, "Chaminda's dry truck" (spec 026), and
// otherwise by its kind in the board's own words and its id, "the reefer truck VEH001", "the dry truck VEH044", "the
// reefer van VEH035" or "the van VEH037" (spec 024).
type Vehicle = Pick<EngineVehicle, 'id' | 'type' | 'temp'>;
const kindOf = ({ type, temp }: Vehicle) => (type === 'van' ? (temp === 'reefer' ? 'reefer van' : 'van') : temp === 'reefer' ? 'reefer truck' : 'dry truck');
// The name a sentence calls a driver by: trimmed, and none at all when it is blank, so an optional name never spoils a
// sentence or stops a plan (spec 026).
export const driverNameOf = (name: unknown): string | undefined => (typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined);
export const vehicleCalled = (vehicle: Vehicle, driverName?: string) => {
  const name = driverNameOf(driverName);
  return name ? `${name}'s ${kindOf(vehicle)}` : `the ${kindOf(vehicle)} ${vehicle.id}`;
};
// The driver a sentence about a whole vehicle names: the one its trips carry. A vehicle has one driver for both its
// trips (D-31), so the first trip that names one is enough.
export const driverOf = (trips: readonly PlanTrip[], vehicleId: string) =>
  trips.map((trip) => (trip.vehicleId === vehicleId ? driverNameOf(trip.driverName) : undefined)).find((name) => name !== undefined);

// A trip is numbered only where that tells it from the vehicle's other trip (spec 024). A vehicle's second trip is
// "the second trip of the reefer truck VEH001", or "its second trip" once the sentence has named the vehicle. Its
// first or only trip gets no number: it is the vehicle itself, and itsTrip gives null for the sentence to say it
// in its own words.
export const isSecondTrip = (tripNo: number) => tripNo === 2;
export const tripCalled = (vehicle: Vehicle, tripNo: number, driverName?: string) =>
  (isSecondTrip(tripNo) ? `the second trip of ${vehicleCalled(vehicle, driverName)}` : vehicleCalled(vehicle, driverName));
export const itsTrip = (tripNo: number) => (isSecondTrip(tripNo) ? 'its second trip' : null);
// " on its second trip" after what a vehicle carries, and nothing for its first or only trip.
export const onItsTrip = (tripNo: number) => (isSecondTrip(tripNo) ? ' on its second trip' : '');

// A sentence that leads with a vehicle starts "The dry truck VEH044".
export const capital = (sentence: string) => sentence.charAt(0).toUpperCase() + sentence.slice(1);
