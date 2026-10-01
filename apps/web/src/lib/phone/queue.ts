import { useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PHONE_ACCOUNT_HEADER } from '@wayfinder/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { answered, hasSignal, noAnswer, probeNow, retryDelay, startSignal, whenBack, whenLost, within } from './signal';
import { keptStore, type Queued, type Shapes } from './store';

// A phone's save-first queue (spec 013, rule 10, D-45, D-50; spec 015, rule 6, D-57; plan.md "The phone"): the driver's
// writes and the shop's receipts go through one of these each. One tab owns a queue: the tab that holds the browser's
// lock `wayfinder-<name>`, for as long as it is open. Only that tab runs the queue's loop, which fetches the day, keeps
// it and sends, one step at a time: fetch the day, keep it and take off the queue every write it lists as applied,
// then send the oldest waiting write, and start again from the fetch. A write's answer is never put in the view, so the
// day is fetched again after each one, and a write leaves the phone only when a fetched day lists it. Any other tab
// waits for the lock, and its screens say "Wayfinder is open in another tab.".

// What a queue is made of.
export interface QueueParts<Day, Write, Shown> {
  // 'driver' or 'shop': it names the tab's lock and the phone's records.
  name: string;
  // The address of the day the loop fetches and of the writes it sends, under /api/v1.
  dayPath: string;
  writePath: string;
  // The query whose live messages, clock and demo messages and minute's refetch start the loop's fetch.
  key: readonly unknown[];
  // The shapes the day is fetched with and the records are read back with.
  shapes: Shapes<Day, Write, Shown>;
  // The view function in the contracts, phoneView or receiptView: its writes are the waiting ones the day does not list
  // as applied yet, which the screens apply and the loop still has to send.
  view: (day: Day, writes: Write[]) => { writes: Write[] };
  // The account the day was read for. A session that belongs to another account sends nothing, even one with the same
  // display name.
  accountOf: (day: Day) => string;
  // What the waiting count counts: one record per stop, and one each for a trip's start and its end.
  recordOf: (write: Write) => string;
  // The green "Back online" line, for a queue that shows it: the name a record's place is given once it reached the
  // depot, and whether saving a write closes the line.
  backOnline?: { placeOf: (entry: Queued<Write, Shown>) => string; closedBy: (write: Write) => boolean };
}

export interface SyncState {
  // A 401, or a session that belongs to another account: the writes wait until this account signs in again.
  signedOut: boolean;
  // A day has been fetched for this account since the app opened.
  fetched: boolean;
  // The server's sentence when it refused to send the day, for "Could not load".
  failure: string | null;
  // The places whose records reached the depot once the signal came back, for the green line, until it is closed.
  backOnline: string[] | null;
  // The phone could not keep a refusal the server gave: the write still waits and goes again on the retry schedule,
  // and the screens say "Could not save on this phone. Try again." until a refusal is kept.
  notSaved: boolean;
  // The waiting writes whose last send got no answer within 15 seconds: "The connection dropped while sending.", where
  // a write never tried with no signal is "There is no signal right now." (spec 015).
  unanswered: string[];
}

export type Owner = 'checking' | 'owner' | 'other';

type Outcome =
  | { kind: 'answer'; value: unknown }
  | { kind: 'cancelled' }
  | { kind: 'no-answer' }
  | { kind: 'retry'; message: string }
  | { kind: 'signed-out' }
  | { kind: 'refused'; code: string; message: string };

const UNREACHABLE = 'Could not reach Wayfinder. Check the connection and try again.';

// One request, given up after 15 seconds with no answer. It tells the signal what happened.
async function ask(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> }, cancel?: AbortSignal): Promise<Outcome> {
  const result = await within((limit) => api<unknown>(path, { ...init, signal: limit, cache: 'no-store' }), cancel);
  if ('value' in result) {
    answered();
    return { kind: 'answer', value: result.value };
  }
  const { error } = result;
  if (error instanceof ApiRequestError) {
    answered();
    // other_account: the session the send carried belongs to another account than the one that saved the write, such
    // as one signed in in another tab. It is not the server's word on the write, which waits for its account, as after
    // a 401.
    if (error.status === 401 || error.code === 'other_account') return { kind: 'signed-out' };
    // An answer with no readable sentence came from something in between, or was cut off while it was read: it is
    // not the server's word on the write, so the write goes again rather than being refused for it.
    if (error.status >= 500 || error.status === 429 || error.code === 'network') return { kind: 'retry', message: error.message };
    return { kind: 'refused', code: error.code, message: error.message };
  }
  if (result.cancelled) return { kind: 'cancelled' };
  noAnswer();
  return { kind: 'no-answer' };
}

export type PhoneQueue<Day extends { appliedWriteIds: string[] }, Write extends { writeId: string; at: string }, Shown> = ReturnType<typeof createPhoneQueue<Day, Write, Shown>>;

export function createPhoneQueue<Day extends { appliedWriteIds: string[] }, Write extends { writeId: string; at: string }, Shown>(parts: QueueParts<Day, Write, Shown>) {
  type Entry = Queued<Write, Shown>;
  const store = keptStore(parts.name, parts.shapes);
  const { readKept } = store;
  const lock = `wayfinder-${parts.name}`;

  // ── The account the loop works for ─────────────────────────────────────────────────────────────────────────────

  // The signed-in account, told apart by its id: two accounts may share a display name.
  let account: { id: string } | null = null;
  // Goes up when the account changes, so the answer to a request made for the account before is dropped.
  let generation = 0;

  let sync: SyncState = { signedOut: false, fetched: false, failure: null, backOnline: null, notSaved: false, unanswered: [] };
  const listeners = new Set<() => void>();
  function update(change: Partial<SyncState>) {
    sync = { ...sync, ...change };
    for (const listener of listeners) listener();
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
  function useSync() {
    return useSyncExternalStore(subscribe, () => sync);
  }
  // A send of this write got no answer, or got one.
  function markUnanswered(writeId: string, unanswered: boolean) {
    if (sync.unanswered.includes(writeId) === unanswered) return;
    update({ unanswered: unanswered ? [...sync.unanswered, writeId] : sync.unanswered.filter((id) => id !== writeId) });
  }

  // ── Records that waited with no signal, for the green line ─────────────────────────────────────────────────────

  // The records that waited while there was no signal, with the name the green line gives each once it is sent.
  const held = new Map<string, string>();

  // The waiting writes the kept day does not list as applied yet, oldest first: what the view applies and what the loop
  // still has to send.
  function waitingOf(): Entry[] {
    const { day, queue } = readKept();
    const waiting = queue.filter((entry) => entry.state === 'waiting');
    if (!day) return waiting;
    const left = new Set(parts.view(day, waiting.map((entry) => entry.write)).writes.map((write) => write.writeId));
    return waiting.filter((entry) => left.has(entry.write.writeId));
  }

  function hold() {
    const line = parts.backOnline;
    if (!line || hasSignal()) return;
    for (const entry of waitingOf()) held.set(parts.recordOf(entry.write), line.placeOf(entry));
  }

  // Once the signal is back and nothing waits, one green line names what reached the depot. A record the server
  // refused did not reach it.
  function settle() {
    if (!hasSignal() || held.size === 0 || waitingOf().length > 0) return;
    const refused = new Set(readKept().queue.filter((entry) => entry.state === 'refused').map((entry) => parts.recordOf(entry.write)));
    const names = [...held].filter(([record]) => !refused.has(record)).map(([, name]) => name);
    held.clear();
    if (names.length > 0) update({ backOnline: names });
  }

  const closeBackOnline = () => update({ backOnline: null });

  // ── The loop ───────────────────────────────────────────────────────────────────────────────────────────────────

  let rung = false;
  let waiter: (() => void) | null = null;
  // Asks the loop for a turn: fetch the day, keep it, send the oldest waiting write.
  function ring() {
    rung = true;
    const wake = waiter;
    waiter = null;
    wake?.();
  }
  async function nextTurn() {
    while (!rung) await new Promise<void>((resolve) => { waiter = resolve; });
    rung = false;
  }

  let retries = 0;
  let retryTimer = 0;
  let backingOff = false;
  // A fetch or a send with no answer, a 5xx or a 429: the loop starts again from the fetch on the retry schedule,
  // after 2, 4 and 8 seconds and then every 15, with the same write, id and body.
  function later() {
    window.clearTimeout(retryTimer);
    backingOff = true;
    retryTimer = window.setTimeout(() => {
      backingOff = false;
      ring();
    }, retryDelay(retries));
    retries += 1;
  }
  // The loop got through, so the next failure starts the schedule over.
  function through() {
    retries = 0;
    backingOff = false;
    window.clearTimeout(retryTimer);
  }
  // The signal back after it was lost sends what waits at once, unless the loop is waiting out a failure of its own: a
  // send that keeps failing while the server's health answers still backs off.
  function signalBack() {
    if (!backingOff) ring();
  }

  // The fetch running now, so a newer one can call it off and an older answer never lands after a newer one.
  let fetching: AbortController | null = null;

  async function fetchDay(who: { id: string }, turn: number): Promise<boolean> {
    const cancel = new AbortController();
    fetching = cancel;
    const outcome = await ask(parts.dayPath, {}, cancel.signal);
    if (fetching === cancel) fetching = null;
    if (turn !== generation) return false;
    // The failure's sentence is for a phone that has kept nothing yet, which says it could not load with it.
    switch (outcome.kind) {
      case 'answer': break;
      case 'cancelled': return false;
      case 'no-answer': later(); update({ failure: UNREACHABLE }); return false;
      case 'retry': later(); update({ failure: outcome.message }); return false;
      case 'signed-out': update({ signedOut: true }); return false;
      case 'refused': update({ failure: outcome.message }); return false;
    }
    const day = parts.shapes.Day.safeParse(outcome.value);
    if (!day.success) {
      console.warn(`The ${parts.name} queue's day did not fit its shape.`, day.error.issues);
      later();
      update({ failure: 'Wayfinder sent something this phone could not read. It tries again by itself.' });
      return false;
    }
    // The browser's session belongs to another account now, such as after it signed in in another tab, even one with
    // the same name. That account's day is not this one's, and this account's writes must not go out under it.
    if (parts.accountOf(day.data) !== who.id) {
      update({ signedOut: true });
      return false;
    }
    await store.keepDay(who.id, day.data);
    if (turn !== generation) return false;
    // A day fetched under this account's own session: whatever asked it to sign in again is behind it.
    update({ fetched: true, failure: null, signedOut: false });
    return true;
  }

  // Whether the browser's session still belongs to the account that owns the write, asked of the day itself: its
  // account against the write's owner and the account the phone has open.
  async function stillOwn(owner: string): Promise<'own' | 'other' | 'unknown'> {
    const outcome = await ask(parts.dayPath, {});
    if (outcome.kind === 'signed-out') return 'other';
    if (outcome.kind !== 'answer') return 'unknown';
    const day = parts.shapes.Day.safeParse(outcome.value);
    if (!day.success) return 'unknown';
    return parts.accountOf(day.data) === owner && readKept().userId === owner ? 'own' : 'other';
  }

  async function sendWrite(entry: Entry, turn: number) {
    // The write names the account that saved it, and the server takes it only under that account's session, so a
    // session changed between the fetch and the send never applies it as another account's.
    const outcome = await ask(parts.writePath, { method: 'POST', json: entry.write, headers: { [PHONE_ACCOUNT_HEADER]: entry.userId } });
    if (turn !== generation) return;
    markUnanswered(entry.write.writeId, outcome.kind === 'no-answer');
    switch (outcome.kind) {
      // The answer is the day, but it is never shown: the loop fetches the day again at once (D-50).
      case 'answer': through(); ring(); return;
      // A refused write is never sent again, and the writes after it carry on. A refusal counts only when the session
      // still belongs to the write's owner: one that changed under the send, such as another account signed in in
      // another tab, must not cost the write, which waits until its account is signed in again.
      case 'refused': {
        const session = await stillOwn(entry.userId);
        if (turn !== generation) return;
        if (session === 'other') { update({ signedOut: true }); return; }
        if (session === 'unknown') { later(); return; }
        try {
          await store.refuseWrite(entry, { code: outcome.code, message: outcome.message });
        } catch (error) {
          // Still waiting on the phone: it goes again on the retry schedule and is refused again, until the phone can
          // keep the refusal.
          console.warn('Could not keep the refusal on this phone.', error);
          update({ notSaved: true });
          later();
          return;
        }
        through();
        update({ notSaved: false });
        ring();
        return;
      }
      case 'signed-out': update({ signedOut: true }); return;
      // No answer, a 5xx or a 429: the same write, id and body go again on the retry schedule. With no answer the
      // signal is gone too, and the probe asks for it meanwhile.
      case 'retry': case 'no-answer': later(); return;
      case 'cancelled': return;
    }
  }

  // A turn runs even while the account is asked to sign in again: its fetch is how the phone learns it has, in this tab
  // or another, and nothing is sent until a fetch shows the session is its own. Nothing is fetched or sent before the
  // phone has read what it kept for the account; a read that failed is tried again on the retry schedule.
  async function turn() {
    const who = account;
    const now = generation;
    if (!who) return;
    if (!(await store.readFirst(who.id))) {
      const kept = readKept();
      if (now === generation && kept.userId === who.id && kept.failed) later();
      return;
    }
    if (now !== generation || !hasSignal()) return;
    if (!(await fetchDay(who, now))) return;
    // The account may have changed while the day was kept; its writes are not this turn's to send.
    if (now !== generation) return;
    const [next] = waitingOf();
    if (!next) {
      through();
      settle();
      return;
    }
    if (next.userId !== who.id) return;
    await sendWrite(next, now);
  }

  // The whole loop, run inside the lock for the tab's life. It never returns, so the lock is never let go.
  async function run(): Promise<never> {
    for (;;) {
      await nextTurn();
      try {
        await turn();
      } catch (error) {
        console.error(`The ${parts.name} queue's sync loop hit an error. It tries again on the retry schedule.`, error);
        later();
      }
    }
  }

  // ── One tab owns the queue ───────────────────────────────────────────────────────────────────────────────────────

  let owner: Owner = 'checking';
  let claimed = false;
  const ownerListeners = new Set<() => void>();
  function setOwner(next: Owner) {
    owner = next;
    for (const listener of ownerListeners) listener();
  }

  async function own(): Promise<never> {
    setOwner('owner');
    whenBack(signalBack);
    whenLost(hold);
    startSignal();
    return run();
  }

  // Asks for the lock once per tab, when the queue's area first opens. With the lock free this tab takes it and holds
  // it until it closes; with another tab holding it, this one says so and waits for its turn. A browser without Web
  // Locks runs as the owner, and the server's write ids still keep a write from counting twice.
  function claim() {
    if (claimed) return;
    claimed = true;
    if (!('locks' in navigator)) {
      void own();
      return;
    }
    void navigator.locks.request(lock, { ifAvailable: true }, async (held) => {
      if (held) return own();
      setOwner('other');
      void navigator.locks.request(lock, own);
    });
  }

  function useOwner(): Owner {
    claim();
    return useSyncExternalStore((listener) => {
      ownerListeners.add(listener);
      return () => { ownerListeners.delete(listener); };
    }, () => owner);
  }

  // ── What the screens call ──────────────────────────────────────────────────────────────────────────────────────

  // The signed-in account, from the queue's area. A new account starts over from what the phone kept for it.
  function setAccount(me: { id: string }) {
    const same = account?.id === me.id;
    account = { id: me.id };
    if (!same) {
      generation += 1;
      fetching?.abort();
      held.clear();
      update({ signedOut: false, fetched: false, failure: null, backOnline: null, notSaved: false, unanswered: [] });
      void store.openAccount(me.id).then(() => {
        hold();
        ring();
      });
      return;
    }
    // The same account signed in again after a 401: the writes go now.
    update({ signedOut: false });
    ring();
  }

  // "Try again" on "Could not read what this phone kept.": read again, and once read carry on as when the app opened.
  // It resolves whether the phone could read.
  async function readAgain() {
    const who = account;
    if (!who) return false;
    if (!(await store.readFirst(who.id))) return false;
    hold();
    through();
    ring();
    return true;
  }

  // The live stream's message for the queue's key, a clock or demo message and the minute's refetch start the loop's
  // fetch. A new fetch calls off one still running.
  function fetchNow() {
    fetching?.abort();
    ring();
  }

  // "Retry sync": ask for the signal at once, and with one, fetch and send now.
  function retrySync() {
    through();
    probeNow();
    ring();
  }

  // Saves one action on the phone before the screen moves on, with the copy its screen draws it from. It resolves once
  // the write is in the phone's database, and throws when it could not be saved, so nothing is sent. The phone first
  // reads what it kept for the account if it could not before, so a new action never goes ahead of a write kept earlier.
  async function saveAction(write: Write, about: string, shown: Shown) {
    const who = account;
    if (!who) throw new Error('No signed-in account to save for.');
    if (!(await store.readFirst(who.id))) throw new Error('The phone could not read what it kept, so the action was not saved.');
    // Kept as the contracts' shape reads it, the exact request the server will parse.
    const request = parts.shapes.Write.parse(write);
    await store.addWrite(who.id, request, about, request.at, parts.shapes.Shown.parse(shown));
    if (parts.backOnline?.closedBy(request)) update({ backOnline: null });
    hold();
    ring();
  }

  // A button's save: one at a time, so a second tap before the screen redraws never makes a second write, and
  // "Could not save on this phone. Try again." when the phone could not keep it.
  function useSave() {
    const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
    const busy = useRef(false);
    const save = async (write: Write, about: string, shown: Shown) => {
      if (busy.current) return false;
      busy.current = true;
      setState('saving');
      try {
        await saveAction(write, about, shown);
        setState('idle');
        return true;
      } catch (error) {
        console.warn('Could not save the action on this phone.', error);
        setState('failed');
        return false;
      } finally {
        busy.current = false;
      }
    };
    return { save, saving: state === 'saving', failed: state === 'failed' };
  }

  // "Clear": takes the account's refused records off the phone, or only those named.
  async function clearRefused(only?: readonly number[]) {
    const who = account;
    if (!who) return;
    await store.clearRefused(who.id, only);
  }

  // The query under the queue's key, in the owning tab only. It holds no data of its own: the live stream's message for
  // the key, the clock and demo messages (spec 008) and the minute's refetch reach the loop through it.
  let rings = 0;
  function useQueueQuery() {
    useQuery({
      queryKey: parts.key,
      queryFn: () => {
        fetchNow();
        rings += 1;
        return rings;
      },
      networkMode: 'always',
      retry: false,
      staleTime: 0,
    });
  }

  return {
    name: parts.name, lock, key: parts.key, recordOf: parts.recordOf,
    readKept, useKept: store.useKept, useSync, useOwner, waitingOf,
    setAccount, readAgain, fetchNow, retrySync, saveAction, useSave, clearRefused, closeBackOnline, useQueueQuery,
  };
}
