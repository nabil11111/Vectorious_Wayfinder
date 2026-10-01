import { ApiError } from '@wayfinder/contracts';

// Every call to the API goes through here, so errors always arrive as one type with a code and a readable message.
export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// D-95: a dispatcher's tab names the depot it shows on every request, so the server refuses one whose depot the session
// has left (409 depot_changed) instead of acting on the other depot. The dispatcher's pages say which depot that is: the
// one the tab last took, never one a later read found, and 'Both' for a tab on both depots together (spec 021), which
// the server takes as a scope like a depot. The tab hears of such a refusal through DEPOT_CHANGED. Any other account
// names none.
export const DEPOT_HEADER = 'x-wayfinder-depot';
export const DEPOT_CHANGED = 'wayfinder-depot-changed';
let namedDepot: string | null = null;
export function nameDepot(depotId: string | null) {
  namedDepot = depotId;
}

// Spec 021: every dispatcher read names the one depot it reads, ?depot=, which a session on both depots needs to tell
// its reads apart, and which a session on one depot may only name as its own.
export const forDepot = (path: string, depot: string) => `${path}${path.includes('?') ? '&' : '?'}depot=${encodeURIComponent(depot)}`;

// depot names the depot a request was made for, such as a plan write that waited its turn, in place of the one the tab
// names when it goes; null names none.
type ApiInit = RequestInit & { json?: unknown; depot?: string | null };

// The request itself, for an answer in JSON and for bytes alike: the depot named, a refusal as one error with a code, a
// 401 signing out, and a refusal for a depot the session left heard by the tab.
async function send(path: string, init: ApiInit): Promise<Response> {
  const { json, headers, depot, ...rest } = init;
  const named = depot === undefined ? namedDepot : depot;
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(named !== null ? { [DEPOT_HEADER]: named } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  // A transport may already have delivered its answer when its query is cancelled. That answer must not
  // sign out a newer account or replace state kept after a reset.
  rest.signal?.throwIfAborted();
  if (res.status === 401) window.dispatchEvent(new Event('wayfinder-signed-out'));
  if (res.ok) return res;
  const body = await res.json().catch(() => null);
  rest.signal?.throwIfAborted();
  const parsed = ApiError.safeParse(body);
  if (parsed.success && res.status === 409 && parsed.data.error.code === 'depot_changed') window.dispatchEvent(new Event(DEPOT_CHANGED));
  if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
  throw new ApiRequestError(res.status, 'network', 'Could not reach Wayfinder. Check the connection and try again.');
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  init.signal?.throwIfAborted();
  return body as T;
}

// Bytes, such as a photo, the same way.
export async function apiBytes(path: string, init: ApiInit = {}): Promise<Blob> {
  const res = await send(path, init);
  const bytes = await res.blob();
  init.signal?.throwIfAborted();
  return bytes;
}
