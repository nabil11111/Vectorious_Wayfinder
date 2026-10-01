import type { Notification } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { BellButton, UpdatesPanel } from './Bell';
import { GlanceCard } from './GlanceCard';
import { GLANCE_MS, swiped } from './glance';
import { ANSWER_ICON, KIND_ICON } from './icons';

// The bell and its pop-up, the same for every role (spec 025, AC-2), and the driver's glanceable answer (AC-3b). The
// pop-up's content is one component, drawn in a popover on a desktop and a sheet from the bottom on a phone.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const update = (id: string, at: string, line: string, more: Partial<Notification> = {}): Notification => ({
  id, kind: 'problem', at: `2026-06-24T${at}:00.000Z`, time: at, line, link: `/dispatcher/live?issue=${id}`, tone: 'bad',
  issueKind: 'loading', decision: null, answer: null, ...more,
});
const flag = update('i1', '21:03', 'Kasun flagged 1 dry carton short for Fresh Nugegoda on Wasantha\'s reefer van');
const ready = update('t1', '21:06', 'Wasantha\'s reefer van is loaded and ready: 117 of 118 on, 1 short', { kind: 'truck_ready', issueKind: null, tone: 'good', link: '/dispatcher/live?trip=t1' });

const panel = (props: Partial<Parameters<typeof UpdatesPanel>[0]> = {}) => renderToStaticMarkup(
  <MemoryRouter>
    <UpdatesPanel items={[ready, flag]} seenUpTo={flag.at} both={false} foot={null} alerts="ask" onRead={() => {}} onOpen={() => {}} onAsk={() => {}} {...props} />
  </MemoryRouter>,
);
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

it('AC-2 lists each update with its picture, line and time, newest first, and marks the unread ones', () => {
  const markup = panel();
  expect(text(markup)).toContain('Updates');
  expect(markup.indexOf('loaded and ready')).toBeLessThan(markup.indexOf('Kasun flagged'));
  expect(markup).toContain(`src="${KIND_ICON.truck_ready}"`);
  expect(text(markup)).toContain('21:06');
  expect(text(markup)).toContain('21:03');
  // Only the update newer than the newest seen is unread.
  expect(markup.match(/data-unread="true"/g)).toHaveLength(1);
  expect(text(markup)).toContain('Mark all read');
  expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Mark all read/);
});

it('AC-2 keeps the dispatcher\'s and the loader\'s own link at the foot, and a shop\'s has none', () => {
  expect(text(panel({ foot: { to: '/dispatcher/live', label: 'Open Live day' } }))).toContain('Open Live day');
  expect(panel({ foot: { to: '/loader/changes', label: 'See what changed' } })).toContain('href="/loader/changes"');
  expect(text(panel())).not.toMatch(/Open Live day|See what changed/);
});

it('AC-2 with everything read, nothing to mark; with nothing yet, says so; on both depots each row names its depot', () => {
  expect(panel({ seenUpTo: ready.at })).toMatch(/<button[^>]*disabled=""[^>]*>Mark all read/);
  expect(text(panel({ items: [] }))).toContain('Nothing yet for this day.');
  const both = panel({ both: true, items: [{ ...ready, depot: 'Kandy' }, { ...flag, depot: 'Peliyagoda' }] });
  expect(text(both)).toContain('Kandy');
  expect(text(both)).toContain('Peliyagoda');
});

it('AC-3 has the button that asks for background alerts, and says where to turn them on once refused', () => {
  expect(panel({ alerts: 'ask' })).toMatch(/<button[^>]*>[^<]*Turn on alerts when Wayfinder is in the background/);
  expect(text(panel({ alerts: 'blocked' }))).toContain('Alerts are off in the browser\'s settings');
  expect(panel({ alerts: 'blocked' })).not.toMatch(/<button[^>]*>[^<]*Alerts are off/);
  expect(text(panel({ alerts: 'on' }))).toContain('Alerts are on when Wayfinder is in the background');
  expect(text(panel({ alerts: 'unsupported' }))).not.toContain('alerts');
});

it('AC-2 the bell shows the unread count on the design\'s bell, and none when all is read', () => {
  const bell = renderToStaticMarkup(<BellButton unread={3} />);
  expect(bell).toContain('aria-label="Updates: 3 unread"');
  expect(text(bell)).toContain('3');
  expect(bell).toMatch(/icon-alert\.png/);
  const none = renderToStaticMarkup(<BellButton unread={0} />);
  expect(none).toContain('aria-label="Updates"');
  expect(text(none).trim()).toBe('');
});

it('AC-3b the driver\'s card: the answer\'s picture, its short form large, then who and when and the full sentence small', () => {
  const answer = update('a1', '22:22', 'Ruwan answered: Bring the 2 chilled cartons back to Peliyagoda.', {
    kind: 'problem_answered', issueKind: null, decision: 'bring_back', tone: 'warn', link: '/driver', time: '03:52',
    answer: { short: 'Bring back · 2 chilled', by: 'Ruwan', sentence: 'Bring the 2 chilled cartons back to Peliyagoda.' },
  });
  const card = renderToStaticMarkup(<GlanceCard item={answer} onClose={() => {}} />);
  expect(card).toContain(`src="${ANSWER_ICON.bring_back}"`);
  expect(text(card)).toContain('Bring back · 2 chilled');
  expect(text(card)).toContain('Ruwan · 03:52');
  expect(text(card)).toContain('Bring the 2 chilled cartons back to Peliyagoda.');
  expect(card).toContain('role="status"');
  // It goes by itself after 8 seconds, and a swipe of the card in any direction closes it as a tap does.
  expect(GLANCE_MS).toBe(8000);
  expect(swiped(60, 4)).toBe(true);
  expect(swiped(-10, -48)).toBe(true);
  expect(swiped(6, 3)).toBe(false);
});
