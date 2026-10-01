import type { Brand, FlagReason, IssueDecision, LoadingDecision, RefusalReason, ShortReason, Temp } from '@wayfinder/contracts';
import { depotClock, depotDate } from '../lib/clock';
import { capital, tripCalled } from '../planning/words';
import { dayLabel } from '../plans/board-day';

// The lines of the bell's pop-up (spec 025), worded here from plain facts, so a screen only lays them out (rule 12).
// Trucks are named as each person finds them (spec 026, D-100): by their driver for the dispatcher and the shop,
// "Wasantha's reefer van", and by the vehicle number for the loader and the driver, who must find the actual truck.

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const whole = (n: number) => WHOLE.format(n);
const UNITS: Record<Brand, [string, string]> = { Fresh: ['carton', 'cartons'], Style: ['box', 'boxes'], Tech: ['item', 'items'] };
const unitOf = (brand: Brand | null, n: number) => (brand ? UNITS[brand] : ['unit', 'units'] as const)[n === 1 ? 0 : 1];

// Units by temperature, the way every count here is kept.
export type ByTemp = Record<Temp, number>;
export const noUnits = (): ByTemp => ({ chilled: 0, dry: 0 });
const total = (units: ByTemp) => units.chilled + units.dry;

// "8 chilled cartons", "20 chilled and 3 dry cartons", "1 dry carton", "37 boxes", "3 items".
export function goodsWords(brand: Brand | null, units: ByTemp): string {
  const all = total(units);
  if (brand !== 'Fresh') return `${whole(all)} ${unitOf(brand, all)}`;
  const temps = (['chilled', 'dry'] as const).filter((temp) => units[temp] > 0);
  if (temps.length === 2) return `${whole(units.chilled)} chilled and ${whole(units.dry)} dry ${unitOf(brand, all)}`;
  const temp = temps[0] ?? 'chilled';
  return `${whole(units[temp])} ${temp} ${unitOf(brand, units[temp])}`;
}

// "Thursday", for "Thursday's plan is out".
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

// A row's time on the app clock: "16:06" today, and "Tue 23 Jun 17:00" another day, as the shop's cards write it.
export function timeWords(at: Date, today: string): string {
  const day = depotDate(at);
  return day === today ? depotClock(at) : `${dayLabel(day)} ${depotClock(at)}`;
}

// A truck as the dispatcher and the shop name it: "Wasantha's reefer van", "the second trip of Wasantha's reefer van",
// and "the reefer van VEH035" with no driver. Sentences that lead with it give it a capital.
export interface TruckFacts { vehicleId: string; type: 'truck' | 'van'; temp: 'reefer' | 'ambient'; tripNo: number; driver: string | null }
export const truckCalled = (truck: TruckFacts) => tripCalled({ id: truck.vehicleId, type: truck.type, temp: truck.temp }, truck.tripNo, truck.driver ?? undefined);
const Truck = (truck: TruckFacts) => capital(truckCalled(truck));
// A truck as the loader and the driver find it: "VEH035", and "VEH035 trip 2" for its second trip.
export const truckNumber = (truck: Pick<TruckFacts, 'vehicleId' | 'tripNo'>) => (truck.tripNo > 1 ? `${truck.vehicleId} trip ${truck.tripNo}` : truck.vehicleId);
const driverOf = (truck: Pick<TruckFacts, 'driver'>) => truck.driver ?? 'The driver';
const stopsWords = (n: number) => `${whole(n)} ${n === 1 ? 'stop' : 'stops'}`;
// "117 of 118 on, 1 short", or "118 of 118 on" when nothing was left at the dock.
const loadedWords = (loaded: number, ordered: number) => `${whole(loaded)} of ${whole(ordered)} on${ordered > loaded ? `, ${whole(ordered - loaded)} short` : ''}`;

// ── A store manager's ─────────────────────────────────────────────────────────────────────────────────────────

export const orderPlacedLine = (brand: Brand, units: ByTemp, date: string) => `Your order is placed: ${goodsWords(brand, units)} for ${dayLabel(date)}`;
// The rule's worked example: "Thursday's delivery is planned: Wasantha's reefer van, window 05:00 to 07:30".
export const deliveryPlannedLine = (date: string, truck: TruckFacts, window: { open: string; close: string }) =>
  `${weekdayOf(date)}'s delivery is planned: ${truckCalled(truck)}, window ${window.open} to ${window.close}`;
export const orderMovedLine = (brand: Brand, units: ByTemp, date: string, reason: string) => `${goodsWords(brand, units)} will not come on ${dayLabel(date)}: ${reason}`;
export const truckLeftForShopLine = (truck: TruckFacts, seq: number, stops: number) => `${Truck(truck)} left the depot: you are stop ${whole(seq)} of ${whole(stops)}`;
export const driverArrivedLine = (truck: TruckFacts) => `${driverOf(truck)} has arrived`;
export const deliveredLine = (truck: TruckFacts, brand: Brand, delivered: ByTemp) => `${driverOf(truck)} delivered ${goodsWords(brand, delivered)}. Confirm what you received.`;
export const refusedAtDoorLine = (truck: TruckFacts, brand: Brand, delivered: ByTemp, loaded: ByTemp) =>
  `${driverOf(truck)} delivered ${whole(total(delivered))} of ${whole(total(loaded))} ${unitOf(brand, total(loaded))}, with ${whole(total(loaded) - total(delivered))} refused`;
export const shopClosedLine = (truck: TruckFacts, brand: Brand, units: ByTemp) => `${driverOf(truck)} found the shop closed: ${goodsWords(brand, units)} not delivered`;

// What a shop's report said (Q-40): "1 chilled carton missing", "1 chilled carton missing, 2 dry cartons damaged",
// "chilled goods not cold".
export function reportWords(brand: Brand, lines: { temp: Temp; units: number; reason: ShortReason | null }[], warm: boolean): string {
  const reasons = [...new Set(lines.flatMap((line) => (line.units > 0 && line.reason ? [line.reason] : [])))];
  const parts = reasons.map((reason) => {
    const units = noUnits();
    for (const line of lines) if (line.reason === reason) units[line.temp] += line.units;
    return `${goodsWords(brand, units)} ${reason}`;
  });
  if (warm || parts.length === 0) parts.push('chilled goods not cold');
  return parts.join(', ');
}
// The depot's answer to it: "The depot answered your report, 1 chilled carton missing: a replacement comes on Fri 26
// Jun", or "…: no replacement".
export function reportAnsweredLine(report: string, decision: IssueDecision, replacement: { day: string; units: number } | null): string {
  const answer = decision === 'send_replacements' && replacement
    ? `${replacement.units === 1 ? 'a replacement comes' : `${whole(replacement.units)} replacements come`} on ${dayLabel(replacement.day)}`
    : 'no replacement';
  return `The depot answered your report, ${report}: ${answer}`;
}

// ── A dispatcher's ────────────────────────────────────────────────────────────────────────────────────────────

const FLAG_WORDS: Record<FlagReason, string> = { short: 'short', damaged: 'damaged', wrong_item: 'wrong', wont_fit: "that won't fit" };
const REFUSAL_WORDS: Record<RefusalReason, string> = { damaged: 'damaged', expired: 'expired', not_ordered: 'not ordered' };
export const flagRaisedLine = (by: string, brand: Brand | null, units: ByTemp, reason: FlagReason, shop: string, truck: TruckFacts) =>
  `${by} flagged ${goodsWords(brand, units)} ${FLAG_WORDS[reason]} for ${shop} on ${truckCalled(truck)}`;
export const refusalRaisedLine = (shop: string, brand: Brand | null, units: ByTemp, reason: RefusalReason, truck: TruckFacts) =>
  `${shop} refused ${goodsWords(brand, units)} from ${truckCalled(truck)}: ${REFUSAL_WORDS[reason]}`;
export const closedRaisedLine = (shop: string, brand: Brand | null, units: ByTemp, truck: TruckFacts) =>
  `Nobody at ${shop}: ${goodsWords(brand, units)} still on ${truckCalled(truck)}`;
export const reportRaisedLine = (by: string, report: string, shop: string) => `${by} reported ${report} at ${shop}`;
export const truckReadyLine = (truck: TruckFacts, loaded: number, ordered: number) => `${Truck(truck)} is loaded and ready: ${loadedWords(loaded, ordered)}`;
export const truckLeftLine = (truck: TruckFacts, stops: number) => `${Truck(truck)} left the depot with ${stopsWords(stops)}`;
export const truckBackLine = (truck: TruckFacts, done: number, stops: number) => `${Truck(truck)} is back at the depot: ${whole(done)} of ${stopsWords(stops)} done`;

// ── A loader's ────────────────────────────────────────────────────────────────────────────────────────────────

// "Thursday's plan is out: 27 trucks to load". Only the plan as it stands now has a count, so an earlier send of a
// plan sent again since says no number.
const toLoad = (trucks: number | null) => (trucks === null ? '' : `: ${whole(trucks)} ${trucks === 1 ? 'truck' : 'trucks'} to load`);
export const planOutLine = (date: string, trucks: number | null) => `${weekdayOf(date)}'s plan is out${toLoad(trucks)}`;
export const planChangedLine = (date: string, trucks: number | null) => `${weekdayOf(date)}'s plan changed${toLoad(trucks)}`;
export const planTakenBackLine = (date: string) => `${weekdayOf(date)}'s plan was taken back to edit. Wait for it to be sent again.`;
// The dispatcher's answer to a flag, as the loader's own screen says it (D-37, Q-20): "Ruwan answered on VEH035: Go with
// 1 dry carton short for Fresh Nugegoda."
export function flagAnsweredLine(by: string, truck: Pick<TruckFacts, 'vehicleId' | 'tripNo'>, decision: LoadingDecision, reason: FlagReason, brand: Brand | null, short: ByTemp, shop: string): string {
  const room = reason === 'wont_fit';
  const sentence = decision === 'load_all'
    ? `Load it all for ${shop}. ${room ? 'Make room for the rest.' : 'The rest comes from stock.'}`
    : room ? `Go without the ${goodsWords(brand, short)} that won't fit for ${shop}.` : `Go with ${goodsWords(brand, short)} short for ${shop}.`;
  return `${by} answered on ${truckNumber(truck)}: ${sentence}`;
}

// ── A driver's ────────────────────────────────────────────────────────────────────────────────────────────────

export const tripSentLine = (date: string, truck: Pick<TruckFacts, 'vehicleId' | 'tripNo'>, leaves: string, stops: number) =>
  `Your trip for ${weekdayOf(date)} is sent: ${truckNumber(truck)} leaves ${leaves} with ${stopsWords(stops)}`;
export const tripChangedLine = (date: string, truck: Pick<TruckFacts, 'vehicleId' | 'tripNo'>, leaves: string, stops: number) =>
  `${weekdayOf(date)}'s plan changed: your trip is ${truckNumber(truck)}, leaving ${leaves} with ${stopsWords(stops)}`;
export const yourTruckReadyLine = (truck: Pick<TruckFacts, 'vehicleId' | 'tripNo'>, loaded: number, ordered: number) => `${truckNumber(truck)} is loaded and ready: ${loadedWords(loaded, ordered)}`;
export const problemAnsweredLine = (by: string, sentence: string) => `${by} answered: ${sentence}`;
