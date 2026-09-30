import type { Minutes } from './types';

// How the checker writes times and amounts in its messages, so every rule reads the same.

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
