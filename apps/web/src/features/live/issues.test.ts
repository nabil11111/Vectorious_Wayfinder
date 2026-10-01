import { QueryClient } from '@tanstack/react-query';
import type { Issue, Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { answerOnItsWay, sendAnswer } from './issues';

// A problem's answer across a dispatcher's depot switch (spec 020, AC-6): it holds a switch while it is on its way, and
// an answer that lands after the depot changed is not this screen's to show.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const RUWAN: Me = { id: 'u1', username: 'ruwan', staffId: 'P-001', displayName: 'Ruwan', role: 'dispatcher', depotId: 'Peliyagoda', outletId: null };
// The answer names the problem by its id and the revision on screen, which is all it reads of it.
const FLAG = { id: '7c000000-0000-4000-8000-000000000001', revision: 2 } as Issue;
const DECIDED = { ...FLAG, revision: 3, status: 'decided' };

let answer: (response: Response | Error) => void;
beforeEach(() => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/decide')
    ? new Promise<Response>((resolve, reject) => { answer = (response) => (response instanceof Error ? reject(response) : resolve(response)); })
    : Promise.resolve(Response.json({ issues: [], replaceOn: null })))));
});
afterEach(() => vi.unstubAllGlobals());

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
function signedIn() {
  const qc = new QueryClient();
  qc.setQueryData(meKey, RUWAN);
  return qc;
}

it('AC-6 an answer to a problem holds a depot switch until the server answers, and then shows as sent', async () => {
  const qc = signedIn();
  expect(answerOnItsWay()).toBe(false);
  const sending = sendAnswer(qc, FLAG, 'go_short');
  await settled();
  expect(answerOnItsWay()).toBe(true);

  answer(Response.json({ issues: [], replaceOn: null, decided: DECIDED }));
  expect(await sending).toEqual({ decided: DECIDED });
  expect(answerOnItsWay()).toBe(false);
  expect(fetch).toHaveBeenCalledWith('/api/v1/issues/7c000000-0000-4000-8000-000000000001/decide', expect.objectContaining({ method: 'POST' }));
});

it('AC-6 an answer that lands after the depot changed is not shown, sent or refused', async () => {
  for (const landing of [
    () => answer(Response.json({ issues: [], replaceOn: null, decided: DECIDED })),
    () => answer(Response.json({ error: { code: 'stale', message: 'This problem changed.' } }, { status: 409 })),
    () => answer(new TypeError('Failed to fetch')),
  ]) {
    const qc = signedIn();
    const sending = sendAnswer(qc, FLAG, 'go_short');
    await settled();
    // Another tab switched the session to Kandy while the answer was out, and this tab followed.
    qc.setQueryData(meKey, { ...RUWAN, depotId: 'Kandy' });
    landing();
    expect(await sending).toBeNull();
    expect(answerOnItsWay()).toBe(false);
  }
});
