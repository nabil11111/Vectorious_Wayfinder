import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { Issue, Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { answerOnItsWay, answeringIn, issuesKeyOf, issuesOptions, sendAnswer, type Answering } from './issues';

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

it('AC-6 on both depots each depot\'s problems are a read of its own, and an answer asks both lists again', async () => {
  expect(issuesKeyOf('Peliyagoda')).toEqual(['issues', 'Peliyagoda']);
  expect(issuesKeyOf('Kandy')).toEqual(['issues', 'Kandy']);
  const qc = signedIn();
  qc.setQueryData(meKey, { ...RUWAN, depotId: 'Both' });
  // The bell and Live day watch both lists.
  const watching = ['Peliyagoda', 'Kandy'].map((depot) => new QueryObserver(qc, issuesOptions(depot)).subscribe(() => {}));
  await settled();
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/v1/issues?depot=Peliyagoda', '/api/v1/issues?depot=Kandy']);
  // The answer names no depot: the server saves it on the problem's own (spec 021, rule 3). Both lists are read again.
  vi.mocked(fetch).mockClear();
  const sending = sendAnswer(qc, FLAG, 'go_short');
  await settled();
  answer(Response.json({ issues: [], replaceOn: null, decided: DECIDED }));
  expect(await sending).toEqual({ decided: DECIDED });
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url).sort()).toEqual(['/api/v1/issues/7c000000-0000-4000-8000-000000000001/decide', '/api/v1/issues?depot=Kandy', '/api/v1/issues?depot=Peliyagoda']);
  watching.forEach((stop) => stop());
});

it('AC-6 on both depots an answer stays with its own depot: sending or failing another depot\'s answer never shows it there', () => {
  const atPeliyagoda = { ...DECIDED, id: '7c000000-0000-4000-8000-0000000000a1' } as Issue;
  const atKandy = { ...FLAG, id: '7c000000-0000-4000-8000-0000000000b2' } as Issue;
  const decide = vi.fn();
  const view = (answering: Omit<Answering, 'decide'>, from: { byIssue: Record<string, string>; latest: string | null }, depot: string) =>
    answeringIn({ ...answering, decide }, depot, from, decide);
  // Peliyagoda's answer went out ("Bring them back") and its green line shows under Peliyagoda.
  const sentFromPeliyagoda = { byIssue: { [atPeliyagoda.id]: 'Peliyagoda' }, latest: 'Peliyagoda' };
  const sent = { sending: null, failed: null, refused: null, sent: atPeliyagoda };
  expect(view(sent, sentFromPeliyagoda, 'Peliyagoda').sent).toBe(atPeliyagoda);
  expect(view(sent, sentFromPeliyagoda, 'Kandy').sent).toBeNull();
  // A Kandy answer goes out, then fails: the earlier answer stays Peliyagoda's and never shows under Kandy.
  const both = { byIssue: { ...sentFromPeliyagoda.byIssue, [atKandy.id]: 'Kandy' }, latest: 'Kandy' };
  for (const now of [{ ...sent, sending: atKandy.id }, { ...sent, failed: atKandy.id }]) {
    expect(view(now, both, 'Kandy').sent).toBeNull();
    expect(view(now, both, 'Peliyagoda').sent).toBe(atPeliyagoda);
  }
  // The server's refusal of the latest answer shows only under the depot it was sent from.
  const refused = { sending: null, failed: null, refused: 'This problem changed.', sent: atPeliyagoda };
  expect(view(refused, both, 'Kandy').refused).toBe('This problem changed.');
  expect(view(refused, both, 'Peliyagoda').refused).toBeNull();
  // Sending from a part remembers that part as the answer's depot.
  const remember = vi.fn();
  answeringIn({ ...refused, decide }, 'Kandy', both, remember).decide(atKandy, 'go_short');
  expect(remember).toHaveBeenCalledWith(atKandy, 'go_short');
});
