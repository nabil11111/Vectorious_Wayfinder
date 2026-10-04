import { PushKey, type Notification as Update } from '@wayfinder/contracts';
import { api } from '@/lib/api';

// The system notification for a tab in the background (spec 025, AC-3). The app never asks for it on its own: only the
// pop-up's button asks, and a refusal is the browser's to undo, so the button then says where.

export type AlertsState = 'unsupported' | 'ask' | 'on' | 'blocked';

// The browser's own Notification, which an update's type of the same name would hide.
const browserNotification = () => (typeof globalThis.Notification === 'undefined' ? null : globalThis.Notification);

export function alertsState(): AlertsState {
  const browser = browserNotification();
  if (!browser) return 'unsupported';
  return browser.permission === 'granted' ? 'on' : browser.permission === 'denied' ? 'blocked' : 'ask';
}

// What the pop-up's button says, and nothing in a browser that has no alerts.
export const ALERT_WORDS: Record<AlertsState, string | null> = {
  ask: 'Turn on alerts when Wayfinder is in the background',
  on: 'Alerts are on when Wayfinder is in the background',
  blocked: 'Alerts are off in the browser\'s settings',
  unsupported: null,
};

// The button's press: the browser's own question.
export async function askForAlerts(): Promise<AlertsState> {
  const browser = browserNotification();
  if (!browser) return 'unsupported';
  await browser.requestPermission();
  const state = alertsState();
  // The same press subscribes the phone, so an update can arrive after Wayfinder has been sent home (spec 031).
  // Permission already succeeded: a missing key or a browser with no worker leaves the bell as it was.
  if (state === 'on') {
    try { await subscribeForPush(); } catch (error) { console.warn('Could not subscribe this browser for background alerts.', error); }
  }
  return state;
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function subscribeForPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const { publicKey } = PushKey.parse(await api<unknown>('/notifications/push-key'));
  if (!publicKey) return;
  const existing = await registration.pushManager.getSubscription();
  const sub = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
  await api('/notifications/push', { method: 'PUT', json: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } });
}

// One update as a system alert, when the tab is hidden and alerts are on. Its tag is the update's id, so two tabs show it
// once. A press brings the tab forward at the update's place. Says whether it showed.
export function alertInBackground(item: Update, open: (link: string) => void): boolean {
  const browser = browserNotification();
  if (!browser || browser.permission !== 'granted' || document.visibilityState !== 'hidden') return false;
  const alert = new browser('Wayfinder', { body: item.line, tag: item.id });
  alert.onclick = () => {
    window.focus();
    open(item.link);
    alert.close();
  };
  return true;
}
