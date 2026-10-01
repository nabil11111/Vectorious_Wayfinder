import { renderToStaticMarkup } from 'react-dom/server';
import { PlanBoard } from '@wayfinder/contracts';
import { expect, it, vi } from 'vitest';
import type { BoardScreen } from '../board';
import { planOf } from '../draft';
import { BoardHeader } from './BoardHeader';
import { historyKey, START_OVER_LINE } from './history-keys';

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
      onUndo={() => undefined} onRedo={() => undefined} />,
  );
};
const buttonFor = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

it('AC-1 names the change Undo and Redo would undo and redo, and turns them off with nothing to do', () => {
  const html = header({ undo: 'Fresh Dehiwala added to Wasantha\'s reefer van', redo: null }).replaceAll('&#x27;', '\'');
  expect(buttonFor(html, 'Undo: Fresh Dehiwala added to Wasantha\'s reefer van')).not.toMatch(/disabled=""/);
  expect(buttonFor(html, 'Redo')).toMatch(/disabled=""/);
  const none = header({ undo: null, redo: 'Fresh Pannala deferred' });
  expect(buttonFor(none, 'Undo')).toMatch(/disabled=""/);
  expect(buttonFor(none, 'Redo: Fresh Pannala deferred')).not.toMatch(/disabled=""/);
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
