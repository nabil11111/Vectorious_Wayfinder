import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DirtyFormWarning } from './dirty-form';

const state = vi.hoisted(() => ({ predicate: null as null | ((args: { currentLocation: { pathname: string; search: string }; nextLocation: { pathname: string; search: string } }) => boolean),
  discard: null as null | (() => void), keep: null as null | (() => void), proceed: vi.fn(), reset: vi.fn() }));
vi.mock('react-router', () => ({ useBlocker: (predicate: typeof state.predicate) => {
  state.predicate = predicate;
  return { state: 'blocked', proceed: state.proceed, reset: state.reset };
} }));
vi.mock('@/features/auth/api', () => ({ useLogout: () => ({ isError: false }), askBeforeSignOut: vi.fn() }));
vi.mock('@/components/ui/alert-dialog', () => {
  const passthrough = ({ children }: { children: ReactNode }) => children;
  return { AlertDialog: passthrough, AlertDialogContent: passthrough, AlertDialogHeader: passthrough, AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough, AlertDialogFooter: passthrough,
    AlertDialogCancel: ({ onClick }: { onClick: () => void }) => { state.keep = onClick; return null; },
    AlertDialogAction: ({ onClick }: { onClick: () => void }) => { state.discard = onClick; return null; } };
});
const move = (path = '/store/orders', search = '') => ({ currentLocation: { pathname: '/store/deliveries/stop', search: '' }, nextLocation: { pathname: path, search } });
describe('discarding complete unsent input', () => {
  it('keeps edits through a cancelled navigation and only proceeds after explicit discard', () => {
    renderToStaticMarkup(<DirtyFormWarning dirty name="receipt" />);
    expect(state.predicate!(move())).toBe(true);
    expect(state.predicate!(move('/store/deliveries/stop'))).toBe(false);
    expect(state.predicate!(move('/store/deliveries/stop', '?stop=other'))).toBe(true);
    state.keep!();
    expect(state.reset).toHaveBeenCalled();
    expect(state.predicate!(move())).toBe(true);
    state.discard!();
    expect(state.proceed).toHaveBeenCalled();
    expect(state.predicate!(move())).toBe(false);
  });
  it('allows untouched form navigation', () => {
    renderToStaticMarkup(<DirtyFormWarning dirty={false} name="receipt" />);
    expect(state.predicate!(move())).toBe(false);
  });
});
