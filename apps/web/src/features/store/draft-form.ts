import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { CutoffPassedDetails, MAX_LINE_UNITS, StoreOrder, type DraftRefs, type Me, type SaveDraftRequest, type StoreNextOrder, type StoreProduct } from '@wayfinder/contracts';
import { finishBeforeSignOut, meKey } from '@/features/auth/api';
import { ApiRequestError } from '@/lib/api';
import { fetchNextOrder, nextOrderKey, placeOrders, saveDraft } from './next-order';
import { NOT_KEPT, reasonOf } from './words';

// A change is saved this long after it was made, so a run of taps is one save.
const SAVE_AFTER_MS = 600;

// A change that could not be saved is said, also once the form has left the screen or its person has signed out, so
// it is never lost without a word (Q-04). The line outlasts the move to the sign-in page.
const notKept = () => toast(NOT_KEPT, { id: 'draft-not-kept', duration: 10_000, classNames: { title: 'text-pretty' } });

// The next order while a delivery day is open. The form only exists then.
export type OpenOrder = StoreNextOrder & { deliveryDate: string };

// What the form hands the confirmation it opens: the orders its place answered with. A retry that got its
// answer after the cut-off has them for a day that has closed, which the next order no longer lists.
export const PlacedNow = z.object({ placedOrders: z.array(StoreOrder).min(1) });
export type PlacedNow = z.infer<typeof PlacedNow>;

// What the manager has on the form: a quantity per item and the note.
export interface FormValues { quantities: Record<string, number>; note: string }

// What a quantity box's text stands for: a whole number from 0 to 999 written in digits, with an empty box as 0, or
// null for anything else, such as a minus, a fraction or more than 999. Nothing is rounded, cut or turned round, so
// a typed -5 never becomes 5 (Q-01, Q-02).
export function wholeQuantity(text: string): number | null {
  const digits = text.trim();
  if (digits === '') return 0;
  if (!/^[0-9]+$/.test(digits)) return null;
  const quantity = Number(digits);
  return quantity <= MAX_LINE_UNITS ? quantity : null;
}

// 'saved': the server holds what the form shows. 'saving': a change is waiting or on its way. 'retrying': the
// last try failed and another follows. 'refused': the server said no and the latest could not be loaded. 'held': a
// quantity box holds something that is not a whole number from 0 to 999, so nothing is saved until it is fixed.
export type Saving = 'saved' | 'saving' | 'retrying' | 'refused' | 'held';

export interface Screen {
  values: FormValues;
  // What a quantity box shows while it is not the number the form holds: the text being typed, and anything typed
  // that is not a whole number from 0 to 999, which stays as it was typed (Q-01).
  typed: Record<string, string>;
  saving: Saving;
  placing: boolean;
  // The draft was changed somewhere else and the form now shows the latest.
  changedElsewhere: boolean;
  // The day the form was showing when its cut-off passed.
  closedDay: string | null;
  // Why the server refused, shown in red above the button.
  refused: string | null;
}

// What a request has to name: the day the form is showing and the drafts it last saw.
interface Base { deliveryDate: string; refs: DraftRefs }

const valuesOf = (next: StoreNextOrder): FormValues => ({
  quantities: Object.fromEntries(next.products.map((p) => [p.id, next.draft?.lines.find((line) => line.productId === p.id)?.quantity ?? 0])),
  note: next.draft?.driverNote ?? '',
});

const sameValues = (a: FormValues, b: FormValues) =>
  a.note.trim() === b.note.trim()
  && Object.keys({ ...a.quantities, ...b.quantities }).every((id) => (a.quantities[id] ?? 0) === (b.quantities[id] ?? 0));

const sameRef = (a: DraftRefs['chilled'], b: DraftRefs['chilled']) => a?.id === b?.id && a?.revision === b?.revision;
const sameBase = (a: Base, b: Base) => a.deliveryDate === b.deliveryDate && sameRef(a.refs.chilled, b.refs.chilled) && sameRef(a.refs.dry, b.refs.dry);

const codeOf = (error: unknown) => (error instanceof ApiRequestError ? error.code : null);

// The signal dropped, the server is down or it asked us to slow down. Trying again can work.
const worthRetrying = (error: unknown) =>
  !(error instanceof ApiRequestError) || error.code === 'network' || error.status >= 500 || error.status === 429;

// The order form's saving (spec 009, rule 3). One save runs at a time and the newest change waits for it. A
// request names the drafts by the id and revision of the last answer. Timers and running requests outlive a
// render, so this lives outside React and tells the screen what to show.
export class DraftForm {
  private values: FormValues;
  private typed: Record<string, string> = {};
  private base: Base;
  private products: StoreProduct[];
  // Every change raises seq. A save carries the seq it was sent with, and the form is saved when they meet.
  private seq = 0;
  private sentSeq = 0;
  private savedSeq = 0;
  private running = false;
  // The save on its way, from its request until its answer is taken in, so a sign-out or a place can wait for it.
  private current: Promise<void> | null = null;
  // The last save failed, or found the session gone. Waiting for the form stops there (Q-04).
  private failed = false;
  private placing = false;
  private timer = 0;
  private retryTimer = 0;
  private tries = 0;
  // The values of every save since the last answer that got no answer. The server may have taken any of them.
  private unanswered: FormValues[] = [];
  private retriedWithoutItem = false;
  private onScreen = true;
  // Takes the form's work back from the sign-out (Q-04).
  private stopWaiting: (() => void) | null = null;
  // The person who opened the form. Its answers belong to them alone.
  private owner: string | null;
  private qc: QueryClient;
  private show: (patch: Partial<Screen>) => void;
  private placed: (orders: StoreOrder[]) => void;

  constructor(next: OpenOrder, qc: QueryClient, show: (patch: Partial<Screen>) => void, placed: (orders: StoreOrder[]) => void) {
    this.values = valuesOf(next);
    this.base = { deliveryDate: next.deliveryDate, refs: next.draft?.refs ?? {} };
    this.products = next.products;
    this.qc = qc;
    this.show = show;
    this.placed = placed;
    this.owner = qc.getQueryData<Me | null>(meKey)?.id ?? null;
  }

  // An answer can arrive after its person signed out, when the screens' cache was emptied, or after someone else
  // signed in on this browser. Written into the cache then, it would show one shop's orders to the next person.
  private stillMine() {
    return this.owner !== null && this.qc.getQueryData<Me | null>(meKey)?.id === this.owner;
  }

  // Off the screen there is nobody to tell.
  private tell(patch: Partial<Screen>) {
    if (this.onScreen) this.show(patch);
  }

  // A quantity box holds something that is not a whole number from 0 to 999 (Q-01).
  private invalid() {
    return Object.values(this.typed).some((text) => wholeQuantity(text) === null);
  }

  private request(): SaveDraftRequest {
    return {
      deliveryDate: this.base.deliveryDate,
      lines: this.products.map((p) => ({ productId: p.id, quantity: this.values.quantities[p.id] ?? 0 })),
      driverNote: this.values.note,
      refs: this.base.refs,
    };
  }

  private takeOver(latest: StoreNextOrder) {
    this.products = latest.products;
    this.base = { deliveryDate: latest.deliveryDate ?? this.base.deliveryDate, refs: latest.draft?.refs ?? {} };
  }

  // Show what the server holds and count the form as saved. Every box shows its number again.
  private showLatest(latest: StoreNextOrder) {
    this.takeOver(latest);
    this.values = valuesOf(latest);
    this.typed = {};
    this.savedSeq = this.sentSeq = this.seq;
    this.tell({ values: this.values, typed: this.typed, saving: 'saved' });
  }

  // cutoff_passed names the day that is open now. The form moves to it and says which day closed.
  private moveToOpenDay(error: unknown) {
    const open = CutoffPassedDetails.safeParse(error instanceof ApiRequestError ? error.details : null);
    if (!open.success) return false;
    const closedDay = this.base.deliveryDate;
    this.base = { ...this.base, deliveryDate: open.data.deliveryDate };
    // Whether the new day closes today is not in the answer. Naming the weekday is true either way.
    if (this.stillMine()) this.qc.setQueryData<StoreNextOrder>(nextOrderKey, (old) => old && { ...old, deliveryDate: open.data.deliveryDate, cutoffAt: open.data.cutoffAt, cutoffIsToday: false });
    this.tell({ closedDay });
    return true;
  }

  // A refusal that trying again cannot fix: load the latest and say so.
  private async loadLatest(error: unknown, whilePlacing: boolean) {
    if (!this.stillMine()) return;
    let latest: StoreNextOrder;
    try {
      latest = await this.qc.fetchQuery({ queryKey: nextOrderKey, queryFn: fetchNextOrder, staleTime: 0 });
    } catch (loadError) {
      if (!whilePlacing) this.failed = true;
      this.tell({ saving: whilePlacing ? 'saved' : 'refused', refused: reasonOf(loadError) });
      return;
    }
    const code = codeOf(error);
    const shown = this.values;
    const held = valuesOf(latest);
    if (code === 'stale' && !whilePlacing && this.unanswered.some((values) => sameValues(held, values))) {
      // The "somewhere else" was this form: an earlier save arrived and its answer did not. Carry on from it.
      this.unanswered = [];
      this.takeOver(latest);
      if (sameValues(held, shown)) this.savedSeq = this.sentSeq = this.seq;
      void this.flush();
    } else if (code === 'unknown_product' && !this.retriedWithoutItem) {
      // An item left the list. Save once more with the items that are still on it.
      this.retriedWithoutItem = true;
      this.takeOver(latest);
      this.seq += 1;
      this.tell({ refused: reasonOf(error) });
      void this.flush();
    } else {
      this.showLatest(latest);
      this.tell(code === 'stale' ? { changedElsewhere: whilePlacing || !sameValues(held, shown) } : { refused: reasonOf(error) });
    }
  }

  // Sends the change on the form, unless a save is on its way, nothing is waiting or a box holds something that is
  // not a whole number. The timer, a change made during a save, a retry, a sign-out and leaving the form come here.
  private flush = async () => {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.retryTimer);
    this.timer = 0;
    if (this.running) return;
    // Nothing goes out for someone who has signed out. The sign-out waited for the form first (Q-04).
    if (!this.stillMine()) return;
    if (this.seq === this.savedSeq) { this.tell({ saving: 'saved' }); return; }
    // Nothing is saved while a box holds something that is not a whole number from 0 to 999 (Q-01).
    if (this.invalid()) { this.tell({ saving: 'held' }); return; }
    const run = this.send();
    this.current = run;
    await run;
    if (this.current === run) this.current = null;
  };

  // One save, and what its answer means for the form.
  private async send() {
    this.running = true;
    this.sentSeq = this.seq;
    const sent = this.values;
    this.tell({ saving: 'saving' });
    try {
      // A read that started before this save would answer with the draft as it was.
      await this.qc.cancelQueries({ queryKey: nextOrderKey });
      const answer = await saveDraft(this.request());
      this.running = false;
      if (!this.stillMine()) return;
      this.failed = false;
      this.tries = 0;
      this.unanswered = [];
      this.retriedWithoutItem = false;
      this.savedSeq = this.sentSeq;
      this.takeOver(answer);
      this.qc.setQueryData<StoreNextOrder>(nextOrderKey, answer);
      // A change made while this save ran goes next, unless its own timer is still counting.
      if (this.seq !== this.savedSeq) { if (this.timer === 0) void this.flush(); } else this.tell({ saving: 'saved' });
    } catch (error) {
      this.running = false;
      if (error instanceof ApiRequestError && error.status === 401) {
        // Signed out, here or in another tab. The change cannot be saved, and the person is told on the screen
        // that comes next (Q-04).
        this.failed = true;
        notKept();
      } else if (codeOf(error) === 'cutoff_passed' && this.moveToOpenDay(error)) {
        void this.flush();
      } else if (worthRetrying(error)) {
        this.failed = true;
        this.unanswered.push(sent);
        // Off the screen there is no reason to keep trying. Whoever waits for the form says it was not kept.
        if (!this.onScreen) return;
        this.show({ saving: 'retrying' });
        this.retryTimer = window.setTimeout(this.flush, Math.min(2000 * 2 ** this.tries, 15_000));
        this.tries += 1;
      } else {
        await this.loadLatest(error, false);
      }
    }
  }

  // Every change saved now: the change waiting for its timer goes at once, a retry goes at once, and a save on its
  // way is waited for. True when the server then holds what the form showed when this began. False when a save
  // failed, the session is gone, a box holds something that is not a whole number, or the draft was changed
  // somewhere else and the form now shows that instead.
  private async settle(): Promise<boolean> {
    const wanted = this.values;
    this.failed = false;
    for (;;) {
      if (this.current) { await this.current; continue; }
      if (this.invalid() || this.failed || !this.stillMine()) return false;
      if (this.seq === this.savedSeq) return sameValues(this.values, wanted);
      await this.flush();
    }
  }

  // Sign-out waits for this, and so does leaving the form: every change is saved first. One that cannot be saved is
  // never lost without a word: the person is told, on whatever screen comes next (Q-04).
  leave = async () => {
    if (!(await this.settle())) notKept();
  };

  // From the tap on Place until the place settles, the form holds still. A change made then would be saved
  // behind the place, and once the drafts are placed, as a new draft nobody asked for.
  private change(values: FormValues) {
    if (this.placing) return;
    this.values = values;
    this.seq += 1;
    // A box that holds something else holds the save until it is fixed, so what is saved is what the form shows.
    const held = this.invalid();
    this.tell({ values, typed: this.typed, saving: held ? 'held' : 'saving', changedElsewhere: false, refused: null });
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.timer);
    this.timer = held ? 0 : window.setTimeout(this.flush, SAVE_AFTER_MS);
  }

  // − and +: a step from the number the form holds. What was typed in the box goes.
  setQuantity = (productId: string, quantity: number) => {
    if (this.placing) return;
    const { [productId]: _gone, ...typed } = this.typed;
    this.typed = typed;
    if ((this.values.quantities[productId] ?? 0) !== quantity) this.change({ ...this.values, quantities: { ...this.values.quantities, [productId]: quantity } });
    else this.tell({ typed });
  };

  // What is typed in a box stays as it is typed. A whole number from 0 to 999 is the item's quantity. Anything else
  // is never turned into another number: the box keeps it, and the form saves nothing until it is fixed (Q-01, Q-02).
  typeQuantity = (productId: string, text: string) => {
    if (this.placing) return;
    this.typed = { ...this.typed, [productId]: text };
    const quantity = wholeQuantity(text);
    this.change(quantity === null ? this.values : { ...this.values, quantities: { ...this.values.quantities, [productId]: quantity } });
  };

  // Leaving a box shows its number as the form holds it, "05" as 5. A box that holds something else keeps it.
  leaveQuantity = (productId: string) => {
    const text = this.typed[productId];
    if (text === undefined || wholeQuantity(text) === null) return;
    const { [productId]: _left, ...typed } = this.typed;
    this.typed = typed;
    this.tell({ typed });
  };

  setNote = (note: string) => {
    if (this.values.note !== note) this.change({ ...this.values, note });
  };

  place = async () => {
    if (this.placing || this.running || this.seq !== this.savedSeq) return;
    this.placing = true;
    this.tell({ placing: true, refused: null });
    try {
      await this.qc.cancelQueries({ queryKey: nextOrderKey });
      const answer = await placeOrders({ deliveryDate: this.base.deliveryDate, refs: this.base.refs });
      if (!this.stillMine()) return;
      this.takeOver(answer);
      this.qc.setQueryData<StoreNextOrder>(nextOrderKey, answer);
      // The open list and Today now hold the placed orders.
      void this.qc.invalidateQueries({ queryKey: ['orders', 'store'] });
      this.placed(answer.placedOrders);
    } catch (error) {
      if (codeOf(error) === 'cutoff_passed' && this.moveToOpenDay(error)) {
        // Nothing was placed. The manager sees the new day and decides again.
        void this.qc.invalidateQueries({ queryKey: nextOrderKey });
      } else if (worthRetrying(error)) {
        this.tell({ refused: reasonOf(error) });
      } else {
        await this.loadLatest(error, true);
      }
      this.placing = false;
      this.tell({ placing: false });
    }
  };

  // The answer of a refetch. When the form has nothing unsaved, a draft that changed somewhere else, or a
  // day that moved on, is shown at once. With a change waiting, the save's own answer decides.
  incoming(next: OpenOrder) {
    this.products = next.products;
    const base: Base = { deliveryDate: next.deliveryDate, refs: next.draft?.refs ?? {} };
    if (sameBase(base, this.base) || this.running || this.seq !== this.savedSeq) return;
    if (base.deliveryDate > this.base.deliveryDate) this.tell({ closedDay: this.base.deliveryDate });
    else if (base.deliveryDate < this.base.deliveryDate) this.tell({ closedDay: null });
    if (!sameValues(valuesOf(next), this.values)) this.tell({ changedElsewhere: true });
    this.showLatest(next);
  }

  opened() {
    this.onScreen = true;
    // Sign-out waits for the form while it is open, and for the last save of a form just left (Q-04).
    this.stopWaiting ??= finishBeforeSignOut(this.leave);
  }

  // Leaving the form must not drop the last change: it goes now, without waiting for the timer, and the person is
  // told when it cannot be saved. Signed out, there is nothing to send: the sign-out waited for the form first.
  closed() {
    this.onScreen = false;
    const done = this.stillMine() ? this.leave() : Promise.resolve();
    return done.then(() => {
      // Opened again in the meantime, as React does once more on a first show in development.
      if (this.onScreen) return;
      this.stopWaiting?.();
      this.stopWaiting = null;
    });
  }
}

// The order form's state for the screen: the numbers and the note, whether they are saved, and what the
// server said. The totals on the screen come from the last save's answer, so what is placed is what was saved.
export function useDraftForm(next: OpenOrder) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [screen, setScreen] = useState<Screen>(() => ({ values: valuesOf(next), typed: {}, saving: 'saved', placing: false, changedElsewhere: false, closedDay: null, refused: null }));
  const [form] = useState(() => new DraftForm(
    next, qc, (patch) => setScreen((now) => ({ ...now, ...patch })),
    (placedOrders) => navigate('/store/orders/placed', { state: { placedOrders } satisfies PlacedNow }),
  ));

  useEffect(() => { form.incoming(next); }, [form, next]);
  useEffect(() => {
    form.opened();
    return () => { void form.closed(); };
  }, [form]);

  return { ...screen, setQuantity: form.setQuantity, typeQuantity: form.typeQuantity, leaveQuantity: form.leaveQuantity, setNote: form.setNote, place: form.place };
}
