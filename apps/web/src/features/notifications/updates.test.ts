import { NOTIFICATION_KINDS, type Notification } from '@wayfinder/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { alertInBackground, alertsState, ALERT_WORDS, askForAlerts } from './alerts';
import { ANSWER_ICON, driverAnswerIcon, iconOf, KIND_ICON } from './icons';
import { freshOf, keptShown, keepShown, SHOWN_KEY, type Shown } from './fresh';
import { keptSeen, markAllRead, SEEN_KEY, unreadOf } from './seen';

// Spec 025 in the browser: what has been seen is kept per account (AC-2), each new update becomes a toast once in a tab
// (AC-3, rule 3), a system alert shows only when the tab is hidden and the person allowed it from the pop-up (AC-3), and
// every row's picture comes from the design's icon sheet.

const update = (id: string, at: string, more: Partial<Notification> = {}): Notification => ({
  id, kind: 'order_placed', at: `2026-06-24T${at}:00.000Z`, time: at, line: `Line ${id}`, link: '/store/orders', tone: 'good',
  issueKind: null, decision: null, answer: null, ...more,
});
const A = update('a', '10:00');
const B = update('b', '10:06');
const C = update('c', '10:20');

// A storage that lives in memory, or one that throws as a browser that blocks storage does.
function memory(): Storage {
  const held = new Map<string, string>();
  return { getItem: (key) => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: (key) => { held.delete(key); },
    clear: () => held.clear(), key: () => null, get length() { return held.size; } };
}
const blocked = (): Storage => { throw new Error('blocked'); };
afterEach(() => vi.unstubAllGlobals());

it('AC-2 counts what is newer than the newest seen, and Mark all read keeps the newest under the account', () => {
  const storage = memory();
  // A new device starts with the day's updates unread.
  expect(keptSeen('u1', () => storage)).toBeNull();
  expect(unreadOf([C, B, A], null)).toEqual([C, B, A]);
  expect(markAllRead('u1', [C, B, A], () => storage)).toBe(C.at);
  expect(JSON.parse(storage.getItem(`${SEEN_KEY}:u1`)!)).toEqual({ seenUpTo: C.at });
  expect(keptSeen('u1', () => storage)).toBe(C.at);
  expect(unreadOf([C, B, A], C.at)).toEqual([]);
  expect(unreadOf([update('d', '10:30'), C, B], C.at).map((item) => item.id)).toEqual(['d']);
  // Another account on the same device has its own.
  expect(keptSeen('u2', () => storage)).toBeNull();
  // Marking nothing keeps what was seen, and a browser that blocks storage still counts, starting unread.
  expect(markAllRead('u1', [], () => storage)).toBe(C.at);
  expect(keptSeen('u1', blocked)).toBeNull();
  expect(markAllRead('u1', [C], blocked)).toBe(C.at);
  storage.setItem(`${SEEN_KEY}:u3`, 'not json');
  expect(keptSeen('u3', () => storage)).toBeNull();
});

it('AC-3 rule 3: a tab\'s first read toasts nothing, then each newer update once, across reloads and reconnects', () => {
  // The first read in a tab is what was there before it opened.
  let { fresh, next } = freshOf([B, A], null);
  expect(fresh).toEqual([]);
  // The same updates again, as after the stream reconnects, are not new.
  ({ fresh, next } = freshOf([B, A], next));
  expect(fresh).toEqual([]);
  // A newer one is, once, oldest first so the newest toast sits on top.
  const D = update('d', '10:30');
  ({ fresh, next } = freshOf([D, C, B, A], next));
  expect(fresh.map((item) => item.id)).toEqual(['c', 'd']);
  ({ fresh, next } = freshOf([D, C, B, A], next));
  expect(fresh).toEqual([]);
  // One older than the newest the tab has seen is not a toast, even when it is new to the tab.
  ({ fresh, next } = freshOf([D, C, update('late', '10:25'), B, A], next));
  expect(fresh).toEqual([]);
  // A tab that opened on an empty bell toasts the first update that comes.
  const empty = freshOf([], null);
  expect(freshOf([A], empty.next).fresh).toEqual([A]);
  // The tab keeps it in its session storage, so a reload shows nothing again.
  const storage = memory();
  keepShown('u1', next, () => storage);
  expect(storage.getItem(`${SHOWN_KEY}:u1`)).not.toBeNull();
  const kept = keptShown('u1', () => storage);
  expect(freshOf([D, C, B, A], kept).fresh).toEqual([]);
  expect(keptShown('u1', blocked)).toBeNull();
  expect(() => keepShown('u1', next, blocked)).not.toThrow();
  // It never grows past what a few days of reads hold.
  let many: Shown | null = null;
  for (let i = 0; i < 300; i += 1) many = freshOf([update(`n${i}`, `1${String(Math.floor(i / 60)).padStart(1, '0')}:${String(i % 60).padStart(2, '0')}`)], many).next;
  expect(many!.ids.length).toBeLessThanOrEqual(200);
});

class Alert {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => Alert.permission);
  static shown: Alert[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  readonly title: string;
  readonly options: NotificationOptions;
  constructor(title: string, options: NotificationOptions) { this.title = title; this.options = options; Alert.shown.push(this); }
}
function browser(permission: NotificationPermission, hidden: boolean) {
  Alert.permission = permission;
  Alert.shown = [];
  Alert.requestPermission.mockClear();
  vi.stubGlobal('Notification', Alert);
  vi.stubGlobal('document', { visibilityState: hidden ? 'hidden' : 'visible' });
  vi.stubGlobal('window', { focus: vi.fn() });
}

it('AC-3 shows a system alert only when the tab is hidden and alerts are allowed, and never asks on its own', () => {
  const open = vi.fn();
  browser('granted', true);
  expect(alertInBackground(C, open)).toBe(true);
  expect(Alert.shown[0]).toMatchObject({ title: 'Wayfinder', options: { body: 'Line c', tag: 'c' } });
  Alert.shown[0]!.onclick!();
  expect(open).toHaveBeenCalledWith('/store/orders');
  expect(Alert.shown[0]!.close).toHaveBeenCalled();
  browser('granted', false);
  expect(alertInBackground(C, open)).toBe(false);
  for (const permission of ['default', 'denied'] as const) {
    browser(permission, true);
    expect(alertInBackground(C, open)).toBe(false);
    expect(Alert.shown).toEqual([]);
    expect(Alert.requestPermission).not.toHaveBeenCalled();
  }
  vi.stubGlobal('Notification', undefined);
  expect(alertsState()).toBe('unsupported');
  expect(alertInBackground(C, open)).toBe(false);
});

it('AC-3 asks only from the pop-up\'s button, and its words follow the browser\'s answer', async () => {
  browser('default', false);
  expect(alertsState()).toBe('ask');
  expect(ALERT_WORDS.ask).toBe('Turn on alerts when Wayfinder is in the background');
  Alert.permission = 'denied';
  expect(await askForAlerts()).toBe('blocked');
  expect(Alert.requestPermission).toHaveBeenCalledTimes(1);
  expect(ALERT_WORDS.blocked).toBe('Alerts are off in the browser\'s settings');
  browser('granted', false);
  expect(alertsState()).toBe('on');
  expect(ALERT_WORDS.on).toBe('Alerts are on when Wayfinder is in the background');
  vi.stubGlobal('Notification', undefined);
  expect(await askForAlerts()).toBe('unsupported');
});

it('gives every kind, problem and answer a picture from the design\'s icon sheet', () => {
  for (const kind of NOTIFICATION_KINDS) expect(KIND_ICON[kind], kind).toMatch(/icon-[a-z-]+\.png$/);
  expect(iconOf(update('p', '10:00', { kind: 'problem', issueKind: 'refused' }))).toMatch(/icon-damaged\.png$/);
  expect(iconOf(update('f', '10:00', { kind: 'flag_answered', decision: 'go_short' }))).toBe(ANSWER_ICON.go_short);
  // The driver reads "Send replacements" as bringing the cartons back, so it has bringing back's picture.
  expect(driverAnswerIcon('send_replacements')).toBe(ANSWER_ICON.bring_back);
  expect(driverAnswerIcon('try_again')).toBe(ANSWER_ICON.try_again);
  expect(iconOf(update('d', '10:00', { kind: 'problem_answered', decision: 'send_replacements', answer: { short: 'Bring back · 2 chilled', by: 'Ruwan', sentence: 'x' } })))
    .toBe(ANSWER_ICON.bring_back);
});
