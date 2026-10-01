import { ApiError, LookupFleet, LookupHistory, LookupOrders, type LookupPhoto } from '@wayfinder/contracts';
import { api, ApiRequestError } from '@/lib/api';

// The dispatcher's three look-up reads (spec 017, plan.md "Contracts"). Each sends only the parameters its contract
// names and checks the answer against that contract, so a read the page cannot trust shows the error state rather than
// half a page. Photo bytes come only from the two fixed routes, and only when a photo is opened.

export interface OrdersParams { date?: string; range: 'day' | 'four_weeks' }
export interface HistoryParams { date?: string }

const query = (params: Record<string, string | undefined>) => {
  const named = Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return named.length ? `?${new URLSearchParams(named).toString()}` : '';
};

export const ordersPath = (params: OrdersParams) => `/lookup/orders${query({ date: params.date, range: params.range })}`;
export const historyPath = (params: HistoryParams) => `/lookup/history${query({ date: params.date })}`;

export const readOrders = async (params: OrdersParams, signal: AbortSignal) => LookupOrders.parse(await api<unknown>(ordersPath(params), { signal }));
export const readHistory = async (params: HistoryParams, signal: AbortSignal) => LookupHistory.parse(await api<unknown>(historyPath(params), { signal }));
export const readFleet = async (signal: AbortSignal) => LookupFleet.parse(await api<unknown>('/lookup/fleet', { signal }));

// A stop's proof comes from the look-up's own route, a problem's photo from spec 013's (decided problems included).
export const photoPath = (photo: LookupPhoto) => (photo.kind === 'proof'
  ? `/lookup/stops/${encodeURIComponent(photo.stopId)}/photo`
  : `/issues/${encodeURIComponent(photo.issueId)}/photo`);

// The JPEG itself, as a blob the viewer turns into an address of its own. Errors arrive as the API's, as every other
// read's do: not_found is an authorized stop or problem with no photo. A 401 signs out as everywhere else.
export async function readPhoto(photo: LookupPhoto, signal: AbortSignal): Promise<Blob> {
  const res = await fetch(`/api/v1${photoPath(photo)}`, { credentials: 'same-origin', signal });
  signal.throwIfAborted();
  if (res.status === 401) window.dispatchEvent(new Event('wayfinder-signed-out'));
  if (!res.ok) {
    const parsed = ApiError.safeParse(await res.json().catch(() => null));
    signal.throwIfAborted();
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    throw new ApiRequestError(res.status, 'network', 'Could not reach Wayfinder. Check the connection and try again.');
  }
  const jpeg = await res.blob();
  signal.throwIfAborted();
  return jpeg;
}
