import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { LoadingDay, MarkReadyRequest, RaiseFlagRequest, StartLoadingRequest, StopLoadedRequest } from '@wayfinder/contracts';
import { reasonOf } from '@/features/store/words';
import { api, ApiRequestError } from '@/lib/api';

// The loader's day and its four writes (spec 012, plan.md "The screen"). Every page under /loader reads GET /loading
// under ['loading'] and finds its truck in it by id. The key starts with the topic, so the live stream's loading
// message fetches it again, and a clock or demo message fetches everything (spec 008).
export const loadingKey = ['loading'] as const;

export function useLoadingDay() {
  return useQuery({ queryKey: loadingKey, queryFn: () => api<LoadingDay>('/loading') });
}

// A v4 UUID from crypto.getRandomValues. crypto.randomUUID needs HTTPS or localhost, and a phone on the dock's
// plain http address would not have it.
export function newWriteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The signal can drop on the dock without the request ever failing, so a write that has had no answer for this long
// is taken as not saved.
export const ANSWER_WITHIN_MS = 15_000;

// The day fetched again after a write, waited for no longer than a write is: with the signal gone just after the
// answer, the buttons come back rather than wait for ever, and the server's revision check refuses anything sent
// from the truck as it was.
export function fetchAgain(qc: QueryClient, queryKey: readonly string[]) {
  return Promise.race([qc.invalidateQueries({ queryKey }), new Promise((done) => window.setTimeout(done, ANSWER_WITHIN_MS))]);
}

// No answer, the server failed or it asked us to slow down: sending the same write again can work.
export const worthRetrying = (error: unknown) =>
  !(error instanceof ApiRequestError) || error.code === 'network' || error.status >= 500 || error.status === 429;

type Without<T> = Omit<T, 'writeId'>;
type WriteOf =
  | { kind: 'start'; body: Without<StartLoadingRequest> }
  | { kind: 'stop'; body: Without<StopLoadedRequest> }
  | { kind: 'flag'; body: Without<RaiseFlagRequest> }
  | { kind: 'ready'; body: Without<MarkReadyRequest> };
export type WriteKind = WriteOf['kind'];

const PATH: Record<WriteKind, string> = { start: 'start', stop: 'stop-loaded', flag: 'flags', ready: 'ready' };

interface Write { kind: WriteKind; tripId: string; body: { writeId: string }; done?: () => void }

export interface LoaderWrites {
  // The write on its way, or the one that got no answer and waits for Try again.
  out: WriteKind | null;
  // 'saving' while it is on its way and the day is fetched after it, 'unsaved' when it got no answer.
  phase: 'idle' | 'saving' | 'unsaved';
  // The server's sentence when it refused the last write.
  refused: string | null;
  send: (tripId: string, write: WriteOf, done?: () => void) => void;
  retry: () => void;
}

// A refused write's sentence stays on this tab until the loader dismisses it (spec 016, AC-31): a stale Start opens
// what changed, and the page that sent it, with its own copy of the sentence, goes. A new write replaces it.
let refusal: string | null = null;
const refusalListeners = new Set<() => void>();
function keepRefusal(text: string | null) {
  refusal = text;
  for (const listener of refusalListeners) listener();
}
export const useKeptRefusal = () => useSyncExternalStore((change) => {
  refusalListeners.add(change);
  return () => { refusalListeners.delete(change); };
}, () => refusal);
export const dismissRefusal = () => keepRefusal(null);

// A screen's writes, one at a time (plan.md "The screen"). The write's id is made when the button is pressed and
// kept until an answer comes, so Try again sends the same body and a write that had landed is answered as done.
// Only a write with no answer, a 5xx or a 429 is sent again, and only when the loader taps Try again. A refusal says
// why, drops the write and fetches the day again.
export function useLoaderWrites(): LoaderWrites {
  const qc = useQueryClient();
  const [state, setState] = useState<Pick<LoaderWrites, 'out' | 'phase' | 'refused'>>({ out: null, phase: 'idle', refused: null });
  const pending = useRef<Write | null>(null);
  // Set while a write is on its way, so a second tap on Try again cannot send it twice at once.
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async () => {
    const write = pending.current;
    if (!write || running.current) return;
    running.current = true;
    keepRefusal(null);
    setState({ out: write.kind, phase: 'saving', refused: null });
    try {
      await api<LoadingDay>(`/loading/trips/${encodeURIComponent(write.tripId)}/${PATH[write.kind]}`, {
        method: 'POST', json: write.body, signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
      });
    } catch (error) {
      if (worthRetrying(error)) {
        running.current = false;
        setState({ out: write.kind, phase: 'unsaved', refused: null });
        return;
      }
      pending.current = null;
      keepRefusal(reasonOf(error));
      await fetchAgain(qc, loadingKey);
      running.current = false;
      setState({ out: null, phase: 'idle', refused: reasonOf(error) });
      return;
    }
    pending.current = null;
    // The write answers the whole day, but the answer never goes into the query (AC-33): it can arrive after a
    // newer read, another tablet's write or a reset, and would bring back an older truck. The day is fetched again
    // instead, and the buttons wait for it, so they never offer the truck as it was before the write.
    await fetchAgain(qc, loadingKey);
    running.current = false;
    setState({ out: null, phase: 'idle', refused: null });
    if (mounted.current) write.done?.();
  };

  const send: LoaderWrites['send'] = (tripId, write, done) => {
    if (pending.current) return;
    pending.current = { kind: write.kind, tripId, body: { ...write.body, writeId: newWriteId() }, done };
    void run();
  };

  return { ...state, send, retry: () => { void run(); } };
}
