import { LookupFleet, LookupHistory, LookupOrders, type LookupPhoto } from '@wayfinder/contracts';
import { api, apiBytes, forDepot } from '@/lib/api';

// The dispatcher's three look-up reads (spec 017, plan.md "Contracts"). Each sends only the parameters its contract
// names, and the depot it reads (spec 021), and checks the answer against that contract, so a read the page cannot trust
// shows the error state rather than half a page. Photo bytes come only from the two fixed routes, and only when a photo
// is opened.

export interface OrdersParams { date?: string; range: 'day' | 'four_weeks' }
export interface HistoryParams { date?: string }

const query = (params: Record<string, string | undefined>) => {
  const named = Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return named.length ? `?${new URLSearchParams(named).toString()}` : '';
};

export const ordersPath = (params: OrdersParams) => `/lookup/orders${query({ date: params.date, range: params.range })}`;
export const historyPath = (params: HistoryParams) => `/lookup/history${query({ date: params.date })}`;

export const readOrders = async (depot: string, params: OrdersParams, signal: AbortSignal) =>
  LookupOrders.parse(await api<unknown>(forDepot(ordersPath(params), depot), { signal }));
export const readHistory = async (depot: string, params: HistoryParams, signal: AbortSignal) =>
  LookupHistory.parse(await api<unknown>(forDepot(historyPath(params), depot), { signal }));
export const readFleet = async (depot: string, signal: AbortSignal) => LookupFleet.parse(await api<unknown>(forDepot('/lookup/fleet', depot), { signal }));

// A stop's proof comes from the look-up's own route, a problem's photo from spec 013's (decided problems included).
export const photoPath = (photo: LookupPhoto) => (photo.kind === 'proof'
  ? `/lookup/stops/${encodeURIComponent(photo.stopId)}/photo`
  : `/issues/${encodeURIComponent(photo.issueId)}/photo`);

// The JPEG itself, as a blob the viewer turns into an address of its own. It comes the shared way, so it names the depot
// the tab shows (D-95), and the read names the depot of the records it is in (spec 021). Errors arrive as the API's, as
// every other read's do: not_found is an authorized stop or problem with no photo. A 401 signs out as everywhere else.
export const readPhoto = (photo: LookupPhoto, depot: string, signal: AbortSignal): Promise<Blob> => apiBytes(forDepot(photoPath(photo), depot), { signal });
