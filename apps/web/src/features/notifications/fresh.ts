import type { Notification } from '@wayfinder/contracts';

// Which updates become toasts (spec 025, rule 3): only those newer than the newest this tab has seen, each once. The
// tab's first read is what was there before it opened, so it toasts nothing. What the tab has seen is kept in its session
// storage, so a reload, or a fresh read when the stream reconnects, never shows one again.

export interface Shown { newest: string; ids: string[] }
export const SHOWN_KEY = 'wayfinder-shown';
// Enough for a few days of reads, so the list never grows without end.
const KEEP_IDS = 200;

// The updates to show now, oldest first so the newest toast lands on top, and what the tab has then seen. null is a tab
// that has read nothing yet.
export function freshOf(items: readonly Notification[], shown: Shown | null): { fresh: Notification[]; next: Shown } {
  const newest = items.reduce((top, item) => (item.at > top ? item.at : top), shown?.newest ?? '');
  const fresh = shown === null ? [] : items.filter((item) => item.at > shown.newest && !shown.ids.includes(item.id)).reverse();
  const ids = [...new Set([...items.map((item) => item.id), ...(shown?.ids ?? [])])].slice(0, KEEP_IDS);
  return { fresh, next: { newest, ids } };
}

type Store = () => Pick<Storage, 'getItem' | 'setItem'>;
const tabStorage: Store = () => window.sessionStorage;

export function keptShown(accountId: string, storage: Store = tabStorage): Shown | null {
  try {
    const kept = JSON.parse(storage().getItem(`${SHOWN_KEY}:${accountId}`) ?? 'null') as Shown | null;
    return kept && typeof kept.newest === 'string' && Array.isArray(kept.ids) ? kept : null;
  } catch {
    return null;
  }
}

export function keepShown(accountId: string, shown: Shown, storage: Store = tabStorage): void {
  try {
    storage().setItem(`${SHOWN_KEY}:${accountId}`, JSON.stringify(shown));
  } catch (error) {
    console.warn('Could not keep which updates this tab has shown.', error);
  }
}
