import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Q-18: a truck opened from lower in Today's trucks kept the list's scroll and opened at its foot, with the card that
// names the truck out of view. The hook is called as a screen calls it, with React's effect run when its dependencies
// change, as React runs it.

const hooks = vi.hoisted(() => ({ pathname: '/loader', deps: undefined as unknown[] | undefined }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useLayoutEffect: (effect: () => void, deps: unknown[]) => {
    if (hooks.deps && deps.every((dep, i) => Object.is(dep, hooks.deps![i]))) return;
    hooks.deps = deps;
    effect();
  },
}));
vi.mock('react-router', async (original) => ({ ...await original<typeof import('react-router')>(), useLocation: () => ({ pathname: hooks.pathname }) }));

const scrollTo = vi.fn();
beforeEach(() => {
  hooks.deps = undefined;
  vi.stubGlobal('window', { scrollTo });
});
afterEach(() => {
  scrollTo.mockReset();
  vi.unstubAllGlobals();
});

it('Q-18 opens a truck at the top of its page, and the list again when the loader goes back', async () => {
  const { useOpensAtTop } = await import('./top');
  hooks.pathname = '/loader';
  useOpensAtTop();
  scrollTo.mockReset();

  hooks.pathname = '/loader/trucks/0b000000-0000-4000-8000-000000000004';
  useOpensAtTop();
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0);

  hooks.pathname = '/loader';
  useOpensAtTop();
  expect(scrollTo).toHaveBeenCalledTimes(2);
});

it('Q-18 keeps the place on a page drawn again, such as when the day is fetched again', async () => {
  const { useOpensAtTop } = await import('./top');
  hooks.pathname = '/loader/trucks/0b000000-0000-4000-8000-000000000004';
  useOpensAtTop();
  scrollTo.mockReset();
  useOpensAtTop();
  useOpensAtTop();
  expect(scrollTo).not.toHaveBeenCalled();
});
