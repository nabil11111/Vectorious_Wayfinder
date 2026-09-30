import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CutoffPassedDetails, type DraftRefs, type SaveDraftRequest, type StoreNextOrder, type StoreProduct } from '@wayfinder/contracts';
import { ApiRequestError } from '@/lib/api';
import { fetchNextOrder, nextOrderKey, placeOrders, saveDraft } from './next-order';
import { reasonOf } from './words';

// A change is saved this long after it was made, so a run of taps is one save.
const SAVE_AFTER_MS = 600;

// The next order while a delivery day is open. The form only exists then.
export type OpenOrder = StoreNextOrder & { deliveryDate: string };

// What the manager has on the form: a quantity per item and the note.
export interface FormValues { quantities: Record<string, number>; note: string }

// 'saved': the server holds what the form shows. 'saving': a change is waiting or on its way. 'retrying': the
// last try failed and another follows. 'refused': the server said no and the latest could not be loaded.
export type Saving = 'saved' | 'saving' | 'retrying' | 'refused';

interface Screen {
  values: FormValues;
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
class DraftForm {
  private values: FormValues;
  private base: Base;
  private products: StoreProduct[];
  // Every change raises seq. A save carries the seq it was sent with, and the form is saved when they meet.
  private seq = 0;
  private sentSeq = 0;
  private savedSeq = 0;
  private running = false;
  private placing = false;
  private timer = 0;
  private retryTimer = 0;
  private tries = 0;
  // The values of a save that got no answer. The server may have taken it all the same.
  private unanswered: FormValues | null = null;
  private retriedWithoutItem = false;
  private onScreen = true;
  private qc: QueryClient;
  private show: (patch: Partial<Screen>) => void;
  private placed: () => void;

  constructor(next: OpenOrder, qc: QueryClient, show: (patch: Partial<Screen>) => void, placed: () => void) {
    this.values = valuesOf(next);
    this.base = { deliveryDate: next.deliveryDate, refs: next.draft?.refs ?? {} };
    this.products = next.products;
    this.qc = qc;
    this.show = show;
    this.placed = placed;
  }

  // Off the screen there is nobody to tell.
  private tell(patch: Partial<Screen>) {
    if (this.onScreen) this.show(patch);
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

  // Show what the server holds and count the form as saved.
  private showLatest(latest: StoreNextOrder) {
    this.takeOver(latest);
    this.values = valuesOf(latest);
    this.savedSeq = this.sentSeq = this.seq;
    this.tell({ values: this.values, saving: 'saved' });
  }

  // cutoff_passed names the day that is open now. The form moves to it and says which day closed.
  private moveToOpenDay(error: unknown) {
    const open = CutoffPassedDetails.safeParse(error instanceof ApiRequestError ? error.details : null);
    if (!open.success) return false;
    const closedDay = this.base.deliveryDate;
    this.base = { ...this.base, deliveryDate: open.data.deliveryDate };
    // Whether the new day closes today is not in the answer. Naming the weekday is true either way.
    this.qc.setQueryData<StoreNextOrder>(nextOrderKey, (old) => old && { ...old, deliveryDate: open.data.deliveryDate, cutoffAt: open.data.cutoffAt, cutoffIsToday: false });
    this.tell({ closedDay });
    return true;
  }

  // A refusal that trying again cannot fix: load the latest and say so.
  private async loadLatest(error: unknown, whilePlacing: boolean) {
    let latest: StoreNextOrder;
    try {
      latest = await this.qc.fetchQuery({ queryKey: nextOrderKey, queryFn: fetchNextOrder, staleTime: 0 });
    } catch (loadError) {
      this.tell({ saving: whilePlacing ? 'saved' : 'refused', refused: reasonOf(loadError) });
      return;
    }
    const code = codeOf(error);
    const shown = this.values;
    const held = valuesOf(latest);
    if (code === 'stale' && !whilePlacing && this.unanswered && sameValues(held, this.unanswered)) {
      // The "somewhere else" was this form: an earlier save arrived and its answer did not. Carry on from it.
      this.unanswered = null;
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

  private flush = async () => {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.retryTimer);
    this.timer = 0;
    if (this.running) return;
    if (this.seq === this.savedSeq) { this.tell({ saving: 'saved' }); return; }
    this.running = true;
    this.sentSeq = this.seq;
    const sent = this.values;
    this.tell({ saving: 'saving' });
    try {
      // A read that started before this save would answer with the draft as it was.
      await this.qc.cancelQueries({ queryKey: nextOrderKey });
      const answer = await saveDraft(this.request());
      this.running = false;
      this.tries = 0;
      this.unanswered = null;
      this.retriedWithoutItem = false;
      this.savedSeq = this.sentSeq;
      this.takeOver(answer);
      this.qc.setQueryData<StoreNextOrder>(nextOrderKey, answer);
      // A change made while this save ran goes next, unless its own timer is still counting.
      if (this.seq !== this.savedSeq) { if (this.timer === 0) void this.flush(); } else this.tell({ saving: 'saved' });
    } catch (error) {
      this.running = false;
      if (codeOf(error) === 'cutoff_passed' && this.moveToOpenDay(error)) {
        void this.flush();
      } else if (worthRetrying(error)) {
        this.unanswered = sent;
        // Off the screen there is no reason to keep trying.
        if (!this.onScreen) return;
        this.show({ saving: 'retrying' });
        this.retryTimer = window.setTimeout(this.flush, Math.min(2000 * 2 ** this.tries, 15_000));
        this.tries += 1;
      } else {
        await this.loadLatest(error, false);
      }
    }
  };

  private change(values: FormValues) {
    this.values = values;
    this.seq += 1;
    this.tell({ values, saving: 'saving', changedElsewhere: false, refused: null });
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.flush, SAVE_AFTER_MS);
  }

  setQuantity = (productId: string, quantity: number) => {
    if ((this.values.quantities[productId] ?? 0) !== quantity) this.change({ ...this.values, quantities: { ...this.values.quantities, [productId]: quantity } });
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
      this.takeOver(answer);
      this.qc.setQueryData<StoreNextOrder>(nextOrderKey, answer);
      // The open list and Today now hold the placed orders.
      void this.qc.invalidateQueries({ queryKey: ['orders', 'store'] });
      this.placed();
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
  }

  // Leaving the form must not drop the last change: send it now, without waiting for the timer.
  closed() {
    this.onScreen = false;
    void this.flush();
  }
}

// The order form's state for the screen: the numbers and the note, whether they are saved, and what the
// server said. The totals on the screen come from the last save's answer, so what is placed is what was saved.
export function useDraftForm(next: OpenOrder) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [screen, setScreen] = useState<Screen>(() => ({ values: valuesOf(next), saving: 'saved', placing: false, changedElsewhere: false, closedDay: null, refused: null }));
  const [form] = useState(() => new DraftForm(next, qc, (patch) => setScreen((now) => ({ ...now, ...patch })), () => navigate('/store/orders/placed')));

  useEffect(() => { form.incoming(next); }, [form, next]);
  useEffect(() => {
    form.opened();
    return () => form.closed();
  }, [form]);

  return { ...screen, setQuantity: form.setQuantity, setNote: form.setNote, place: form.place };
}
