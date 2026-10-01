import type { Notification } from '@wayfinder/contracts';

// What a person has seen (spec 025, D-99): the newest update's time they marked read, kept in this browser under their
// account, { seenUpTo }. No table holds it, so a new device starts with the day's updates unread. Storage that throws or
// holds something else is read as nothing seen, and a write that fails leaves the count as it was on the next read.

export const SEEN_KEY = 'wayfinder-seen';
type Store = () => Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage: Store = () => window.localStorage;

export function keptSeen(accountId: string, storage: Store = browserStorage): string | null {
  try {
    const kept: unknown = JSON.parse(storage().getItem(`${SEEN_KEY}:${accountId}`) ?? 'null');
    const seenUpTo = (kept as { seenUpTo?: unknown } | null)?.seenUpTo;
    return typeof seenUpTo === 'string' ? seenUpTo : null;
  } catch {
    return null;
  }
}

// The updates newer than the newest seen. Times are the API's ISO strings, which sort as they read.
export const unreadOf = (items: readonly Notification[], seenUpTo: string | null) => items.filter((item) => seenUpTo === null || item.at > seenUpTo);

// Mark all read: keeps the newest update's time, and answers what is now seen.
export function markAllRead(accountId: string, items: readonly Notification[], storage: Store = browserStorage): string | null {
  const before = keptSeen(accountId, storage);
  const newest = items.reduce<string | null>((top, item) => (top === null || item.at > top ? item.at : top), before);
  if (newest === null) return null;
  try {
    storage().setItem(`${SEEN_KEY}:${accountId}`, JSON.stringify({ seenUpTo: newest }));
  } catch (error) {
    console.warn('Could not keep what was read on this device.', error);
  }
  return newest;
}
