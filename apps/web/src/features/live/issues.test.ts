import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { Issue, Me } from '@wayfinder/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { meKey } from '@/features/auth/api';
import { DEPOT_CHANGED, DEPOT_HEADER, nameDepot } from '@/lib/api';
import { PHOTO_TAB_BLOCKED, answerOnItsWay, answeringIn, issuesKeyOf, issuesOptions, openIssuePhoto, sendAnswer, type Answering } from './issues';

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

// A browser whose tabs the test watches: the photo's tab, and every address handed back.
function photoBrowser(opens: boolean) {
  const photoTab = { location: { href: '' }, close: vi.fn() };
  let heard = 0;
  const browser = Object.assign(new EventTarget(), { setTimeout, clearTimeout, open: vi.fn(() => (opens ? photoTab : null)) });
  browser.addEventListener(DEPOT_CHANGED, () => { heard += 1; });
  vi.stubGlobal('window', browser);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  const released = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  return { browser, photoTab, released, heard: () => heard };
}

it('D-95 a problem\'s photo opens from bytes that name the depot the tab shows, and its address is given back once it has opened', async () => {
  vi.useFakeTimers();
  nameDepot('Peliyagoda');
  try {
    const { browser, photoTab, released } = photoBrowser(true);
    const fetch = vi.fn(async () => new Response(new Blob(['photo'], { type: 'image/jpeg' })));
    vi.stubGlobal('fetch', fetch);
    expect(await openIssuePhoto(FLAG, 'Peliyagoda')).toBeNull();
    expect(browser.open).toHaveBeenCalledWith('', '_blank');
    expect(photoTab.location.href).toBe('blob:photo');
    expect(fetch).toHaveBeenCalledWith('/api/v1/issues/7c000000-0000-4000-8000-000000000001/photo?depot=Peliyagoda', expect.objectContaining({ headers: expect.objectContaining({ [DEPOT_HEADER]: 'Peliyagoda' }) }));
    expect(released).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(released).toHaveBeenCalledWith('blob:photo');
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
    nameDepot(null);
  }
});

it('D-95 a problem\'s photo the server refuses closes its tab and says why, and a refusal for a depot the session left is heard', async () => {
  const { photoTab, heard } = photoBrowser(true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'depot_changed', message: 'The depot was switched in another tab.' } }, { status: 409 })));
  expect(await openIssuePhoto(FLAG, 'Peliyagoda')).toBe('The depot was switched in another tab.');
  expect(photoTab.close).toHaveBeenCalled();
  expect(heard()).toBe(1);

  // A browser that keeps the tab from opening is said plainly, and nothing is fetched.
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  photoBrowser(false);
  expect(await openIssuePhoto(FLAG, 'Peliyagoda')).toBe(PHOTO_TAB_BLOCKED);
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('a photo whose card went away before its old session\'s 401 landed signs nobody out and says nothing', async () => {
  const { browser, photoTab } = photoBrowser(true);
  let signedOut = 0;
  browser.addEventListener('wayfinder-signed-out', () => { signedOut += 1; });
  // The dispatcher signed out, and perhaps someone else signed in, while the photo was on its way.
  const gone = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => {
    gone.abort();
    return Response.json({ error: { code: 'signed_out', message: 'Please sign in.' } }, { status: 401 });
  }));
  expect(await openIssuePhoto(FLAG, 'Peliyagoda', gone.signal)).toBeNull();
  expect(photoTab.close).toHaveBeenCalled();
  expect(signedOut).toBe(0);
  vi.restoreAllMocks();
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
  // Kandy's photo names Kandy, though the tab names Both.
  nameDepot('Both');
  const { photoTab } = photoBrowser(true);
  vi.mocked(fetch).mockClear();
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(new Blob(['photo'], { type: 'image/jpeg' })));
  expect(await openIssuePhoto(FLAG, 'Kandy')).toBeNull();
  expect(fetch).toHaveBeenCalledWith('/api/v1/issues/7c000000-0000-4000-8000-000000000001/photo?depot=Kandy', expect.objectContaining({ headers: expect.objectContaining({ [DEPOT_HEADER]: 'Both' }) }));
  expect(photoTab.location.href).toBe('blob:photo');
  vi.restoreAllMocks();
  nameDepot(null);

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
