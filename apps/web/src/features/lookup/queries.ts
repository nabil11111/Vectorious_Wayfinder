import { useEffect, useRef, useState } from 'react';
import { queryOptions, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { LookupPhoto, Me } from '@wayfinder/contracts';
import { depotDay } from '@/features/live/words';
import { ApiRequestError } from '@/lib/api';
import { clockKey, useAppClock } from '@/lib/clock';
import { readFleet, readHistory, readOrders, readPhoto, type HistoryParams, type OrdersParams } from './api';
import { reasonOf } from './words';

// The look-up pages' reads and what may stay on screen (spec 017, rule 12; plan.md "Live updates, selection and
// screens"). Each read is keyed ['lookup', page, user, depot, parameters], so the live stream's lookup fan-out fetches
// it again and another account or date never starts from it, and it carries the query's signal, so a page that moved
// on cancels the older read. The depot is the one the read is for, which it names (spec 021): on both depots together
// each depot's records are a read of their own. A selection and an open photo belong to the scope they were made in.

export type LookupPage = 'orders' | 'history' | 'fleet';
type Account = Pick<Me, 'id'> | null | undefined;

export const lookupKey = (page: LookupPage, me: Account, depot: string | null, params: object) => ['lookup', page, me?.id ?? null, depot, params] as const;
const readable = (me: Account, depot: string | null) => Boolean(me?.id && depot);
// The depot of a read that is enabled only with one.
const named = (depot: string | null) => {
  if (depot === null) throw new Error('No depot to look up.');
  return depot;
};

export const ordersOptions = (me: Account, depot: string | null, params: OrdersParams) => queryOptions({
  queryKey: lookupKey('orders', me, depot, params),
  queryFn: ({ signal }) => readOrders(named(depot), params, signal),
  enabled: readable(me, depot),
});
export const historyOptions = (me: Account, depot: string | null, params: HistoryParams) => queryOptions({
  queryKey: lookupKey('history', me, depot, params),
  queryFn: ({ signal }) => readHistory(named(depot), params, signal),
  enabled: readable(me, depot),
});
export const fleetOptions = (me: Account, depot: string | null) => queryOptions({
  queryKey: lookupKey('fleet', me, depot, {}),
  queryFn: ({ signal }) => readFleet(named(depot), signal),
  enabled: readable(me, depot),
});

// A live message while a page's first read is out would be lost: TanStack hands it the read already on its way, whose
// snapshot is from before the change. Such a message asks again once that read lands (as Live day's reads do).
export function followLookupMessages(qc: QueryClient) {
  const asked = new Set<string>();
  return qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey[0] !== 'lookup') return;
    const { query, action } = event;
    if (action.type === 'invalidate' && query.state.fetchStatus === 'fetching' && query.state.data === undefined) asked.add(query.queryHash);
    else if (action.type === 'success' && asked.delete(query.queryHash)) void qc.invalidateQueries({ queryKey: query.queryKey, exact: true });
    else if (action.type === 'error') asked.delete(query.queryHash);
  });
}
export function useFollowLookupMessages() {
  const qc = useQueryClient();
  useEffect(() => followLookupMessages(qc), [qc]);
}

// A read answered for another reset generation than the clock now shows is not current. A page draws none of it, so
// none of its rows can be chosen, until the read for the clock's generation arrives. Outside demo mode neither side
// names a generation.
export const currentRead = <T extends { demoDay: number | null }>(read: T | undefined, clockDay: number | null): T | undefined =>
  (read && (read.demoDay === null || clockDay === null || read.demoDay === clockDay) ? read : undefined);

// A reset moves the generation. Invalidating alone would hand a page's first read, still out from before the reset, to
// the new generation and accept its answer; so every lookup read is cancelled, a first one too, and asked again.
export async function followGeneration(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: ['lookup'] });
  void qc.invalidateQueries({ queryKey: ['lookup'] });
}

// A page follows the clock's generation: a reset cancels its reads and asks again, and a read already of a newer
// generation than the clock asks for the clock, so the two meet.
export function useFollowGeneration(clockDay: number | null, readDay: number | null) {
  const qc = useQueryClient();
  const seen = useRef(clockDay);
  useEffect(() => {
    if (seen.current !== null && clockDay !== null && clockDay !== seen.current) void followGeneration(qc);
    seen.current = clockDay;
  }, [clockDay, qc]);
  useEffect(() => {
    if (readDay !== null && clockDay !== null && readDay > clockDay) void qc.invalidateQueries({ queryKey: clockKey });
  }, [readDay, clockDay, qc]);
}

// What a page's read is doing, in the spec's states: the first read still on its way, the first read failed (or no
// connection to make it), a refresh that failed while the last records stay, the connection lost, or live. A read the
// browser holds back is not always offline: TanStack also holds a retry while the window is out of focus, so only the
// browser's own online state says the connection is lost, and a failed attempt counts as failed while its retry waits.
export type ReadState = 'loading' | 'failed' | 'stale' | 'offline' | 'live';
export function readState(query: { data: unknown; isError: boolean; failureCount: number }, online: boolean): ReadState {
  if (query.data === undefined) return !online || query.isError || query.failureCount > 0 ? 'failed' : 'loading';
  if (!online) return 'offline';
  return query.isError || query.failureCount > 0 ? 'stale' : 'live';
}

// When a default the server chose has moved on: the board's day at 03:30 depot time, Today and the latest sent date at
// midnight. Each is the depot day of the instant less its rollover, so it changes exactly then. A clock that moved
// backward is followed by its own clock message, so only a clock past the read's rollover counts.
const ROLLOVER_MINUTES = { board: 3 * 60 + 30, calendar: 0 } as const;
export type Rollover = keyof typeof ROLLOVER_MINUTES;
const epochOf = (instant: number, kind: Rollover) => depotDay(instant - ROLLOVER_MINUTES[kind] * 60_000);
export const defaultMoved = (readAt: string, at: number | null, kind: Rollover) =>
  at !== null && epochOf(at, kind) > epochOf(Date.parse(readAt), kind);

// A page that asked for no date follows its default: once the app clock passes the rollover after its read, the same
// key is asked again at once, cancelling any read still out. A chosen date never moves.
export function useFollowDefault(queryKey: QueryKey, readAt: string | undefined, implicit: boolean, kind: Rollover) {
  const qc = useQueryClient();
  const { at } = useAppClock();
  const moved = implicit && readAt !== undefined && defaultMoved(readAt, at, kind);
  const hash = JSON.stringify(queryKey);
  useEffect(() => {
    if (moved) void qc.invalidateQueries({ queryKey: JSON.parse(hash) as QueryKey, exact: true }, { cancelRefetch: true });
  }, [moved, readAt, hash, qc]);
}

// What a selection belongs to: the account, the depot, the read's parameters and the reset generation of the records
// on screen. Records read before a reset the clock already shows are out of date, so they hold no selection either.
export interface SelectionScope {
  userId: string | null; depotId: string | null; params: object; generation: number | null; clockGeneration?: number | null;
}
export function scopeOf(scope: SelectionScope) {
  const behind = scope.clockGeneration != null && scope.generation != null && scope.clockGeneration !== scope.generation;
  return JSON.stringify([scope.userId, scope.depotId, scope.params, scope.generation, behind]);
}
export interface Held { id: string; scope: string }
export const shownSelection = (held: Held | null, scope: string, ids: readonly string[]) =>
  (held && held.scope === scope && ids.includes(held.id) ? held.id : null);

// History's selected trip comes from the address (?trip=), as links from Orders and Fleet name it. It is one of the
// read's own trips, never a read of its own; one the plan does not hold is gone. Records read before a reset that the
// clock already shows hold no selection until the read after it arrives.
export function historySelection<T extends { tripId: string }>(read: { demoDay: number | null; trips: T[] } | undefined, tripParam: string | null, clockDay: number | null) {
  if (!read || tripParam === null) return { trip: null, gone: false };
  if (clockDay !== null && read.demoDay !== null && clockDay !== read.demoDay) return { trip: null, gone: false };
  const trip = read.trips.find((each) => each.tripId === tripParam) ?? null;
  return { trip, gone: trip === null };
}

// A page's one selected row. One the records no longer hold, or one from another scope, is cleared as the page draws,
// never kept to come back later.
export function useSelection(scope: string, ids: readonly string[]) {
  const [held, setHeld] = useState<Held | null>(null);
  const shown = shownSelection(held, scope, ids);
  if (held && shown === null) setHeld(null);
  return [shown, (id: string | null) => setHeld(id === null ? null : { id, scope })] as const;
}

// ── Photos (rule 8, D-84) ────────────────────────────────────────────────────────────────────────────────────────
// One viewer per page. The bytes load when a photo is opened, under the newest request only: opening another, closing,
// a reset or a sign-out aborts the request still out and gives back the image on screen, and late bytes are dropped.

export type PhotoView =
  | { status: 'closed' }
  | { status: 'loading' | 'missing'; photo: LookupPhoto; label: string }
  | { status: 'shown'; photo: LookupPhoto; label: string; url: string }
  | { status: 'failed'; photo: LookupPhoto; label: string; reason: string };
export const CLOSED: PhotoView = { status: 'closed' };

export interface PhotoDeps {
  read: (photo: LookupPhoto, signal: AbortSignal) => Promise<Blob>;
  toUrl: (jpeg: Blob) => string;
  revoke: (url: string) => void;
}

export function photoLoader(deps: PhotoDeps, onChange: (view: PhotoView) => void) {
  let view: PhotoView = CLOSED;
  let request = 0;
  let pending: AbortController | null = null;
  const set = (next: PhotoView) => {
    if (view.status === 'shown' && !(next.status === 'shown' && next.url === view.url)) deps.revoke(view.url);
    view = next;
    onChange(view);
  };
  const stopPending = () => {
    pending?.abort();
    pending = null;
    request += 1;
  };
  const open = (photo: LookupPhoto, label: string) => {
    stopPending();
    const mine = request;
    const abort = new AbortController();
    pending = abort;
    set({ status: 'loading', photo, label });
    deps.read(photo, abort.signal).then((jpeg) => {
      if (mine !== request || abort.signal.aborted) return;
      pending = null;
      set({ status: 'shown', photo, label, url: deps.toUrl(jpeg) });
    }, (error: unknown) => {
      if (mine !== request || abort.signal.aborted) return;
      pending = null;
      const absent = error instanceof ApiRequestError && error.status === 404;
      set(absent ? { status: 'missing', photo, label } : { status: 'failed', photo, label, reason: reasonOf(error) });
    });
  };
  return {
    open,
    close: () => {
      stopPending();
      if (view.status !== 'closed') set(CLOSED);
    },
    retry: () => {
      if (view.status === 'failed') open(view.photo, view.label);
    },
    // The browser could not draw the bytes that came: the photo failed, and its address is given back. A report about an
    // image no longer on screen changes nothing.
    broken: (url: string) => {
      if (view.status === 'shown' && view.url === url) set({ status: 'failed', photo: view.photo, label: view.label, reason: 'The photo could not be shown.' });
    },
    get view() { return view; },
  };
}

// The browser's own photos, read for the depot whose records hold them.
const browserPhotos = (depot: string): PhotoDeps => ({
  read: (photo, signal) => readPhoto(photo, depot, signal), toUrl: (jpeg) => URL.createObjectURL(jpeg), revoke: (url) => URL.revokeObjectURL(url),
});

// The page's viewer, one per depot's part of the page. A change of scope (account, depot, date, selection or reset
// generation) closes it and gives its image back before the page draws the new records; leaving the page does the same.
export function usePhotoViewer(scope: string, depot: string) {
  const [view, setView] = useState<PhotoView>(CLOSED);
  const [loader] = useState(() => photoLoader(browserPhotos(depot), setView));
  const [openedIn, setOpenedIn] = useState<string | null>(null);
  // Drawn closed at once under a new scope; this releases the request and the image behind it.
  useEffect(() => {
    if (openedIn !== null && openedIn !== scope) loader.close();
  }, [scope, openedIn, loader]);
  useEffect(() => () => loader.close(), [loader]);
  return {
    view: openedIn === scope ? view : CLOSED,
    open: (photo: LookupPhoto, label: string) => {
      setOpenedIn(scope);
      loader.open(photo, label);
    },
    close: () => {
      loader.close();
      setOpenedIn(null);
    },
    retry: () => loader.retry(),
    broken: (url: string) => loader.broken(url),
  };
}
export type PhotoViewer = ReturnType<typeof usePhotoViewer>;
