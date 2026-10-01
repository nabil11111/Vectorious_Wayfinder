import { useLayoutEffect } from 'react';
import { useMutation, useMutationState, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { Me, type SwitchDepotRequest } from '@wayfinder/contracts';
import { toast } from 'sonner';
import { meKey, takeAccount } from '@/features/auth/api';
import { answerOnItsWay } from '@/features/live/issues';
import { planWriteOnItsWay, retireBoard } from '@/features/plan/board';
import { api, ApiRequestError, DEPOT_CHANGED, nameDepot } from '@/lib/api';
import { clockKey } from '@/lib/clock';

// The dispatcher's depot switch (spec 020, D-93): the top bar's and the dashboard map card's. The server keeps the
// chosen depot on the session, so every read and write after a switch is for it, and answers Me with it. Both is a
// choice like a depot (spec 021, D-96): the session then works on both depots together, and Me says 'Both'.

// What a switch that did not go through says. The switch shows the depot before again.
export const SWITCH_FAILED = 'Could not switch depots. Try again.';
// What a tab says when a switch made elsewhere retired a plan board that still held changes the server had not saved.
export const PLAN_DROPPED = 'Plan changes that were not saved were dropped: the depot was switched in another tab.';
// What it says instead when a plan change it sent got no answer before it took the switch: the server may have kept it,
// so it is never said to be dropped (Q-13). It names the depot the change was for.
export const planUnsure = (depot: string) => `The depot was switched in another tab while a plan change was on its way. Check ${depot}'s plan board for it.`;
// How long a tab that hears of a switch made elsewhere waits for its own plan changes on their way to be answered, and
// how often it looks.
export const PLAN_ANSWER_WAIT_MS = 5000;
const PLAN_ANSWER_LOOK_MS = 50;

// A switch on its way is filed under this key, so both switches show the pressed depot at once.
export const depotSwitchKey = ['depot-switch'] as const;

// What a press does: it switches to a depot other than the one on show, and not while a switch is on its way.
export const switchTo = (pressed: string, chosen: string, switching: boolean) => (switching || pressed === chosen ? null : pressed);

// A switch on this screen, whichever tab made it. Every read on screen was for the depot before, some keys (the plan
// board's) do not name it, and a depot read on Both is read again under the new session, so no read stays or lands:
// each is cancelled, the account's too, so an older answer cannot land on the new one, and all but the account and the
// clock (the same for both depots) are dropped. Each page then shows its loading state until the new depot's read
// arrives, and the new account opens the live stream again (lib/live.ts), since a stream carries the depot it opened
// with.
// It answers whether the plan board held changes the server had not saved, which went with it.
export async function takeSwitch(qc: QueryClient, me: Me) {
  await qc.cancelQueries({ predicate: (query) => query.queryKey[0] !== clockKey[0] });
  // Signed out, or someone else signed in, meanwhile: nothing is put back, in the cache or in storage.
  if (!signedInAs(qc, me.id)) return false;
  commit(qc, me);
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] && query.queryKey[0] !== clockKey[0] });
  // The board's queue holds changes outside the cache, so it goes too, whatever page is on show.
  const dropped = retireBoard(qc);
  takeAccount(qc, me);
  return dropped;
}

// The other tabs of this browser share the session, so they follow a switch. Each query client is one tab, and talks
// through its own channel, which never hears its own messages.
const channels = new WeakMap<QueryClient, BroadcastChannel>();
function channelOf(qc: QueryClient) {
  let channel = channels.get(qc);
  if (!channel) {
    channel = new BroadcastChannel('wayfinder-depot-switch');
    channels.set(qc, channel);
  }
  return channel;
}

// The account and the depot each tab shows, which only a switch it takes changes, and which it names on every request
// (D-95), so the server refuses one whose depot the session has left. The session decides it: an account read that
// finds the session on another depot (useMe's own refetch, say once the network is back), or such a refusal, is a
// switch made without this tab, and the tab takes it as one, so no tab stays on a depot the session left.
const committed = new WeakMap<QueryClient, { id: string; depotId: string | null }>();
function commit(qc: QueryClient, me: Me | null | undefined) {
  if (me) committed.set(qc, { id: me.id, depotId: me.depotId });
  else committed.delete(qc);
  nameDepot(me?.role === 'dispatcher' ? me.depotId : null);
}

// The account signed in on this tab, as the cache holds it now, is the one named. Every step that waited checks it
// again, so a read that lands after a sign-out, or after someone else signed in, takes nothing.
const signedInAs = (qc: QueryClient, id: string) => qc.getQueryData<Me | null>(meKey)?.id === id;

// Waits for the plan changes this tab has on their way to be answered, at most PLAN_ANSWER_WAIT_MS: true once they are.
async function planChangesAnswered(qc: QueryClient) {
  for (let waited = 0; planWriteOnItsWay(qc); waited += PLAN_ANSWER_LOOK_MS) {
    if (waited >= PLAN_ANSWER_WAIT_MS) return false;
    await new Promise((resolve) => window.setTimeout(resolve, PLAN_ANSWER_LOOK_MS));
  }
  return true;
}

// The session's account as the server holds it: a depot other than the one on show is a switch made without this tab,
// taken as one. Plan changes it dropped are not dropped without a word. A plan change this tab sent just before the
// session moved can still have been kept, so the tab first waits for its answer (Q-13): the board is retired and the line
// chosen only then, and it says the changes were dropped only when they were. newest says whether the read that found
// the session is still the newest one.
async function takeSession(qc: QueryClient, session: Me, newest: () => boolean) {
  const shownDepot = () => (signedInAs(qc, session.id) ? (committed.get(qc) ?? qc.getQueryData<Me | null>(meKey))?.depotId ?? null : null);
  const before = shownDepot();
  if (before === null || before === session.depotId) return;
  const answered = await planChangesAnswered(qc);
  // Meanwhile a newer read may have taken over, someone else signed in, or the tab took this depot already.
  if (!newest() || shownDepot() !== before) return;
  if (await takeSwitch(qc, session)) toast(answered ? PLAN_DROPPED : planUnsure(before), { id: 'plan-dropped', duration: 6000, classNames: { title: 'text-pretty' } });
}

// Every read of the session takes the next number, and only the newest may apply: an answer a later read overtook is
// dropped, so a slow answer never undoes a newer one. An account read that lands takes its number as it lands, and each
// read cancels the account read already on its way, so nothing older than it can land after it. A read this tab sends
// carries a signal of its own, which a newer read, a sign-out or another account aborts: its answer, a 401 above all,
// is then never heard, since a stale 401 would sign out whoever signed in since.
const reads = new WeakMap<QueryClient, { generation: number; stop: AbortController | null }>();
function nextRead(qc: QueryClient, sent = false) {
  const last = reads.get(qc);
  last?.stop?.abort();
  const read = { generation: (last?.generation ?? 0) + 1, stop: sent ? new AbortController() : null };
  reads.set(qc, read);
  return read;
}

// The switch's own request while it is out, which a sign-out or another account aborts too.
const switching = new WeakMap<QueryClient, AbortController>();

// A sign-out, or another account in this tab: nothing asked for the account before is heard any more.
function forgetAccount(qc: QueryClient) {
  nextRead(qc);
  switching.get(qc)?.abort();
  switching.delete(qc);
}

// One read of the session as the server holds it, and whether it is still the newest.
async function readOnce(qc: QueryClient): Promise<{ newest: () => boolean; session: Me | null; error: unknown }> {
  const read = nextRead(qc, true);
  const newest = () => reads.get(qc)?.generation === read.generation;
  await qc.cancelQueries({ queryKey: meKey, exact: true });
  try {
    return { newest, session: await api<Me>('/auth/me', { signal: read.stop!.signal }), error: null };
  } catch (error) {
    return { newest, session: null, error };
  }
}

// One read of the session, after another tab's switch or a refusal for a depot the session left: the tab takes the depot
// the session is on, and tells nobody in turn.
async function readSession(qc: QueryClient) {
  const read = await readOnce(qc);
  // A newer read, a sign-out or another account overtook this one: it decides nothing.
  if (!read.newest()) return;
  if (read.session === null) {
    // The account's own reads go on, and the first that gets through takes whatever the session is on.
    console.warn('Could not read the session to see which depot it works on.', read.error);
    return;
  }
  await takeSession(qc, read.session, read.newest);
}

// Another tab of the session switched. Its message names the account only, since an answer can come late and another
// switch may have followed, so this tab reads the session.
export async function followSwitch(qc: QueryClient, message: unknown) {
  const told = Me.pick({ id: true }).safeParse(message);
  const mine = qc.getQueryData<Me | null>(meKey);
  if (!told.success || !mine || told.data.id !== mine.id) return;
  await readSession(qc);
}

// Mounted once on the dispatcher's pages: the depot they name from their first read, another tab's switch, a refusal for
// a depot the session left, and every account read that lands. A layout effect, so it runs before the pages first read.
export function useFollowSwitches() {
  const qc = useQueryClient();
  useLayoutEffect(() => {
    commit(qc, qc.getQueryData<Me | null>(meKey));
    const channel = channelOf(qc);
    const follow = (event: MessageEvent) => { void followSwitch(qc, event.data); };
    channel.addEventListener('message', follow);
    const refused = () => { void readSession(qc); };
    window.addEventListener(DEPOT_CHANGED, refused);
    const stopReading = qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== meKey[0]) return;
      const me = event.query.state.data as Me | null | undefined;
      // Signed out: the tab shows no depot and names none, no read on its way may apply, and the board's queue goes, so
      // nothing of it is sent or holds a switch once someone signs in again.
      if (!me) {
        forgetAccount(qc);
        commit(qc, null);
        retireBoard(qc);
        return;
      }
      if (committed.get(qc)?.id !== me.id) forgetAccount(qc);
      // An account set by hand (this tab taking a switch, or a sign-in) is no read of the session.
      if (event.action.manual) return;
      const read = nextRead(qc);
      void takeSession(qc, me, () => reads.get(qc)?.generation === read.generation);
    });
    return () => {
      channel.removeEventListener('message', follow);
      window.removeEventListener(DEPOT_CHANGED, refused);
      stopReading();
    };
  }, [qc]);
}

export const switchDepotMutation = (qc: QueryClient): UseMutationOptions<Me, Error, string> => ({
  mutationKey: depotSwitchKey,
  // With no signal it fails at once and says so, rather than switching later by itself.
  networkMode: 'always',
  mutationFn: async (depotId) => {
    // A write still on its way (a plan change from the board or View plan, a problem's answer) is the depot's on show:
    // after the switch its answer would land on the other depot, or the server would refuse it and the change would be
    // dropped without a word. So the switch waits for none: it is refused until every one has landed.
    if (planWriteOnItsWay(qc) || answerOnItsWay()) throw new Error('A change is still on its way.');
    // The account that pressed it. Should it sign out, or someone else sign in, while the switch is out, the switch stops
    // where it is and says nothing, and no account is put back.
    const asker = qc.getQueryData<Me | null>(meKey);
    if (!asker) throw new Error('Nobody is signed in.');
    let answer: Me | null = null;
    let noAnswer: unknown = null;
    const stop = new AbortController();
    switching.set(qc, stop);
    try {
      answer = await api<Me>('/me/depot', { method: 'PUT', json: { depotId } satisfies SwitchDepotRequest, signal: stop.signal });
    } catch (error) {
      if (!signedInAs(qc, asker.id)) return asker;
      // A clear refusal: the server did not switch, so there is nothing to read.
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) throw error;
      noAnswer = error;
    } finally {
      if (switching.get(qc) === stop) switching.delete(qc);
    }
    if (!signedInAs(qc, asker.id)) return asker;
    // The session decides which depot this tab is on. An answer can come late, after another tab switched the session
    // again, and a switch whose answer was lost can still have gone through, so the tab reads the session and takes it.
    // With no word on the session, a switch that answered takes its answer (should it be stale, the server refuses the
    // tab's next request and the tab reads again), and one that did not changes nothing.
    const read = await readOnce(qc);
    if (!signedInAs(qc, asker.id)) return asker;
    // A newer read overtook this one, and that read decides.
    if (!read.newest()) return asker;
    let session = read.session;
    if (session === null) {
      if (answer === null) throw noAnswer;
      console.warn('Could not read the session after a depot switch, so its answer is taken.', read.error);
      session = answer;
    }
    if (session.id !== asker.id) throw noAnswer ?? new Error('The session is another account now.');
    const shown = committed.get(qc) ?? asker;
    if (session.depotId !== shown.depotId) {
      await takeSwitch(qc, session);
      if (signedInAs(qc, session.id)) channelOf(qc).postMessage({ id: session.id });
    } else if (noAnswer !== null) {
      // The session is still on the depot on show: the switch did not go through.
      throw noAnswer;
    }
    return session;
  },
  onError: () => { toast(SWITCH_FAILED, { id: 'depot-switch', duration: 6000, classNames: { title: 'text-pretty' } }); },
});

// The depot of a switch on its way from either switch, or null when none is.
export function usePressedDepot() {
  const pressed = useMutationState({ filters: { mutationKey: depotSwitchKey, status: 'pending' }, select: (mutation) => String(mutation.state.variables) });
  return pressed.at(-1) ?? null;
}

// A switch as drawn: the depot chosen, which is the one pressed while its switch is on its way and otherwise the one
// on show, and what a press does. Every switch on screen shows the same pressed depot, and a failed switch shows the
// depot before again.
export function useSwitchDepot(depot: string) {
  const qc = useQueryClient();
  const { mutate } = useMutation(switchDepotMutation(qc));
  const pressed = usePressedDepot();
  const switching = pressed !== null;
  const chosen = pressed ?? depot;
  const choose = (name: string) => {
    const to = switchTo(name, chosen, switching);
    if (to !== null) mutate(to);
  };
  return { chosen, switching, choose };
}
