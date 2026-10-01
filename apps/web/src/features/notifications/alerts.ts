import type { Notification } from '@wayfinder/contracts';

// The system notification for a tab in the background (spec 025, AC-3). The app never asks for it on its own: only the
// pop-up's button asks, and a refusal is the browser's to undo, so the button then says where.

export type AlertsState = 'unsupported' | 'ask' | 'on' | 'blocked';

const api = () => (typeof Notification === 'undefined' ? null : Notification);

export function alertsState(): AlertsState {
  const browser = api();
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
  const browser = api();
  if (!browser) return 'unsupported';
  await browser.requestPermission();
  return alertsState();
}

// One update as a system alert, when the tab is hidden and alerts are on. Its tag is the update's id, so two tabs show it
// once. A press brings the tab forward at the update's place. Says whether it showed.
export function alertInBackground(item: Notification, open: (link: string) => void): boolean {
  const browser = api();
  if (!browser || browser.permission !== 'granted' || document.visibilityState !== 'hidden') return false;
  const alert = new browser('Wayfinder', { body: item.line, tag: item.id });
  alert.onclick = () => {
    window.focus();
    open(item.link);
    alert.close();
  };
  return true;
}
