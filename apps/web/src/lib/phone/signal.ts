import { useSyncExternalStore } from 'react';

// The signal on a phone (spec 013, rule 12, plan.md "The signal"), one per tab, whichever queue it owns. There is no
// signal while the browser says it is offline, or from a request that got no answer within 15 seconds, until a request
// gets any answer. With no signal a probe asks GET /api/v1/health on the retry schedule, whatever navigator.onLine says,
// and at once when the browser says it is back, the app comes back to the front, the app opens, or Retry sync is
// tapped. Any answer brings the signal back, and the sync loop carries on. navigator.onLine can be wrong both ways, so
// the requests themselves have the last word.

// Every send, fetch and probe gives up after this long without an answer.
export const ANSWER_WITHIN_MS = 15_000;

// The retry schedule: after 2, 4 and 8 seconds, then every 15.
const SCHEDULE_S = [2, 4, 8];
export const retryDelay = (attempt: number) => (SCHEDULE_S[attempt] ?? 15) * 1000;

let signal = navigator.onLine;
let attempt = 0;
let timer = 0;
let probing = false;
let started = false;
const listeners = new Set<() => void>();
const onBack = new Set<() => void>();
const onLost = new Set<() => void>();

function set(next: boolean) {
  if (signal === next) return;
  signal = next;
  for (const listener of listeners) listener();
  for (const change of next ? onBack : onLost) change();
}

export const hasSignal = () => signal;

// A request got an answer, whatever its status: the phone can reach the server.
export function answered() {
  attempt = 0;
  window.clearTimeout(timer);
  set(true);
}

// A request got no answer: no signal until one does. The probe starts on the retry schedule.
export function noAnswer() {
  set(false);
  schedule();
}

function schedule() {
  if (signal) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void probe(); }, retryDelay(attempt));
  attempt += 1;
}

// One request with a time limit. The limit is the phone's own, separate from any cancel the caller passes, so a
// request cut short by the limit is told apart from one the caller called off.
export async function within<T>(run: (signal: AbortSignal) => Promise<T>, cancel?: AbortSignal): Promise<{ value: T } | { error: unknown; timedOut: boolean; cancelled: boolean }> {
  const limit = new AbortController();
  let timedOut = false;
  const stop = window.setTimeout(() => { timedOut = true; limit.abort(); }, ANSWER_WITHIN_MS);
  const callOff = () => limit.abort();
  cancel?.addEventListener('abort', callOff, { once: true });
  if (cancel?.aborted) limit.abort();
  try {
    return { value: await run(limit.signal) };
  } catch (error) {
    return { error, timedOut, cancelled: !timedOut && cancel?.aborted === true };
  } finally {
    window.clearTimeout(stop);
    cancel?.removeEventListener('abort', callOff);
  }
}

// Asks the server's health address. Any answer at all is a signal, even a 503 while its database restarts.
async function probe() {
  if (probing) return;
  probing = true;
  const result = await within((limit) => fetch('/api/v1/health', { cache: 'no-store', credentials: 'same-origin', signal: limit }));
  probing = false;
  if ('value' in result) answered();
  else noAnswer();
}

// At once, when there is no signal: the browser's online event, the app coming back to the front, the app
// opening and Retry sync.
export function probeNow() {
  if (signal || probing) return;
  window.clearTimeout(timer);
  void probe();
}

// Starts listening to the browser once, when the driver's app first opens.
export function startSignal() {
  if (started) return;
  started = true;
  window.addEventListener('offline', () => noAnswer());
  window.addEventListener('online', () => probeNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probeNow(); });
  if (!signal) {
    window.clearTimeout(timer);
    void probe();
  }
}

// The sync loop is told when the signal comes back, so it sends what waits at once, and when it is lost, so the green
// "Back online" can later name what waited meanwhile.
export function whenBack(listener: () => void) {
  onBack.add(listener);
}
export function whenLost(listener: () => void) {
  onLost.add(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSignal() {
  return useSyncExternalStore(subscribe, hasSignal);
}
