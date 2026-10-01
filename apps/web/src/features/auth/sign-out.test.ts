import { MutationObserver, QueryClient } from '@tanstack/react-query';
import type { Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishBeforeSignOut, logoutMutation, meKey } from './api';

// Sign-out, as the avatar menu sends it (Q-04). A screen can hand it work that must end first, such as the shop's
// draft that is still saving, and sign-out waits for that work. With nothing handed over, sign-out is what it was.

const RUWAN: Me = { id: 'ruwan', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The sign-out on the same options and client calls as useLogout, with every request it sends.
function signedIn() {
  const qc = new QueryClient();
  qc.setQueryData(meKey, RUWAN);
  qc.setQueryData(['orders', 'store', 'next'], { kept: true });
  const sent: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { sent.push(url); return { status: 204, ok: true, json: async () => null }; }));
  return { qc, sent, signOut: () => new MutationObserver(qc, logoutMutation(qc)).mutate() };
}

describe('Q-04 sign-out waits for what must end first', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    // With no browser storage here, forgetting the kept account only warns.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for the work handed to it, and only then signs out', async () => {
    const { qc, sent, signOut } = signedIn();
    let finish!: () => void;
    const stop = finishBeforeSignOut(() => new Promise<void>((resolve) => { finish = () => { sent.push('work done'); resolve(); }; }));
    const signingOut = signOut();
    await later(20);
    expect(sent).toEqual([]);
    expect(qc.getQueryData(meKey)).toEqual(RUWAN);
    finish();
    await signingOut;
    expect(sent).toEqual(['work done', '/api/v1/auth/logout']);
    expect(qc.getQueryData(meKey)).toBeNull();
    expect(qc.getQueryData(['orders', 'store', 'next'])).toBeUndefined();
    stop();
  });

  it('signs out at once when nothing was handed to it, as every other role does', async () => {
    const { qc, sent, signOut } = signedIn();
    await signOut();
    expect(sent).toEqual(['/api/v1/auth/logout']);
    expect(qc.getQueryData(meKey)).toBeNull();
    expect(qc.getQueryData(['orders', 'store', 'next'])).toBeUndefined();
  });

  it('no longer waits for work taken back', async () => {
    const { sent, signOut } = signedIn();
    const stop = finishBeforeSignOut(() => new Promise<void>(() => {}));
    stop();
    await signOut();
    expect(sent).toEqual(['/api/v1/auth/logout']);
  });
});
