import { MutationObserver, QueryClient } from '@tanstack/react-query';
import type { DraftRefs, Me, PlaceOrdersRequest, SaveDraftRequest, StoreNextOrder, StoreOrder, StoreProduct } from '@wayfinder/contracts';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logoutMutation, meKey } from '@/features/auth/api';
import { DraftForm, wholeQuantity, type OpenOrder, type Screen } from './draft-form';
import { nextOrderKey } from './next-order';
import { NOT_CONFIRMED, NOT_KEPT, PLACE_NOT_CONFIRMED } from './words';

// The order form's saving (spec 009, rule 3) against a stand-in server: one Fresh shop, its draft and what it placed.
// The 600 ms before a save and the retries run on fake timers, and the network is a stubbed fetch.

vi.mock('sonner', () => ({ toast: vi.fn() }));

const NADEESHA: Me = { id: 'nadeesha', username: 'nadeesha', staffId: 'S-001', displayName: 'Nadeesha', role: 'store_manager', depotId: null, outletId: 'OUT001' };
const CHILLED: StoreProduct = { id: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', kgPerUnit: 6.9, m3PerUnit: 0.037, temp: 'chilled', needsTailLift: false };
const DRY: StoreProduct = { id: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', kgPerUnit: 6.9, m3PerUnit: 0.037, temp: 'dry', needsTailLift: false };
const PRODUCTS = [CHILLED, DRY];
const THU = '2026-06-25';
// 15:02 and 15:37 on Wed 24 Jun at the depot.
const SAVED_AT = '2026-06-24T09:32:00.000Z';
const PLACED_AT = '2026-06-24T10:07:00.000Z';

// 'usual' lets the server answer as it would have.
type Answer = { status: number; body: unknown } | 'no signal';
type Own = Answer | 'usual';
const reply = (answer: Answer) => {
  if (answer === 'no signal') throw new TypeError('Failed to fetch');
  return { status: answer.status, ok: answer.status >= 200 && answer.status < 300, json: async () => answer.body };
};
const refusal = (status: number, code: string, message: string): Answer => ({ status, body: { error: { code, message } } });
const answerOf = (own: Own | Promise<Own> | (() => Own) | undefined) => (typeof own === 'function' ? own() : own);
// A request's own answer, unless the request is aborted first: then it fails as fetch does.
function unlessAborted(own: Own | Promise<Own> | (() => Own) | undefined, signal: AbortSignal | null | undefined) {
  const answer = answerOf(own);
  if (!signal) return answer;
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  return Promise.race([answer, aborted]);
}

// The shop's next order as the API keeps it: the draft's quantities, note and refs, and what is placed for Thursday.
// A save or a place can be answered otherwise, or held until the test lets it go.
class Server {
  // The day an order placed now is for.
  day = THU;
  quantities: Record<string, number> = {};
  note = '';
  refs: DraftRefs = {};
  placed: StoreOrder[] = [];
  saves: SaveDraftRequest[] = [];
  places: PlaceOrdersRequest[] = [];
  reads = 0;
  // Every request, in the order it was sent: "PUT draft", "POST place", "GET next" and "POST logout".
  log: string[] = [];
  // The next save's or place's own answer, when it is not the server's usual one, or the usual one held back. A
  // function runs when the request arrives, so the server can do its work and the answer still be lost.
  saveAnswers: (Own | Promise<Own> | (() => Own))[] = [];
  placeAnswers: (Own | Promise<Own> | (() => Own))[] = [];

  constructor(quantities: Record<string, number> = {}) {
    if (Object.keys(quantities).length) this.write(quantities, '');
  }

  // A save by the server's own rules: refs must name the drafts there are, and a temperature with units keeps its draft.
  write(quantities: Record<string, number>, note: string) {
    this.quantities = Object.fromEntries(Object.entries(quantities).filter(([, n]) => n > 0));
    this.note = note;
    const refs: DraftRefs = {};
    for (const product of PRODUCTS) {
      if (!this.quantities[product.id]) continue;
      const old = this.refs[product.temp];
      refs[product.temp] = old ? { id: old.id, revision: old.revision + 1 } : { id: crypto.randomUUID(), revision: 0 };
    }
    this.refs = refs;
  }

  // Someone at another screen places the draft as it is.
  placeHere(at = PLACED_AT): StoreOrder[] {
    const orders = PRODUCTS.filter((p) => this.quantities[p.id]).map((p): StoreOrder => ({
      id: this.refs[p.temp]!.id, deliveryDate: this.day, scheduledDate: null, temp: p.temp, status: 'placed',
      lines: [{ productId: p.id, name: p.name, unit: p.unit, quantity: this.quantities[p.id]! }], units: this.quantities[p.id]!,
      placedAt: at, deferralReason: null, delivery: null, receipt: null, problems: [], replacementFor: null, broughtBack: false,
    }));
    this.placed.push(...orders);
    this.quantities = {};
    this.refs = {};
    return orders;
  }

  next(): OpenOrder {
    const lines = PRODUCTS.filter((p) => this.quantities[p.id]).map((p) => ({ productId: p.id, name: p.name, unit: p.unit, quantity: this.quantities[p.id]! }));
    const units = lines.reduce((sum, line) => sum + line.quantity, 0);
    const load = { kg: units * 6.9, m3: units * 0.037, units, needsReefer: lines.some((l) => l.productId === CHILLED.id), needsTailLift: false, keepUpright: false };
    const placedLines = this.placed.flatMap((order) => order.lines);
    const placedUnits = placedLines.reduce((sum, line) => sum + line.quantity, 0);
    return {
      outlet: { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' },
      products: PRODUCTS, deliveryDate: this.day, cutoffAt: '2026-06-24T10:30:00.000Z', cutoffIsToday: true, movedFrom: null,
      draft: lines.length ? { lines, driverNote: this.note, refs: this.refs, savedAt: SAVED_AT, summary: load, tailLiftItems: [] } : null,
      placed: this.placed.length ? {
        orders: this.placed, lines: placedLines, lastPlacedAt: this.placed.at(-1)!.placedAt!,
        summary: { kg: placedUnits * 6.9, m3: placedUnits * 0.037, units: placedUnits, needsReefer: true, needsTailLift: false, keepUpright: false },
      } : null,
    };
  }

  private sameRefs(refs: DraftRefs) {
    return (['chilled', 'dry'] as const).every((temp) => refs[temp]?.id === this.refs[temp]?.id && refs[temp]?.revision === this.refs[temp]?.revision);
  }

  async handle(url: string, init: RequestInit = {}) {
    if (url === '/api/v1/auth/logout' && init.method === 'POST') {
      this.log.push('POST logout');
      return reply({ status: 204, body: null });
    }
    if (url === '/api/v1/store/next-order' && !init.method) {
      this.log.push('GET next');
      this.reads += 1;
      return reply({ status: 200, body: this.next() });
    }
    if (url === '/api/v1/store/next-order/draft' && init.method === 'PUT') {
      this.log.push('PUT draft');
      const body = JSON.parse(String(init.body)) as SaveDraftRequest;
      this.saves.push(body);
      const own = await unlessAborted(this.saveAnswers.shift(), init.signal);
      if (own && own !== 'usual') return reply(own);
      if (!this.sameRefs(body.refs)) return reply(refusal(409, 'stale', 'This order was changed somewhere else.'));
      this.write(Object.fromEntries(body.lines.map((line) => [line.productId, line.quantity])), body.driverNote);
      return reply({ status: 200, body: this.next() });
    }
    if (url === '/api/v1/store/next-order/place' && init.method === 'POST') {
      this.log.push('POST place');
      const body = JSON.parse(String(init.body)) as PlaceOrdersRequest;
      this.places.push(body);
      const own = await unlessAborted(this.placeAnswers.shift(), init.signal);
      if (own && own !== 'usual') return reply(own);
      const named = [body.refs.chilled?.id, body.refs.dry?.id].filter(Boolean);
      const already = this.placed.filter((order) => named.includes(order.id));
      if (named.length && already.length === named.length) return reply({ status: 200, body: { ...this.next(), placedOrders: already } });
      if (!this.sameRefs(body.refs)) return reply(refusal(409, 'stale', 'This order was changed somewhere else.'));
      const placedOrders = this.placeHere();
      return reply({ status: 200, body: { ...this.next(), placedOrders } });
    }
    return reply(refusal(404, 'not_found', 'Not found.'));
  }
}

// An answer the test lets go of when it wants. One still held when a test ends is let go then, as no signal, so the
// writes that queue behind it in the next test are not held too.
const holding: ((answer: Own) => void)[] = [];
function held() {
  let release!: (answer: Own) => void;
  const answer = new Promise<Own>((resolve) => { release = resolve; });
  holding.push(release);
  return { answer, release };
}

// Sign out as the avatar menu does, on useLogout's own options.
const signOut = (qc: QueryClient) => new MutationObserver(qc, logoutMutation(qc)).mutate();

// The form as the page opens it: on screen, for Nadeesha, with what the server holds. The screen is every patch the
// form told it, merged.
const open: { qc: QueryClient; form: DraftForm }[] = [];
function openForm(server: Server, me: Me = NADEESHA) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(meKey, me);
  const next = server.next();
  qc.setQueryData<StoreNextOrder>(nextOrderKey, next);
  const screen: Partial<Screen> = {};
  const placed: StoreOrder[][] = [];
  const form = new DraftForm(next, qc, (patch) => Object.assign(screen, patch), (orders) => { placed.push(orders); });
  form.opened();
  open.push({ qc, form });
  return { qc, form, screen, placed };
}

// Runs the timers that are due after ms, and every answer that is waiting.
const after = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

let server: Server;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', Object.assign(new EventTarget(), {
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (timer: number) => clearTimeout(timer),
  }));
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => server.handle(url, init)));
});
afterEach(async () => {
  // Every form leaves the screen, so none is still handed to the next test's sign-out. Its person goes first, so
  // leaving sends nothing.
  for (const { qc, form } of open.splice(0)) {
    qc.setQueryData(meKey, null);
    await form.closed();
  }
  for (const release of holding.splice(0)) release('no signal');
  await after(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Q-01 and Q-02 the quantity box takes whole numbers from 0 to 999 only', () => {
  it('reads a box as a whole number from 0 to 999 written in digits, an empty box as 0, and anything else as nothing', () => {
    expect([wholeQuantity('0'), wholeQuantity('48'), wholeQuantity('999'), wholeQuantity('007'), wholeQuantity(' 12 '), wholeQuantity('')]).toEqual([0, 48, 999, 7, 12, 0]);
    for (const text of ['-5', '1.5', '5.0', '1000', '99999', '1e3', '+5', '5 boxes', '1,000', '٥']) expect(wholeQuantity(text)).toBeNull();
  });

  it('keeps a typed -5 as it is and saves nothing, so a minus never adds five', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '-5');
    expect(screen.typed).toEqual({ [CHILLED.id]: '-5' });
    expect(screen.values?.quantities[CHILLED.id]).toBe(8);
    expect(screen.saving).toBe('held');
    await after(10_000);
    // Leaving the box changes nothing either.
    form.leaveQuantity(CHILLED.id);
    await after(10_000);
    expect(screen.typed).toEqual({ [CHILLED.id]: '-5' });
    expect(server.saves).toEqual([]);
    expect(server.quantities).toEqual({ [CHILLED.id]: 8 });
  });

  it('keeps 1.5 and 99999 as typed and never saves 2 or 999', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '1.5');
    form.leaveQuantity(CHILLED.id);
    await after(1000);
    expect(screen.typed?.[CHILLED.id]).toBe('1.5');
    form.typeQuantity(CHILLED.id, '99999');
    form.leaveQuantity(CHILLED.id);
    await after(1000);
    expect(screen.typed?.[CHILLED.id]).toBe('99999');
    expect(screen.saving).toBe('held');
    expect(server.saves).toEqual([]);
  });

  it('saves the number once it is whole, and the box shows it as the form holds it once left', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '-5');
    form.typeQuantity(CHILLED.id, '05');
    expect(screen.saving).toBe('saving');
    await after(600);
    expect(server.saves.map((save) => save.lines)).toEqual([[{ productId: CHILLED.id, quantity: 5 }, { productId: DRY.id, quantity: 0 }]]);
    expect(screen.saving).toBe('saved');
    expect(screen.typed).toEqual({ [CHILLED.id]: '05' });
    form.leaveQuantity(CHILLED.id);
    expect(screen.typed).toEqual({});
    expect(screen.values?.quantities[CHILLED.id]).toBe(5);
  });

  it('holds every save while one box is wrong, so what is saved is always what the form shows', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '1.5');
    form.setQuantity(DRY.id, 4);
    await after(5000);
    expect(server.saves).toEqual([]);
    expect(screen.saving).toBe('held');
    form.typeQuantity(CHILLED.id, '2');
    await after(600);
    expect(server.saves.map((save) => save.lines)).toEqual([[{ productId: CHILLED.id, quantity: 2 }, { productId: DRY.id, quantity: 4 }]]);
    expect(screen.saving).toBe('saved');
  });

  it('takes − and + from the number the form holds, and drops what was typed', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '012');
    form.setQuantity(CHILLED.id, 13);
    expect(screen.typed).toEqual({});
    await after(600);
    expect(server.quantities).toEqual({ [CHILLED.id]: 13 });
  });
});

describe('Q-04 signing out while a change is still saving', () => {
  beforeEach(() => {
    // With no browser storage here, forgetting the kept account only warns.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('sends the change still waiting for its timer at once, and signs out once it is saved', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    form.typeQuantity(CHILLED.id, '10');
    const signingOut = signOut(qc);
    await after(0);
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
    await signingOut;
    expect(server.quantities).toEqual({ [CHILLED.id]: 10, [DRY.id]: 2 });
    expect(qc.getQueryData(meKey)).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it('waits for the answer of a save already on its way', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    const save = held();
    server.saveAnswers.push(save.answer);
    form.typeQuantity(CHILLED.id, '10');
    await after(600);
    const signingOut = signOut(qc);
    // Within the 5 seconds a sign-out waits at most.
    await after(4000);
    expect(server.log).toEqual(['PUT draft']);
    expect(qc.getQueryData(meKey)).toEqual(NADEESHA);
    save.release('usual');
    await signingOut;
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
    expect(server.quantities).toEqual({ [CHILLED.id]: 10, [DRY.id]: 2 });
    expect(toast).not.toHaveBeenCalled();
  });

  it('tells the person when that save fails, and sends nothing after the sign-out', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    server.saveAnswers.push('no signal');
    form.typeQuantity(CHILLED.id, '10');
    await signOut(qc);
    expect(toast).toHaveBeenCalledWith(NOT_KEPT, expect.objectContaining({ id: 'draft-not-kept' }));
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
    // The form leaves the screen once its person is signed out, and no retry goes after them.
    await form.closed();
    await after(60_000);
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
  });

  it('tells the person when a box held something that is not a whole number', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    form.typeQuantity(CHILLED.id, '-5');
    await signOut(qc);
    expect(toast).toHaveBeenCalledWith(NOT_KEPT, expect.objectContaining({ id: 'draft-not-kept' }));
    expect(server.log).toEqual(['POST logout']);
  });

  it('says the change was not kept when a save finds the session ended in another tab', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { form } = openForm(server);
    server.saveAnswers.push(refusal(401, 'signed_out', 'Sign in to continue.'));
    form.setQuantity(DRY.id, 3);
    await after(600);
    expect(toast).toHaveBeenCalledWith(NOT_KEPT, expect.objectContaining({ id: 'draft-not-kept' }));
  });

  it('says so when the form is left and its last save fails', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { form } = openForm(server);
    server.saveAnswers.push('no signal');
    form.setQuantity(DRY.id, 3);
    await form.closed();
    expect(server.log).toEqual(['PUT draft']);
    expect(toast).toHaveBeenCalledWith(NOT_KEPT, expect.objectContaining({ id: 'draft-not-kept' }));
  });

  it('says nothing when the form is left and its last save works', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { form } = openForm(server);
    form.setQuantity(DRY.id, 3);
    await form.closed();
    expect(server.quantities).toEqual({ [DRY.id]: 3 });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('Q-07 a draft placed from another tab', () => {
  it('says the order was placed from another screen, never that it changed somewhere else', async () => {
    server = new Server({ [CHILLED.id]: 3, [DRY.id]: 1 });
    const { form, screen, placed } = openForm(server);
    // Tab A places the draft this tab shows, and the live message brings the next order here.
    server.placeHere();
    form.incoming(server.next());
    expect(screen.placedElsewhere).toEqual({ lost: false });
    expect(screen.changedElsewhere).toBeFalsy();
    // The form is ready for another order, and nothing was placed from here.
    expect(screen.values?.quantities).toEqual({ [CHILLED.id]: 0, [DRY.id]: 0 });
    expect(placed).toEqual([]);
  });

  it('says so too when a change here was refused because the order was placed, and that the change is not in it', async () => {
    server = new Server({ [CHILLED.id]: 3, [DRY.id]: 1 });
    const { form, screen } = openForm(server);
    form.setQuantity(CHILLED.id, 4);
    server.placeHere();
    await after(600);
    expect(server.saves).toHaveLength(1);
    expect(screen.placedElsewhere).toEqual({ lost: true });
    expect(screen.changedElsewhere).toBeFalsy();
    expect(screen.saving).toBe('saved');
  });

  it('takes the notice away once a new order is started', async () => {
    server = new Server({ [CHILLED.id]: 3 });
    const { form, screen } = openForm(server);
    server.placeHere();
    form.incoming(server.next());
    form.setQuantity(DRY.id, 2);
    expect(screen.placedElsewhere).toBeNull();
  });

  it('opens the confirmation when it was this form’s own place whose answer was lost', async () => {
    server = new Server({ [CHILLED.id]: 3, [DRY.id]: 1 });
    const { form, screen, placed } = openForm(server);
    server.placeAnswers.push(() => { server.placeHere(); return 'no signal'; });
    await form.place();
    expect(screen.refused).toBeTruthy();
    form.incoming(server.next());
    expect(placed.map((orders) => orders.map((order) => order.temp))).toEqual([['chilled', 'dry']]);
    expect(screen.placedElsewhere).toBeFalsy();
  });
});

describe('Q-08 Place pressed while the draft is still saving', () => {
  // What the server placed: each order's lines as item and quantity.
  const placedLines = () => server.placed.map((order) => order.lines.map((line) => [line.productId, line.quantity]));

  it('waits for the change typed just before, saves it, then places it', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen, placed } = openForm(server);
    form.typeQuantity(CHILLED.id, '9');
    const placing = form.place();
    expect(screen.placing).toBe(true);
    await placing;
    expect(server.log).toEqual(['PUT draft', 'POST place']);
    expect(placedLines()).toEqual([[[CHILLED.id, 9]]]);
    expect(placed).toHaveLength(1);
  });

  it('waits for the answer of a save already on its way', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, placed } = openForm(server);
    const save = held();
    server.saveAnswers.push(save.answer);
    form.typeQuantity(CHILLED.id, '9');
    await after(600);
    const placing = form.place();
    await after(5000);
    expect(server.log).toEqual(['PUT draft']);
    save.release('usual');
    await placing;
    expect(server.log).toEqual(['PUT draft', 'POST place']);
    expect(placedLines()).toEqual([[[CHILLED.id, 9]]]);
    expect(placed).toHaveLength(1);
  });

  it('takes no change made after the press, so what is placed is what the form showed', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form } = openForm(server);
    const save = held();
    server.saveAnswers.push(save.answer);
    form.typeQuantity(CHILLED.id, '9');
    const placing = form.place();
    form.setQuantity(DRY.id, 5);
    save.release('usual');
    await placing;
    expect(placedLines()).toEqual([[[CHILLED.id, 9]]]);
  });

  it('places nothing when that save fails, and says why', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen, placed } = openForm(server);
    server.saveAnswers.push('no signal');
    form.typeQuantity(CHILLED.id, '9');
    await form.place();
    expect(server.log).toEqual(['PUT draft']);
    expect(server.placed).toEqual([]);
    expect(placed).toEqual([]);
    expect(screen.placing).toBe(false);
    expect(screen.refused).toBe('Could not reach Wayfinder. Check the connection and try again.');
  });

  it('places nothing when the day closed while it saved, so the manager decides again', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    const closed = { error: { code: 'cutoff_passed', message: 'Orders for Thu 25 Jun closed at 16:00.', details: { deliveryDate: '2026-06-26', cutoffAt: '2026-06-25T10:30:00.000Z' } } };
    // 16:00 passes as the save arrives: Friday is the open day from then on.
    server.saveAnswers.push(() => { server.day = '2026-06-26'; return { status: 409, body: closed }; });
    form.typeQuantity(CHILLED.id, '9');
    await form.place();
    expect(server.log).toEqual(['PUT draft', 'PUT draft']);
    expect(server.saves.map((save) => save.deliveryDate)).toEqual([THU, '2026-06-26']);
    expect(server.placed).toEqual([]);
    expect(screen.closedDay).toBe(THU);
    expect(screen.placing).toBe(false);
  });

  it('places nothing while a box holds something that is not a whole number', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '9.5');
    await form.place();
    expect(server.log).toEqual([]);
    expect(screen.placing).toBeFalsy();
  });

  it('places nothing when the change took every item out', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { form, screen } = openForm(server);
    form.typeQuantity(CHILLED.id, '0');
    await form.place();
    expect(server.log).toEqual(['PUT draft']);
    expect(screen.placing).toBe(false);
    expect(screen.refused).toBeFalsy();
  });
});

describe('Q-04 and Q-08 signing out just after Place', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('lets the order on its way be placed before the sign-out goes', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { qc, form, placed } = openForm(server);
    const answer = held();
    server.placeAnswers.push(answer.answer);
    const placing = form.place();
    await after(0);
    const signingOut = signOut(qc);
    // Within the 5 seconds a sign-out waits at most.
    await after(4000);
    expect(server.log).toEqual(['POST place']);
    answer.release('usual');
    await placing;
    await signingOut;
    expect(server.log).toEqual(['POST place', 'POST logout']);
    expect(placed).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('Q-04 a sign-out never waits on an answer that does not come', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('waits 5 seconds at most for a save that does not answer, says the change could not be confirmed, and signs out', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    const save = held();
    server.saveAnswers.push(save.answer);
    form.typeQuantity(CHILLED.id, '10');
    const signingOut = signOut(qc);
    await after(4999);
    expect(server.log).toEqual(['PUT draft']);
    expect(toast).not.toHaveBeenCalled();
    await after(1);
    await signingOut;
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
    expect(qc.getQueryData(meKey)).toBeNull();
    expect(toast).toHaveBeenCalledWith(NOT_CONFIRMED, expect.objectContaining({ id: 'draft-not-kept' }));
    // The answer that comes later starts no retry.
    save.release('no signal');
    await after(60_000);
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
  });

  it('waits 5 seconds at most for a place that does not answer, and says the order could not be confirmed as placed', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { qc, form } = openForm(server);
    const answer = held();
    server.placeAnswers.push(answer.answer);
    const placing = form.place();
    await after(0);
    const signingOut = signOut(qc);
    await after(5000);
    await signingOut;
    expect(server.log).toEqual(['POST place', 'POST logout']);
    expect(toast).toHaveBeenCalledWith(PLACE_NOT_CONFIRMED, expect.objectContaining({ id: 'draft-not-kept' }));
    answer.release('no signal');
    await placing;
  });

  it('lets go of a form left with a save that never answered, so the next sign-out does not wait for it again', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    const save = held();
    server.saveAnswers.push(save.answer);
    form.setQuantity(DRY.id, 3);
    void form.closed();
    const first = signOut(qc);
    await after(5000);
    await first;
    expect(toast).toHaveBeenCalledWith(NOT_CONFIRMED, expect.objectContaining({ id: 'draft-not-kept' }));
    // Someone signs in on this browser and out again: nothing is left to wait for.
    qc.setQueryData(meKey, { ...NADEESHA, id: 'ishara', username: 'ishara' });
    const second = signOut(qc);
    await after(0);
    await second;
    expect(server.log).toEqual(['PUT draft', 'POST logout', 'POST logout']);
    save.release('no signal');
    await after(0);
  });
});

describe('Q-04 a request the sign-out stopped waiting for is cut off', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  // The next store manager signs in on the same page, with no reload, and orders.
  async function nextManagerOrders() {
    const { form } = openForm(server, { ...NADEESHA, id: 'ishara', username: 'ishara' });
    form.setQuantity(DRY.id, 5);
    await after(600);
    return form;
  }

  it('aborts a save that never answers at the deadline, so the next shop’s orders go through', async () => {
    server = new Server({ [DRY.id]: 2 });
    const { qc, form } = openForm(server);
    server.saveAnswers.push(held().answer);
    form.typeQuantity(CHILLED.id, '10');
    const signingOut = signOut(qc);
    await after(5000);
    await signingOut;
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
    // The abandoned form neither goes on nor tries again.
    await after(60_000);
    expect(server.log).toEqual(['PUT draft', 'POST logout']);
    await nextManagerOrders();
    expect(server.log).toEqual(['PUT draft', 'POST logout', 'PUT draft']);
    expect(server.quantities).toEqual({ [DRY.id]: 5 });
  });

  it('aborts a place that never answers at the deadline, so the next shop’s orders go through', async () => {
    server = new Server({ [CHILLED.id]: 8 });
    const { qc, form } = openForm(server);
    server.placeAnswers.push(held().answer);
    const placing = form.place();
    await after(0);
    const signingOut = signOut(qc);
    await after(5000);
    await signingOut;
    await placing;
    expect(server.log).toEqual(['POST place', 'POST logout']);
    await after(60_000);
    expect(server.log).toEqual(['POST place', 'POST logout']);
    await nextManagerOrders();
    expect(server.log).toEqual(['POST place', 'POST logout', 'PUT draft']);
  });
});
