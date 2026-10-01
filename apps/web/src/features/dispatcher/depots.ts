import { useEffect } from 'react';
import { useMutation, useMutationState, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { Me, type SwitchDepotRequest } from '@wayfinder/contracts';
import { toast } from 'sonner';
import { meKey, takeAccount } from '@/features/auth/api';
import { answerOnItsWay } from '@/features/live/issues';
import { planWriteOnItsWay, retireBoard } from '@/features/plan/board';
import { api, ApiRequestError } from '@/lib/api';
import { clockKey } from '@/lib/clock';

// The dispatcher's depot switch (spec 020, D-93): the top bar's and the dashboard map card's. The server keeps the
// chosen depot on the session, so every read and write after a switch is for it, and answers Me with it.

// The booklet's two depots (outlets.csv, vehicles.csv), as the frames' switches list them.
export const DEPOTS = ['Peliyagoda', 'Kandy'] as const;

// What Both says when pointed at or pressed: a dispatcher works on one depot at a time for now.
export const BOTH_LATER = 'Both depots together come later.';
// What a switch that did not go through says. The switch shows the depot before again.
export const SWITCH_FAILED = 'Could not switch depots. Try again.';

// A switch on its way is filed under this key, so both switches show the pressed depot at once.
export const depotSwitchKey = ['depot-switch'] as const;

// What a press does: it switches to a depot other than the one on show, and not while a switch is on its way.
export const switchTo = (pressed: string, chosen: string, switching: boolean) => (switching || pressed === chosen ? null : pressed);

// A switch on this screen, whichever tab made it. Every read on screen was for the depot before, and some keys (the
// plan board's, the problems') do not name it, so no read stays or lands: each is cancelled, the account's too, so an
// older answer cannot land on the new one, and all but the account and the clock (the same for both depots) are
// dropped. Each page then shows its loading state until the new depot's read arrives, and the new account opens the
// live stream again (lib/live.ts), since a stream carries the depot it opened with.
export async function takeSwitch(qc: QueryClient, me: Me) {
  committed.set(qc, { id: me.id, depotId: me.depotId });
  await qc.cancelQueries({ predicate: (query) => query.queryKey[0] !== clockKey[0] });
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] && query.queryKey[0] !== clockKey[0] });
  // The board's queue holds changes outside the cache, so it goes too, whatever page is on show.
  retireBoard(qc);
  takeAccount(qc, me);
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

// The account and the depot each tab shows, which only a switch it takes changes. The session decides it: an account
// read that finds the session on another depot (useMe's own refetch, say once the network is back) is a switch made
// without this tab, and the tab takes it as one, so no tab stays on a depot the session left.
const committed = new WeakMap<QueryClient, { id: string; depotId: string | null }>();

// The session's account as the server holds it: a depot other than the one on show is taken as a switch.
async function takeSession(qc: QueryClient, session: Me) {
  const shown = committed.get(qc) ?? qc.getQueryData<Me | null>(meKey);
  if (shown && shown.id === session.id && shown.depotId !== session.depotId) await takeSwitch(qc, session);
}

// Another tab of the session switched. Its message names the account only, since an answer can come late and another
// switch may have followed: this tab reads the session once and takes the depot it is on, and tells nobody in turn.
export async function followSwitch(qc: QueryClient, message: unknown) {
  const told = Me.pick({ id: true }).safeParse(message);
  const mine = qc.getQueryData<Me | null>(meKey);
  if (!told.success || !mine || told.data.id !== mine.id) return;
  let session: Me;
  try {
    session = await api<Me>('/auth/me');
  } catch (error) {
    // The account's own reads go on, and the first that gets through takes whatever the session is on.
    console.warn('Could not read the session after another tab switched depots.', error);
    return;
  }
  await takeSession(qc, session);
}

// Mounted once on the dispatcher's pages: another tab's switch, and every account read that lands.
export function useFollowSwitches() {
  const qc = useQueryClient();
  useEffect(() => {
    const mine = qc.getQueryData<Me | null>(meKey);
    if (mine) committed.set(qc, { id: mine.id, depotId: mine.depotId });
    const channel = channelOf(qc);
    const follow = (event: MessageEvent) => { void followSwitch(qc, event.data); };
    channel.addEventListener('message', follow);
    const stopReading = qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== meKey[0]) return;
      const me = event.query.state.data as Me | null | undefined;
      if (me) void takeSession(qc, me);
    });
    return () => {
      channel.removeEventListener('message', follow);
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
    let answer: Me | null = null;
    let noAnswer: unknown = null;
    try {
      answer = await api<Me>('/me/depot', { method: 'PUT', json: { depotId } satisfies SwitchDepotRequest });
    } catch (error) {
      // A clear refusal: the server did not switch, so there is nothing to read.
      if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) throw error;
      noAnswer = error;
    }
    // The session decides which depot this tab is on. An answer can come late, after another tab switched the session
    // again, and a switch whose answer was lost can still have gone through, so the tab reads the session and takes it.
    // With no word on the session, a switch that answered takes its answer, and one that did not changes nothing.
    let session: Me;
    try {
      session = await api<Me>('/auth/me');
    } catch (error) {
      if (answer === null) throw noAnswer;
      console.warn('Could not read the session after a depot switch, so its answer is taken.', error);
      session = answer;
    }
    const mine = qc.getQueryData<Me | null>(meKey);
    if (!mine || session.id !== mine.id) throw noAnswer ?? new Error('The session is another account now.');
    if (session.depotId !== mine.depotId) {
      await takeSwitch(qc, session);
      channelOf(qc).postMessage({ id: session.id });
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
