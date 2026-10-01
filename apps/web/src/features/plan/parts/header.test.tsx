import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { planOf } from '../draft';
import { BoardHeader } from './BoardHeader';
import { historyKey, historyTip, openAfter, START_OVER_LINE } from './history-keys';

// Spec 027's header: Undo and Redo, each named by the change it undoes or redoes, and Start over while the plan is a
// draft; and the keys that undo and redo, never while the focus is in a text box.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const board = (status: 'draft' | 'published') => PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00.000Z', open: true },
  plan: { mixBrands: false, trips: [], deferrals: [], id: '00000000-0000-4000-8000-000000000100', revision: 3, status, savedAt: null, sentAt: null, canUnsend: false, lockedReason: null },
  dropped: [], check: null, orders: [], shops: [], vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});
const header = (history: BoardScreen['history'], status: 'draft' | 'published' = 'draft') => {
  const shown = board(status);
  const screen: BoardScreen = { board: shown, draft: planOf(shown), saving: 'saved', refused: null, acting: false, undo: null, history };
  return renderToStaticMarkup(
    <BoardHeader screen={screen} tab="unplanned" working="unplanned" onTab={() => undefined} openCount={0} unplannedCount={0} doneCount={0}
      change={() => undefined} retry={() => undefined} onViewPlan={() => undefined} stale={false} onRefresh={() => undefined} refreshing={false}
      onUndo={() => undefined} onRedo={() => undefined} onStartOver={() => undefined} />,
  );
};
const buttonFor = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

it('AC-1 names the change Undo and Redo would undo and redo, and turns them off with nothing to do', () => {
  const html = header({ undo: 'Fresh Dehiwala added to Wasantha\'s reefer van', redo: null }).replaceAll('&#x27;', '\'');
  const on = buttonFor(html, 'Undo: Fresh Dehiwala added to Wasantha\'s reefer van');
  expect(on).not.toMatch(/aria-disabled="true"/);
  expect(on).not.toMatch(/data-disabled=""/);
  // L-15: an off button is really off (aria-disabled, which Base UI's Button honours by ignoring presses) and takes
  // the app's disabled look; it stays focusable so its tooltip can still say there is nothing to redo.
  const off = buttonFor(html, 'Redo');
  expect(off).toMatch(/aria-disabled="true"/);
  expect(off).toMatch(/data-disabled=""/);
  expect(off).toMatch(/data-disabled:opacity-50/);
  const none = header({ undo: null, redo: 'Fresh Pannala deferred' });
  expect(buttonFor(none, 'Undo')).toMatch(/aria-disabled="true"/);
  expect(buttonFor(none, 'Redo: Fresh Pannala deferred')).not.toMatch(/aria-disabled="true"/);
});

it('L-15 keeps the tooltip on an off Undo or Redo, saying there is nothing to do', () => {
  expect(historyTip('Undo', null)).toBe('Nothing to undo');
  expect(historyTip('Redo', null)).toBe('Nothing to redo');
  expect(historyTip('Undo', 'Fresh Pannala deferred')).toBe('Undo: Fresh Pannala deferred');
});

it('AC-4 offers Start over while the plan is a draft, and says what it does before it does it', () => {
  expect(header({ undo: null, redo: null })).toMatch(/<\/svg> Start over<\/button>/);
  expect(header({ undo: null, redo: null }, 'published')).not.toContain('Start over');
  expect(START_OVER_LINE('2026-06-25')).toBe('Take every trip and deferral off Thursday\'s plan? Every order goes back to Unplanned. You can undo this.');
});

it('AC-1 undoes with Ctrl or Cmd+Z and redoes with Ctrl or Cmd+Shift+Z or Ctrl+Y, never in a text box', () => {
  const key = (init: KeyboardEventInit & { target?: string }) => historyKey({ ...init, key: init.key ?? 'z', ctrlKey: init.ctrlKey ?? false, metaKey: init.metaKey ?? false, shiftKey: init.shiftKey ?? false, target: init.target ?? 'BODY' });
  expect(key({ ctrlKey: true })).toBe('undo');
  expect(key({ metaKey: true })).toBe('undo');
  expect(key({ ctrlKey: true, shiftKey: true, key: 'Z' })).toBe('redo');
  expect(key({ metaKey: true, shiftKey: true, key: 'Z' })).toBe('redo');
  expect(key({ ctrlKey: true, key: 'y' })).toBe('redo');
  expect(key({ key: 'z' })).toBeNull();
  for (const target of ['INPUT', 'TEXTAREA', 'SELECT', 'EDITABLE']) expect(key({ ctrlKey: true, target })).toBeNull();
});

// L-16: after Undo or Redo the board opens what was open on that side of the step, and never keeps a trip that is gone.
it('L-16 opens the trip that was open before a step on Undo, and the one after it on Redo, never one that is gone', () => {
  const trip = (vehicleId: string, tripNo: 1 | 2 = 1) => ({ vehicleId, tripNo, leaveAt: null, driverId: null, stops: [] });
  const before = { mixBrands: false, trips: [trip('VEH011')], deferrals: [] };
  const after = { ...before, trips: [...before.trips, trip('VEH035', 2)] };
  // Start a trip with Chaminda's open: Undo opens Chaminda's again, Redo the new one.
  const started = { line: 'Second trip started on Wasantha\'s reefer van', tripKey: 'VEH035-2', from: 'VEH011-1' };
  expect(openAfter('undo', started, before, 'VEH035-2')).toBe('VEH011-1');
  expect(openAfter('redo', started, after, 'VEH011-1')).toBe('VEH035-2');
  // Started with nothing open: Undo opens nothing, so the address loses the trip.
  expect(openAfter('undo', { ...started, from: null }, before, 'VEH035-2')).toBeNull();
  // Remove the open trip: Undo opens it again, Redo closes it.
  const removed = { line: 'Trip on Chaminda\'s reefer truck removed', tripKey: null, from: 'VEH011-1' };
  expect(openAfter('undo', removed, before, null)).toBe('VEH011-1');
  expect(openAfter('redo', removed, { ...before, trips: [] }, 'VEH011-1')).toBeNull();
  // A step that moved no trip leaves the open trip open, unless the step took it away.
  const deferred = { line: 'Fresh Pannala deferred', tripKey: null };
  expect(openAfter('undo', deferred, before, 'VEH011-1')).toBeUndefined();
  expect(openAfter('undo', deferred, before, 'VEH035-2')).toBeNull();
  expect(openAfter('undo', null, before, 'VEH011-1')).toBeUndefined();
});
