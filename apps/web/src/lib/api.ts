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

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  // A transport may already have delivered its answer when its query is cancelled. That answer must not
  // sign out a newer account or replace state kept after a reset.
  rest.signal?.throwIfAborted();
  if (res.status === 401) window.dispatchEvent(new Event('wayfinder-signed-out'));
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  rest.signal?.throwIfAborted();
  if (!res.ok) {
    const parsed = ApiError.safeParse(body);
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    throw new ApiRequestError(res.status, 'network', 'Could not reach Wayfinder. Check the connection and try again.');
  }
  return body as T;
}
