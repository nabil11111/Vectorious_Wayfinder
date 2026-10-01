import { PHONE_ACCOUNT_HEADER, type ReceiptWrite, type StoreDeliveries, type StoreDelivery } from '@wayfinder/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shop's queue (spec 015, rule 6, D-57): the shared phone queue with the shop's parts. The browser's database is
// a stand-in keyed by queue and account, the server is a stubbed fetch, the signal is always there and the retry
// schedule is cut to milliseconds.

type Row = Record<string, unknown> & { seq: number; queue: string; userId: string; state: string };

class FakeDatabase {
  readonly days = new Map<string, unknown>();
  readonly writes = new Map<number, Row>();
  private last = 0;

  private store(name: string) {
    if (name === 'days') {
      return {
        get: async ([queue, userId]: [string, string]) => structuredClone(this.days.get(`${queue}:${userId}`)),
        put: async (value: { queue: string; userId: string }) => { this.days.set(`${value.queue}:${value.userId}`, structuredClone(value)); },
      };
    }
    return {
      index: () => ({
        getAll: async ([queue, userId]: [string, string]) => [...this.writes.values()].filter((row) => row.queue === queue && row.userId === userId).map((row) => structuredClone(row)),
      }),
      put: async (value: Row) => this.put('writes', value),
      delete: async (seq: number) => { this.writes.delete(seq); },
    };
  }

  transaction(names: string | string[]) {
    const first = Array.isArray(names) ? names[0]! : names;
    return { objectStore: (name: string) => this.store(name), store: this.store(first), done: Promise.resolve() };
  }

  async add(_name: string, value: Omit<Row, 'seq'>) {
    this.last += 1;
    this.writes.set(this.last, structuredClone({ ...value, seq: this.last }));
    return this.last;
  }

  async put(_name: string, value: Row) {
    this.writes.set(value.seq, structuredClone(value));
  }
}

const hooks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('idb', () => ({ openDB: async () => hooks.db }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../src/lib/phone/signal', () => ({
  ANSWER_WITHIN_MS: 15_000,
  retryDelay: () => 20,
  hasSignal: () => true,
  answered: () => undefined,
  noAnswer: () => undefined,
  probeNow: () => undefined,
  startSignal: () => undefined,
  whenBack: () => undefined,
  whenLost: () => undefined,
  useSignal: () => true,
  within: async <T,>(run: (signal: AbortSignal) => Promise<T>, cancel?: AbortSignal) => {
    const limit = new AbortController();
    cancel?.addEventListener('abort', () => limit.abort(), { once: true });
    try {
      return { value: await run(limit.signal) };
    } catch (error) {
      return { error, timedOut: false, cancelled: cancel?.aborted === true };
    }
  },
}));

const NADEESHA = '9a000000-0000-4000-8000-000000000001';
// Another store manager of the same shop.
const OTHER = '9a000000-0000-4000-8000-000000000002';
const ANOTHER = 'This record was saved by another account. Sign in as that account to send it.';
const STOP = '9b000000-0000-4000-8000-000000000001';
const LINE = '9c000000-0000-4000-8000-000000000001';

const delivery: StoreDelivery = {
  stopId: STOP, revision: 2, day: '2026-06-25', vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: '2026-06-24T22:04:00.000Z', doneAt: '2026-06-24T22:08:00.000Z',
  outcome: 'delivered', late: false, refusalReason: null, receipt: null,
  lines: [{ lineId: LINE, orderId: '9d000000-0000-4000-8000-000000000001', temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', ordered: 12, loaded: 12, wontFit: 0, delivered: 12, received: null }],
};
const deliveriesFor = (applied: string[], userId: string): StoreDeliveries => ({
  outlet: { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' },
  userId, today: '2026-06-25', appliedWriteIds: [...applied].sort(), deliveries: [delivery],
});
const receipt = (): ReceiptWrite => ({ kind: 'receipt', writeId: crypto.randomUUID(), stopId: STOP, at: '2026-06-25T03:01:00.000Z', revision: 2, lines: [{ lineId: LINE, received: 11 }], cold: true, reason: 'missing' });

// The server: whose session the cookie holds, the receipts it applied, how many sends get no answer, every write posted
// and the account each send named. With sendAs set, the next send carries that account's session instead, as when it
// signed in in another tab just as the receipt went.
interface Server { session: string; applied: string[]; silent: number; posted: string[]; named: (string | null)[]; sendAs?: string }
function serve(server: Server) {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/v1/store/receipts') {
      const write = JSON.parse(String(init.body)) as ReceiptWrite;
      server.posted.push(write.writeId);
      const named = new Headers(init.headers).get(PHONE_ACCOUNT_HEADER);
      server.named.push(named);
      const session = server.sendAs ?? server.session;
      server.sendAs = undefined;
      if (server.silent > 0) {
        server.silent -= 1;
        throw new TypeError('Failed to fetch');
      }
      // As the API does: a receipt is taken only under the session of the account the phone names with it.
      if (named !== session) return reply({ error: { code: 'other_account', message: ANOTHER } }, 409);
      if (!server.applied.includes(write.writeId)) server.applied.push(write.writeId);
      return reply(deliveriesFor(server.applied, session));
    }
    if (url === '/api/v1/store/deliveries') return reply(deliveriesFor(server.applied, server.session));
    return reply({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  }));
}

async function until(done: () => boolean, ms = 4000) {
  const end = performance.now() + ms;
  while (!done()) {
    if (performance.now() > end) throw new Error(`Still waiting after ${ms} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let db: FakeDatabase;

beforeEach(() => {
  vi.resetModules();
  db = new FakeDatabase();
  hooks.db = db;
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shop\'s queue', () => {
  it('keeps a receipt with the delivery as the form showed it, under its own queue, and sends it once until the deliveries list it', async () => {
    // A driver's record of the same account id is the driver queue's, and the shop's queue neither reads nor sends it.
    void db.add('writes', { queue: 'driver', userId: NADEESHA, write: { kind: 'arrive' }, about: 'Stop 1 · Fresh Nugegoda', savedAt: '2026-06-24T22:04:00.000Z', state: 'waiting', refusal: null, shown: null });
    const server: Server = { session: NADEESHA, applied: [], silent: 0, posted: [], named: [] };
    serve(server);
    const { shopQueue } = await import('../src/lib/phone/shop');
    expect(shopQueue.lock).toBe('wayfinder-shop');
    shopQueue.useOwner();
    shopQueue.setAccount({ id: NADEESHA });
    await until(() => shopQueue.readKept().ready && shopQueue.useSync().fetched);
    expect(shopQueue.readKept().queue).toEqual([]);

    const write = receipt();
    await shopQueue.saveAction(write, 'Fresh Nugegoda · VEH035', delivery);
    const saved = [...db.writes.values()].find((row) => row.queue === 'shop')!;
    expect(saved).toMatchObject({ queue: 'shop', userId: NADEESHA, write, about: 'Fresh Nugegoda · VEH035', savedAt: write.at, state: 'waiting', refusal: null, shown: delivery });

    await until(() => shopQueue.readKept().queue.length === 0);
    expect(server.posted).toEqual([write.writeId]);
    expect(server.named).toEqual([NADEESHA]);
    expect(shopQueue.readKept().day!.appliedWriteIds).toEqual([write.writeId]);
    expect([...db.writes.values()].map((row) => row.queue)).toEqual(['driver']);
  });

  it('marks a receipt whose send got no answer, and clears the mark once a send of it is answered', async () => {
    const server: Server = { session: NADEESHA, applied: [], silent: 1, posted: [], named: [] };
    serve(server);
    const { shopQueue } = await import('../src/lib/phone/shop');
    shopQueue.useOwner();
    shopQueue.setAccount({ id: NADEESHA });
    await until(() => shopQueue.readKept().ready && shopQueue.useSync().fetched);
    const write = receipt();
    await shopQueue.saveAction(write, 'Fresh Nugegoda · VEH035', delivery);
    await until(() => shopQueue.useSync().unanswered.includes(write.writeId));
    await until(() => shopQueue.readKept().queue.length === 0);
    expect(shopQueue.useSync().unanswered).toEqual([]);
    expect(server.posted).toEqual([write.writeId, write.writeId]);
    expect(server.applied).toEqual([write.writeId]);
  });

  it('keeps a receipt waiting when the server finds another account\'s session under its send, asks to sign in again, and sends it as its own account\'s once that account is back', async () => {
    const server: Server = { session: NADEESHA, applied: [], silent: 0, posted: [], named: [] };
    serve(server);
    const { shopQueue } = await import('../src/lib/phone/shop');
    shopQueue.useOwner();
    shopQueue.setAccount({ id: NADEESHA });
    await until(() => shopQueue.readKept().ready && shopQueue.useSync().fetched);

    // The shop's other manager signs in in another tab after the phone read Nadeesha's day, so the send carries his
    // session; she signs in there again straight after, so the session is hers when the phone next asks.
    server.sendAs = OTHER;
    const write = receipt();
    await shopQueue.saveAction(write, 'Fresh Nugegoda · VEH035', delivery);
    await until(() => shopQueue.useSync().signedOut);
    // Not refused: the receipt waits on the phone for Nadeesha, and nothing sends it again meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.posted).toEqual([write.writeId]);
    expect(server.named).toEqual([NADEESHA]);
    expect(server.applied).toEqual([]);
    expect(shopQueue.readKept().queue.map((entry) => [entry.write.writeId, entry.state, entry.refusal])).toEqual([[write.writeId, 'waiting', null]]);
    expect([...db.writes.values()].map((row) => row.state)).toEqual(['waiting']);

    // Nadeesha signs in again on this phone, and the receipt goes under her session as hers.
    shopQueue.setAccount({ id: NADEESHA });
    await until(() => shopQueue.readKept().queue.length === 0);
    expect(server.posted).toEqual([write.writeId, write.writeId]);
    expect(server.named).toEqual([NADEESHA, NADEESHA]);
    expect(server.applied).toEqual([write.writeId]);
    expect(shopQueue.useSync().signedOut).toBe(false);
  });
});
