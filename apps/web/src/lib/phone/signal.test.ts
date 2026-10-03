import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let browser: { onLine: boolean };
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  browser = { onLine: true };
  vi.stubGlobal('navigator', browser);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('D2 checks current browser connectivity when the phone area starts, even if it went offline before listening', async () => {
  const signal = await import('./signal');
  browser.onLine = false;
  signal.startSignal();
  expect(signal.hasSignal()).toBe(false);
});

it('D2 a delayed request or probe answer cannot claim Online while the browser is offline', async () => {
  const signal = await import('./signal');
  signal.startSignal();
  browser.onLine = false;
  window.dispatchEvent(new Event('offline'));
  signal.answered();
  expect(signal.hasSignal()).toBe(false);
});

it('D2 reconnect waits for a server answer, preserves failed health status as reachable, and probes without cache', async () => {
  const signal = await import('./signal');
  signal.startSignal();
  browser.onLine = false;
  window.dispatchEvent(new Event('offline'));
  let answer!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
  browser.onLine = true;
  window.dispatchEvent(new Event('online'));
  expect(signal.hasSignal()).toBe(false);
  answer(new Response('', { status: 503 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.hasSignal()).toBe(true);
  expect(fetch).toHaveBeenCalledWith('/api/v1/health', expect.objectContaining({ cache: 'no-store' }));
});
