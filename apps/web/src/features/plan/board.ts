import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AcceptDecisionsRequest, DraftPlan, JoinOrderRequest, Me, PlanBoard, PlanRef, SavePlanRequest, SlotSearch, SplitOrderRequest, SuggestPlanRequest,
} from '@wayfinder/contracts';
import { meKey, workingFor } from '@/features/auth/api';
import { reasonOf } from '@/features/store/words';
import { api, ApiRequestError } from '@/lib/api';
import { planOf, sameDraft } from './draft';
import { clockTime, droppedLine, shortDay } from './words';

// The plan board's reads and writes (spec 010, plan.md "The screen"). Every key starts with the topic 'plans',
// so the live stream's plans message refetches them (spec 008).
export const plansKey = ['plans'] as const;
export const boardKey = ['plans', 'board'] as const;
export const dayKey = (date: string) => ['plans', date] as const;
export const slotsKey = (date: string, orderId: string) => ['plans', date, 'slots', orderId] as const;

// The write that is running. Writes go one after the other, and a read waits for the one on its way, so an
// older answer never lands on top of a newer one.
let writing: Promise<unknown> = Promise.resolve();
// The writes queued or sent and not answered yet, from the board's queue and View plan alike. A dispatcher's depot
// switch waits for none of them (spec 020).
let unanswered = 0;

// Who a write is made for: the depot it names when its turn comes, so the server refuses it should the session have
// moved since (D-95), and whether its maker still wants it sent then. A board's queue makes its own writes, and View
// plan its writes outside the queue. A maker is set only while its write is queued, which happens at once.
interface Maker { depot: string | null; stillWanted: () => boolean }
let making: Maker | null = null;
function madeBy<T>(maker: Maker, queue: () => Promise<T>): Promise<T> {
  making = maker;
  try {
    return queue();
  } finally {
    making = null;
  }
}

function write<T>(request: (depot: string | null | undefined) => Promise<T>): Promise<T> {
  const maker = making;
  unanswered += 1;
  const run = writing.then(() => {
    // Right before it goes: a write whose maker was retired, or no longer works for the account and depot it was made
    // for, is dropped. It names the depot it was made for, whatever the tab names by then.
    if (maker && !maker.stillWanted()) throw new Error('A plan change was dropped: its board is no longer on show.');
    return request(maker?.depot);
  }).finally(() => { unanswered -= 1; });
  // The chain itself never rejects, or one refused write would fail every write after it.
  writing = run.catch(() => undefined);
  return run;
}

// The board's day (rule 1), and any day's board by its date.
export const fetchBoard = async () => {
  await writing;
  return api<PlanBoard>('/plans');
};
export const fetchDay = async (date: string) => {
  await writing;
  return api<PlanBoard>(`/plans/${date}`);
};
export const fetchSlots = async (date: string, orderId: string) => {
  await writing;
  return api<SlotSearch>(`/plans/${date}/slots?orderId=${encodeURIComponent(orderId)}`);
};

// Every write answers with the whole board, as the GET does.
export const saveDraft = (date: string, body: SavePlanRequest) => write((depot) => api<PlanBoard>(`/plans/${date}/draft`, { method: 'PUT', json: body, depot }));
export const splitOrder = (date: string, body: SplitOrderRequest) => write((depot) => api<PlanBoard>(`/plans/${date}/split`, { method: 'POST', json: body, depot }));
export const joinOrder = (date: string, body: JoinOrderRequest) => write((depot) => api<PlanBoard>(`/plans/${date}/join`, { method: 'POST', json: body, depot }));
export const sendPlan = (date: string, body: PlanRef) => write((depot) => api<PlanBoard>(`/plans/${date}/send`, { method: 'POST', json: body, depot }));
export const unsendPlan = (date: string, body: PlanRef) => write((depot) => api<PlanBoard>(`/plans/${date}/unsend`, { method: 'POST', json: body, depot }));
// The suggested plan (spec 014): building it, which replaces the whole draft, and accepting the planner's decisions.
export const suggestPlan = (date: string, body: SuggestPlanRequest) => write((depot) => api<PlanBoard>(`/plans/${date}/suggest`, { method: 'POST', json: body, depot }));
export const acceptDecisions = (date: string, body: AcceptDecisionsRequest) => write((depot) => api<PlanBoard>(`/plans/${date}/decisions`, { method: 'POST', json: body, depot }));

// A write names the plan by its id and revision, or before the first save by the demo day the board was read
// under, so a request from before a reset never lands on the new day (rule 3).
export const refOf = (board: PlanBoard): PlanRef =>
  (board.plan.id === null ? { planId: null, demoDay: board.demoDay } : { planId: board.plan.id, revision: board.plan.revision });

// The board can be changed: a day whose orders are closed and whose plan is not sent.
export const editable = (board: PlanBoard) => board.day !== null && board.day.open && board.plan.status === 'draft';

export function useBoard() {
  return useQuery({ queryKey: boardKey, queryFn: fetchBoard });
}

export function useDayBoard(date: string) {
  return useQuery({ queryKey: dayKey(date), queryFn: () => fetchDay(date) });
}

// A slot search is worked out on the saved draft, so it is asked for only once the draft is saved.
export function useSlots(date: string, orderId: string, saved: boolean) {
  return useQuery({ queryKey: slotsKey(date, orderId), queryFn: () => fetchSlots(date, orderId), enabled: saved, refetchInterval: false });
}

// lib/live.ts refetches the queries of a message's topic, and the board's are under 'plans'. The depot's orders
// messages change the day's orders too, so this query under 'orders' passes them on to the board. It holds
// nothing and runs only when such a message marks it out of date.
export function useOrdersFollow() {
  const qc = useQueryClient();
  useQuery({
    queryKey: ['orders', 'plans'],
    queryFn: async () => {
      await qc.invalidateQueries({ queryKey: plansKey });
      return null;
    },
    initialData: null,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}

// ── The save queue ───────────────────────────────────────────────────────────────────────────────────────────

// 'saved': the server holds what the board shows. 'saving': a change is on its way. 'retrying': the last try did
// not reach the server and another follows. 'refused': the server said no, and the changes wait for Try again.
export type Saving = 'saved' | 'saving' | 'retrying' | 'refused';

// The draft from before the last stop move, which "Undo" puts back while nothing else has changed, with the line
// the moved trip shows.
export interface Undo { before: DraftPlan; line: string; tripKey: string }

export interface BoardScreen {
  // The board as the server last answered: its check, figures and counts belong to it.
  board: PlanBoard;
  // The plan on screen, with the changes on their way.
  draft: DraftPlan;
  saving: Saving;
  // Why the server refused, in its own words.
  refused: string | null;
  // A split, join, send, back to edit, build or accept is on its way, and the board holds still until it answers.
  acting: boolean;
  undo: (Undo & { seq: number; revision: number | null }) | null;
}

// Refusals that say the plan moved on without this screen. The screen loads the board again and says why.
const RELOAD = new Set(['stale', 'plan_sent', 'day_moved', 'orders_open', 'no_plan_day']);
// Spec 008's line after a reset. lib/live.ts shows the same one under the same id, so only one shows.
const RESET_LINE = 'The demo day was reset. It is Wednesday 15:00 again.';

const codeOf = (error: unknown) => (error instanceof ApiRequestError ? error.code : null);

// The signal dropped, the server is down or it asked us to slow down: trying again can work.
const worthRetrying = (error: unknown) =>
  !(error instanceof ApiRequestError) || error.code === 'network' || error.status >= 500 || error.status === 429;

const tell = (line: string, id = 'plan-board') => toast(line, { id, duration: 6000, classNames: { title: 'text-pretty' } });

// A write's answer counts when it is for the plan on screen and newer, or, for the first save, when the screen
// held no plan and the answer brings the new plan's id.
function counts(held: PlanBoard, answer: PlanBoard) {
  if (answer.demoDay !== held.demoDay || answer.day?.date !== held.day?.date) return false;
  return held.plan.id === null ? answer.plan.id !== null : answer.plan.id === held.plan.id && answer.plan.revision > held.plan.revision;
}

// The line for a refusal that loaded the board again (spec 010, failure paths).
function refusedLine(code: string, error: unknown, before: PlanBoard, latest: PlanBoard) {
  if (latest.demoDay !== before.demoDay) return RESET_LINE;
  if (code === 'stale') return 'The plan was changed in another tab, so it was loaded again.';
  if (code === 'plan_sent' && latest.plan.sentAt) return `This plan was sent at ${clockTime(latest.plan.sentAt)}.`;
  if (code === 'day_moved' && before.day) return `Trucks for ${shortDay(before.day.date)} leave from 03:30, so its plan can no longer be sent.`;
  return reasonOf(error);
}

// The draft's saving (D-29): every change saves the whole draft. One save is on its way at a time, and a change
// made meanwhile rides the next one. Only a request that did not reach the server is tried again. It lives
// outside React, like the shop form's (features/store/draft-form.ts), because a save outlives the screen that
// made it: the board and View plan share it.
class PlanSaver {
  readonly owner: string | null;
  // Stopped for good by a depot switch or a sign-out (D-95).
  retired = false;
  private qc: QueryClient;
  private screen: BoardScreen | null = null;
  private listeners = new Set<() => void>();
  // Every change raises seq. A save carries the seq it was sent with, and the board is saved when they meet.
  private seq = 0;
  private sentSeq = 0;
  private savedSeq = 0;
  private running = false;
  private acting = false;
  private retryTimer = 0;
  private tries = 0;
  // Every save sent since the last answer that got none. The server may have taken any of them.
  private unanswered: DraftPlan[] = [];
  private waiters: ((saved: boolean) => void)[] = [];
  private droppedShown = '';

  // The depot the queue's board is for, which every write it makes names.
  readonly depot: string | null;

  constructor(qc: QueryClient, owner: string | null, depot: string | null) {
    this.qc = qc;
    this.owner = owner;
    this.depot = depot;
  }

  // A write this queue made may still go when its turn comes: the queue is not retired and the screen still works for
  // its account and depot.
  stillWanted = () => this.stillMine();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  snapshot = () => this.screen;

  get date() {
    return this.screen?.board.day?.date ?? null;
  }

  // An answer can arrive after its person signed out and someone else signed in on this browser, or after the
  // dispatcher switched depots (spec 020). Either way it is for a board no longer on show. A queue a switch retired stays
  // retired, even once the dispatcher switches back to the depot it was for.
  private stillMine() {
    return !this.retired && this.owner !== null && workingFor(this.qc) === this.owner;
  }

  private show(patch: Partial<BoardScreen>) {
    if (!this.screen) return;
    this.screen = { ...this.screen, ...patch };
    for (const listener of this.listeners) listener();
  }

  private pending() {
    return this.running || this.acting || this.seq !== this.savedSeq;
  }

  // A change is on its way to the server: a save, or a split, join, send, build or accept that has not answered.
  // Changes the server turned down wait for Try again, so they are not on their way.
  onItsWay() {
    return this.pending() && this.screen?.saving !== 'refused';
  }

  // Changes on the board the server has not said it saved: waiting, on their way, trying again, or turned down.
  unsaved() {
    return this.seq !== this.savedSeq;
  }

  // A save is out, or one got no answer: the server may have kept what it carried.
  unsure() {
    return this.running || this.unanswered.length > 0;
  }

  // Shows a board: its numbers always, and its draft too when nothing on screen is waiting to be saved. An
  // "Undo" lasts only while the plan's revision is the one its move's save made.
  private take(board: PlanBoard, withDraft: boolean) {
    const held = this.screen;
    const undo = held?.undo && held.undo.revision !== null && held.undo.revision !== board.plan.revision ? null : held?.undo ?? null;
    this.screen = {
      board,
      draft: withDraft || !held ? planOf(board) : held.draft,
      saving: held?.saving ?? 'saved',
      refused: held?.refused ?? null,
      acting: this.acting,
      undo,
    };
    for (const listener of this.listeners) listener();
    const dropped = board.dropped.join(',');
    if (board.day && board.dropped.length > 0 && dropped !== this.droppedShown) tell(droppedLine(board.dropped.length, board.day.date));
    this.droppedShown = dropped;
  }

  // A write's answer goes on screen and into the cache, where the board and View plan read it.
  private answered(board: PlanBoard, withDraft: boolean) {
    this.take(board, withDraft);
    if (!board.day) return;
    this.qc.setQueryData(dayKey(board.day.date), board);
    const held = this.qc.getQueryData<PlanBoard>(boardKey);
    if (!held || held.day?.date === board.day.date) this.qc.setQueryData(boardKey, board);
  }

  private settle(saved: boolean) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter(saved);
  }

  // Drops the changes on their way: the board on screen is another plan, day or demo day now. An "Undo" of the plan
  // that is gone goes with them.
  private forget() {
    window.clearTimeout(this.retryTimer);
    this.unanswered = [];
    this.savedSeq = this.sentSeq = this.seq;
    this.show({ undo: null });
    this.settle(false);
  }

  // The answer of a read. While a change waits, the save's own answer decides, unless the read shows another
  // plan, day or demo day: that is a reset or a new day, which drops the changes and any answer on its way.
  incoming = (board: PlanBoard) => {
    const held = this.screen;
    if (held?.board === board) return;
    if (!held) {
      this.take(board, true);
      return;
    }
    const moved = board.demoDay !== held.board.demoDay || board.day?.date !== held.board.day?.date
      || (held.board.plan.id !== null && board.plan.id !== held.board.plan.id);
    if (!moved && (this.pending() || board.plan.revision < held.board.plan.revision)) return;
    if (moved) this.forget();
    this.take(board, true);
    this.show({ saving: 'saved', refused: null });
  };

  // A change on the board. It shows at once and is saved behind any save on its way. While a split, join or send
  // is out the board holds still, and says so.
  change = (next: DraftPlan, undo?: Undo) => {
    const held = this.screen;
    if (!held || !editable(held.board)) return;
    if (this.acting) {
      tell('One moment: the board is still saving.');
      return;
    }
    this.seq += 1;
    window.clearTimeout(this.retryTimer);
    this.show({ draft: next, saving: 'saving', refused: null, undo: undo ? { ...undo, seq: this.seq, revision: null } : null });
    void this.flush();
  };

  // Try again after a refusal: the same changes, sent again.
  retry = () => {
    if (!this.screen) return;
    this.show({ saving: 'saving', refused: null });
    void this.flush();
  };

  private cancelReads(date: string) {
    return Promise.all([
      this.qc.cancelQueries({ queryKey: boardKey, exact: true }),
      this.qc.cancelQueries({ queryKey: dayKey(date), exact: true }),
    ]);
  }

  private flush = async () => {
    window.clearTimeout(this.retryTimer);
    const held = this.screen;
    if (!held || this.running || this.acting) return;
    if (this.seq === this.savedSeq) {
      // Nothing waits, so the board is saved, whatever the line said while something did.
      if (held.saving === 'saving' || held.saving === 'retrying') this.show({ saving: 'saved' });
      this.settle(true);
      return;
    }
    const date = held.board.day?.date;
    if (!date) return;
    this.running = true;
    this.sentSeq = this.seq;
    const sent = held.draft;
    const before = held.board;
    this.show({ saving: 'saving' });
    try {
      // A read that started before this save would answer with the draft as it was.
      await this.cancelReads(date);
      // A queue for an account or depot no longer on show sends nothing (spec 020): the session may now work on the
      // other depot, or nobody is signed in. Its changes are dropped, and whatever waited for them goes on without them.
      if (!this.stillMine()) {
        this.running = false;
        this.dropAll();
        return;
      }
      const answer = await madeBy(this, () => saveDraft(date, { ...refOf(before), plan: sent }));
      this.running = false;
      if (!this.stillMine()) return;
      this.tries = 0;
      this.unanswered = [];
      const now = this.screen!;
      if (!counts(now.board, answer)) {
        // The board moved on while this save was out (a reset, a new day), so its answer is for a plan that is
        // gone and the changes went with it. An answer that is simply not newer is read as the plan having moved
        // on elsewhere.
        if (now.board.demoDay === before.demoDay && now.board.day?.date === before.day?.date) await this.reloadHeld('stale', null, before);
        else void this.flush();
        return;
      }
      this.savedSeq = this.sentSeq;
      const done = this.seq === this.savedSeq;
      if (now.undo && now.undo.seq === this.sentSeq) this.show({ undo: { ...now.undo, revision: answer.plan.revision } });
      this.answered(answer, done);
      if (done) {
        this.show({ saving: 'saved' });
        this.settle(true);
      } else {
        void this.flush();
      }
    } catch (error) {
      this.running = false;
      if (!this.stillMine()) return;
      // The changes this save carried were dropped while it was out (a reset, a new day): nothing is left to send.
      if (this.seq === this.savedSeq) {
        void this.flush();
        return;
      }
      if (worthRetrying(error)) {
        this.unanswered.push(sent);
        this.show({ saving: 'retrying' });
        // 2, 4 and 8 seconds, then every 15.
        this.retryTimer = window.setTimeout(this.flush, Math.min(2000 * 2 ** this.tries, 15_000));
        this.tries += 1;
        return;
      }
      this.tries = 0;
      const code = codeOf(error);
      if (code !== null && RELOAD.has(code)) {
        await this.reloadHeld(code, error, before);
      } else {
        this.show({ saving: 'refused', refused: reasonOf(error) });
        this.settle(false);
      }
    }
  };

  // Loads the board again with the queue held, so a change made meanwhile waits for the read instead of cancelling
  // it, and goes out after it when the plan is still this screen's.
  private async reloadHeld(code: string, error: unknown, before: PlanBoard) {
    this.running = true;
    let failed: unknown = null;
    try {
      failed = await this.reload(code, error, before);
    } finally {
      this.running = false;
    }
    if (failed === null) {
      void this.flush();
    } else {
      this.show({ saving: 'refused', refused: reasonOf(failed) });
      this.settle(false);
    }
  }

  // A refusal that trying again cannot fix: load the board again. When the server's draft is one this screen sent
  // without hearing back, the change was this screen's own, so it carries on from there with what is still
  // waiting. Otherwise the changes are dropped and one line says why. It answers the error when the board could
  // not be read, or null.
  private async reload(code: string, error: unknown, before: PlanBoard): Promise<unknown> {
    let latest: PlanBoard;
    try {
      latest = await this.qc.fetchQuery({ queryKey: boardKey, queryFn: fetchBoard, staleTime: 0 });
    } catch (loadError) {
      return loadError;
    }
    if (!this.stillMine()) return null;
    const held = planOf(latest);
    const samePlan = latest.demoDay === before.demoDay && latest.day?.date === before.day?.date && latest.plan.status === 'draft';
    if (code === 'stale' && samePlan && this.unanswered.some((sent) => sameDraft(sent, held))) {
      this.unanswered = [];
      this.answered(latest, false);
      if (sameDraft(held, this.screen!.draft)) this.savedSeq = this.sentSeq = this.seq;
      return null;
    }
    this.forget();
    this.answered(latest, true);
    this.show({ saving: 'saved', refused: null, undo: null });
    const reset = latest.demoDay !== before.demoDay;
    tell(refusedLine(code, error, before, latest), reset ? 'demo-clock' : 'plan-board');
    return null;
  }

  // Resolves once nothing is waiting to be saved: true when saved, false when a save was refused.
  idle = (): Promise<boolean> => {
    if (!this.pending()) return Promise.resolve(true);
    if (this.screen?.saving === 'refused') return Promise.resolve(false);
    return new Promise((resolve) => this.waiters.push(resolve));
  };

  // A split, join, send or back to edit (rule 8, rule 11), and spec 014's build and accept. Each waits until the draft
  // is saved and any other of them has answered, and the board holds still until this one answers. It says why when
  // it was refused, or null. done gets the board it answered once the board has taken it, and only then: a build that
  // went through opens View plan from there (spec 023).
  act = async (run: (date: string, ref: PlanRef) => Promise<PlanBoard>, done?: (board: PlanBoard) => void): Promise<string | null> => {
    // A queue for an account or depot no longer on show sends nothing (spec 020), here and below before the send.
    if (!this.stillMine()) {
      this.dropAll();
      return null;
    }
    do {
      if (!(await this.idle())) return 'The plan has changes that are not saved yet. Save them first.';
    } while (this.acting || this.running);
    const held = this.screen;
    const date = held?.board.day?.date;
    if (!held || !date) return null;
    const before = held.board;
    this.acting = true;
    this.show({ acting: true });
    try {
      await this.cancelReads(date);
      if (!this.stillMine()) {
        this.dropAll();
        return null;
      }
      const answer = await madeBy(this, () => run(date, refOf(before)));
      if (!this.stillMine()) return null;
      this.answered(answer, true);
      this.show({ saving: 'saved', refused: null, undo: null });
      done?.(answer);
      return null;
    } catch (error) {
      if (!this.stillMine()) return null;
      const code = codeOf(error);
      if (code !== null && RELOAD.has(code)) {
        // The board holds still through the read too, so no change lands on the plan as it was.
        const failed = await this.reload(code, error, before);
        return failed === null ? null : reasonOf(failed);
      }
      return reasonOf(error);
    } finally {
      this.acting = false;
      this.show({ acting: false });
      // Whatever waited for this to answer goes on.
      void this.flush();
    }
  };

  // A board a read outside the board page brought, such as View plan's. It is taken as a refetch would be.
  sync = (board: PlanBoard) => {
    if (this.screen && board.day?.date === this.date) this.incoming(board);
  };

  // A queue that finds itself no longer the screen's (a sign-out, another account, another depot) drops its changes
  // rather than stay at "saving" with nothing to come, and stops for good, so it holds no depot switch (D-95).
  private dropAll() {
    this.unanswered = [];
    this.savedSeq = this.sentSeq = this.seq;
    if (this.screen) this.screen = { ...this.screen, saving: 'saved', refused: null, undo: null };
    this.stop();
  }

  // The queue's end, for good: no retry is left to fire, it sends nothing more and takes no answer, and whatever waited
  // for its changes goes on without them.
  stop() {
    this.retired = true;
    window.clearTimeout(this.retryTimer);
    this.listeners.clear();
    this.settle(false);
  }
}

export type Saver = PlanSaver;

const savers = new WeakMap<QueryClient, PlanSaver>();

// One queue per signed-in person and depot (spec 020). Someone else signing in on this browser, or a dispatcher
// switching depots, gets a new one, so nothing held for the board before is drawn again.
function saverOf(qc: QueryClient) {
  const owner = workingFor(qc);
  let saver = savers.get(qc);
  if (!saver || saver.owner !== owner || saver.retired) {
    saver?.stop();
    saver = new PlanSaver(qc, owner, qc.getQueryData<Me | null>(meKey)?.depotId ?? null);
    savers.set(qc, saver);
  }
  return saver;
}

export function usePlanSaver() {
  return saverOf(useQueryClient());
}

// A depot switch retires the board's queue whatever page is on show (spec 020): no save waiting to try again, and no
// change held for the depot before, is sent once the session works on the other depot. It says whether the queue held
// changes the server had not saved, so a switch made in another tab can say they were dropped, or 'unsure' when a save
// was sent and never answered, which the server may have kept.
export function retireBoard(qc: QueryClient): 'dropped' | 'unsure' | null {
  const saver = savers.get(qc);
  savers.delete(qc);
  if (!saver) return null;
  const unsaved = saver.unsaved() ? (saver.unsure() ? 'unsure' : 'dropped') : null;
  saver.stop();
  return unsaved;
}

// A plan change is still on its way to the server: a write queued or sent, from the board or View plan, or a change on
// the board on show waiting to be saved. A dispatcher's depot switch is refused until it lands (spec 020), so no
// change is dropped without a word and no answer lands after the switch.
export function planWriteOnItsWay(qc: QueryClient) {
  const saver = savers.get(qc);
  return unanswered > 0 || (saver !== undefined && !saver.retired && saver.owner === workingFor(qc) && saver.onItsWay());
}

// View plan's send, back to edit or accept for a day the board's queue does not hold, such as after a reload: it names
// the plan on screen, and its answer replaces the day's read only while the screen still works for the account and
// depot it went out for. It answers null otherwise, and throws what the server refused.
export async function writeOutsideBoard(qc: QueryClient, date: string, board: PlanBoard, call: (day: string, ref: PlanRef) => Promise<PlanBoard>) {
  const sentFor = workingFor(qc);
  const depot = qc.getQueryData<Me | null>(meKey)?.depotId ?? null;
  // A read of this day already on its way would land after the answer and bring back the plan before it.
  await qc.cancelQueries({ queryKey: dayKey(date) });
  const answer = await madeBy({ depot, stillWanted: () => workingFor(qc) === sentFor }, () => call(date, refOf(board)));
  if (workingFor(qc) !== sentFor) return null;
  qc.setQueryData(dayKey(date), answer);
  return answer;
}

// The board on screen: the last answer's numbers with the draft as the dispatcher left it.
export function useBoardScreen(board: PlanBoard | undefined) {
  const saver = usePlanSaver();
  useEffect(() => {
    if (board) saver.incoming(board);
  }, [saver, board]);
  const screen = useSyncExternalStore(saver.subscribe, saver.snapshot);
  // The first drawing with a board comes before the effect above has handed it over.
  const shown: BoardScreen | null = screen ?? (board ? { board, draft: planOf(board), saving: 'saved', refused: null, acting: false, undo: null } : null);
  return { saver, screen: shown };
}
