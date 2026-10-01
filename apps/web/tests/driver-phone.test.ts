import { PHONE_ACCOUNT_HEADER, type DriverDay, type DriverWrite } from '@wayfinder/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The driver's phone (spec 013, rule 10, D-45, AC-45): what it keeps and the loop that sends it. The browser's
// database is a stand-in that can fail on cue, the server is a stubbed fetch, the signal is always there and the
// retry schedule is cut to milliseconds.

type Row = Record<string, unknown> & { seq: number; queue: string; userId: string; state: string };

class FakeDatabase {
  readonly days = new Map<string, unknown>();
  readonly writes = new Map<number, Row>();
  private last = 0;
  // How many reads of the writes fail before one works, and whether keeping a refusal fails.
  failReads = 0;
  failRefusals = false;

  private store(name: string) {
    if (name === 'days') {
      return {
        get: async ([queue, userId]: [string, string]) => structuredClone(this.days.get(`${queue}:${userId}`)),
        put: async (value: { queue: string; userId: string }) => { this.days.set(`${value.queue}:${value.userId}`, structuredClone(value)); },
      };
    }
    return {
      index: () => ({
        getAll: async ([queue, userId]: [string, string]) => {
          if (this.failReads > 0) {
            this.failReads -= 1;
            throw new DOMException('The read failed.', 'UnknownError');
          }
          return [...this.writes.values()].filter((row) => row.queue === queue && row.userId === userId).map((row) => structuredClone(row));
        },
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
    if (this.failRefusals && value.state === 'refused') throw new DOMException('The write failed.', 'UnknownError');
    this.writes.set(value.seq, structuredClone(value));
  }

  states() {
    return [...this.writes.values()].map((row) => row.state);
  }
}

// The signal is there unless a test takes it away, and the loop's "signal back" and "signal lost" are kept, so a test
// can bring the signal back as the probe would.
const hooks = vi.hoisted(() => ({ db: undefined as unknown, signal: true, back: [] as (() => void)[], lost: [] as (() => void)[] }));
vi.mock('idb', () => ({ openDB: async () => hooks.db }));
// The loop starts from the owner's hook; outside React its snapshot is read directly.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../src/lib/phone/signal', () => ({
  ANSWER_WITHIN_MS: 15_000,
  retryDelay: () => 20,
  hasSignal: () => hooks.signal,
  answered: () => undefined,
  noAnswer: () => undefined,
  probeNow: () => undefined,
  startSignal: () => undefined,
  whenBack: (change: () => void) => { hooks.back.push(change); },
  whenLost: (change: () => void) => { hooks.lost.push(change); },
  useSignal: () => hooks.signal,
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

interface Account { id: string; displayName: string }
// Two drivers who share a display name.
const DILSHAN: Account = { id: '6c3ff5ac-0000-4000-8000-000000000001', displayName: 'Dilshan' };
const OTHER_DILSHAN: Account = { id: '6c3ff5ac-0000-4000-8000-000000000002', displayName: 'Dilshan' };
const TRIP = '7a000000-0000-4000-8000-000000000001';
const STOP = '7b000000-0000-4000-8000-000000000001';

// The day the server sends: Dilshan's trip, out, with Fresh Nugegoda still to do. Another driver has no trip.
function dayFor(account: Account, applied: string[]): DriverDay {
  const trips: DriverDay['trips'] = account.id !== DILSHAN.id ? [] : [{
    tripId: TRIP, revision: 1, vehicleId: 'VEH035', vehicleType: 'truck', vehicleTemp: 'reefer', tripNo: 1, brand: 'Fresh', district: 'Colombo',
    status: 'out', leavesAt: '2026-06-24T23:06:00.000Z', backBy: '2026-06-25T00:40:00.000Z', readyAt: '2026-06-24T21:06:00.000Z',
    leftAt: '2026-06-24T22:01:00.000Z', backAt: null, problems: [],
    stops: [{
      id: STOP, seq: 1, revision: 0, retriedAt: null, outletId: 'OUT001', shopName: 'Fresh Nugegoda', district: 'Colombo', dockType: 'street',
      windowOpen: '05:00', windowClose: '07:30', note: null, arrivedAt: null, doneAt: null, outcome: null,
      lines: [{ lineId: '7c000000-0000-4000-8000-000000000001', orderId: '7d000000-0000-4000-8000-000000000001', temp: 'chilled', productId: 'P001',
        name: 'Chilled', unit: 'carton', quantity: 12, loaded: 12, delivered: null }],
    }],
  }];
  return { depot: 'Peliyagoda', driver: account.displayName, driverId: account.id, day: '2026-06-25', planSent: true, appliedWriteIds: [...applied].sort(), trips };
}

const arrive = (): DriverWrite => ({ kind: 'arrive', writeId: crypto.randomUUID(), tripId: TRIP, stopId: STOP, at: '2026-06-24T22:04:00.000Z', revision: 0 });
const closed = (): DriverWrite => ({ kind: 'closed', writeId: crypto.randomUUID(), tripId: TRIP, stopId: STOP, at: '2026-06-24T22:07:00.000Z', revision: 1, note: '' });

// The server: whose session the cookie holds, the writes it applied, the ones it refuses, every write posted and the
// account each send named. With sendAs set, the next send carries that account's session instead, as when it signed in
// in another tab just as the write went.
interface Server { session: Account | null; applied: string[]; refuse: Set<string>; posted: string[]; named: (string | null)[]; sendAs?: Account }

function serve(server: Server) {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (!server.session) return reply({ error: { code: 'signed_out', message: 'Sign in again.' } }, 401);
    if (url === '/api/v1/driver/writes') {
      const write = JSON.parse(String(init.body)) as DriverWrite;
      server.posted.push(write.writeId);
      const named = new Headers(init.headers).get(PHONE_ACCOUNT_HEADER);
      server.named.push(named);
      const session = server.sendAs ?? server.session;
      server.sendAs = undefined;
      // As the API does: a write is taken only under the session of the account the phone names with it.
      if (named !== session.id) {
        return reply({ error: { code: 'other_account', message: 'This record was saved by another account. Sign in as that account to send it.' } }, 409);
      }
      // Dilshan's trip is not on another driver's list, whatever their name.
      if (session.id !== DILSHAN.id || server.refuse.has(write.writeId)) {
        return reply({ error: { code: 'unknown_record', message: 'That trip is not on your list.' } }, 404);
      }
      if (!server.applied.includes(write.writeId)) server.applied.push(write.writeId);
      return reply(dayFor(session, server.applied));
    }
    if (url === '/api/v1/driver') return reply(dayFor(server.session, server.applied));
    return reply({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  }));
}

// A write kept by an earlier session of the app, waiting to send.
function keptBefore(db: FakeDatabase, account: Account, write: DriverWrite) {
  void db.add('writes', { queue: 'driver', userId: account.id, write, about: 'Stop 1 · Fresh Nugegoda', savedAt: write.at, state: 'waiting', refusal: null, shown: null });
}

async function until(done: () => boolean, ms = 4000) {
  const end = performance.now() + ms;
  while (!done()) {
    if (performance.now() > end) throw new Error(`Still waiting after ${ms} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Opens the driver's app for an account: this tab owns the driver's queue, and the loop starts.
async function open(account: Account) {
  const sender = await import('../src/features/driver/queue');
  sender.useOwner();
  sender.setAccount(account);
  return { sender, store: sender, sync: () => sender.useSync(), queue: () => sender.readKept().queue.map((entry) => [entry.write.writeId, entry.state]) };
}

let db: FakeDatabase;

beforeEach(() => {
  vi.resetModules();
  db = new FakeDatabase();
  hooks.db = db;
  hooks.signal = true;
  hooks.back = [];
  hooks.lost = [];
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the driver\'s phone', () => {
  it('sends nothing under another account with the same name, refuses nothing for it, and sends once the session is the driver\'s own', async () => {
    const waiting = arrive();
    keptBefore(db, DILSHAN, waiting);
    const server: Server = { session: OTHER_DILSHAN, applied: [], refuse: new Set(), posted: [], named: [] };
    serve(server);
    const phone = await open(DILSHAN);

    await until(() => phone.sync().signedOut || server.posted.length > 0);
    expect(server.posted).toEqual([]);
    expect(phone.queue()).toEqual([[waiting.writeId, 'waiting']]);
    expect(phone.store.readKept().day).toBeNull();
    expect(db.states()).toEqual(['waiting']);

    server.session = DILSHAN;
    phone.sender.retrySync();
    await until(() => phone.queue().length === 0);
    expect(server.posted).toEqual([waiting.writeId]);
    expect(server.named).toEqual([DILSHAN.id]);
    expect(phone.sync().signedOut).toBe(false);
  });

  it('keeps a write waiting when the server finds another driver\'s session under its send, asks to sign in again, and sends it as Dilshan\'s once he is back', async () => {
    const waiting = arrive();
    keptBefore(db, DILSHAN, waiting);
    // Another driver signs in in another tab after the phone read Dilshan's day, so the send carries their session;
    // Dilshan signs in there again straight after, so the session is his when the phone next asks.
    const server: Server = { session: DILSHAN, applied: [], refuse: new Set(), posted: [], named: [], sendAs: OTHER_DILSHAN };
    serve(server);
    const phone = await open(DILSHAN);

    await until(() => phone.sync().signedOut);
    // Not refused: the write waits on the phone for Dilshan, and nothing sends it again meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.posted).toEqual([waiting.writeId]);
    expect(server.named).toEqual([DILSHAN.id]);
    expect(phone.queue()).toEqual([[waiting.writeId, 'waiting']]);
    expect(db.states()).toEqual(['waiting']);

    // Dilshan signs in again on this phone, and the write goes under his session as his.
    phone.sender.setAccount(DILSHAN);
    await until(() => phone.queue().length === 0);
    expect(server.posted).toEqual([waiting.writeId, waiting.writeId]);
    expect(server.named).toEqual([DILSHAN.id, DILSHAN.id]);
    expect(server.applied).toEqual([waiting.writeId]);
    expect(phone.sync().signedOut).toBe(false);
  });

  it('keeps a start whose reads failed failed, sends nothing meanwhile, and reads again before a new action', async () => {
    const older = arrive();
    keptBefore(db, DILSHAN, older);
    db.failReads = 1000;
    const server: Server = { session: DILSHAN, applied: [], refuse: new Set(), posted: [], named: [] };
    serve(server);
    const phone = await open(DILSHAN);

    await until(() => phone.store.readKept().failed);
    expect(phone.store.readKept()).toMatchObject({ userId: DILSHAN.id, ready: false, failed: true, queue: [] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.posted).toEqual([]);

    // The phone can read again: a new action waits for the read, and the older write goes first.
    db.failReads = 0;
    const newer = closed();
    await phone.sender.saveAction(newer, 'Stop 1 · Fresh Nugegoda');
    await until(() => phone.queue().length === 0);
    expect(server.posted).toEqual([older.writeId, newer.writeId]);
  });

  it('refuses a new action while the phone still cannot read what it kept, and sends once its own retry reads it', async () => {
    const older = arrive();
    keptBefore(db, DILSHAN, older);
    db.failReads = 1000;
    const server: Server = { session: DILSHAN, applied: [], refuse: new Set(), posted: [], named: [] };
    serve(server);
    const phone = await open(DILSHAN);

    await until(() => phone.store.readKept().failed);
    await expect(phone.sender.saveAction(closed(), 'Stop 1 · Fresh Nugegoda')).rejects.toThrow();
    expect(db.states()).toEqual(['waiting']);
    expect(server.posted).toEqual([]);

    db.failReads = 0;
    await until(() => phone.store.readKept().ready && phone.queue().length === 0);
    expect(server.posted).toEqual([older.writeId]);
  });

  it('marks a write refused only once the phone has kept the refusal, and says when it could not', async () => {
    const doomed = arrive();
    keptBefore(db, DILSHAN, doomed);
    db.failRefusals = true;
    const server: Server = { session: DILSHAN, applied: [], refuse: new Set([doomed.writeId]), posted: [], named: [] };
    serve(server);
    const phone = await open(DILSHAN);

    await until(() => phone.sync().notSaved);
    expect(phone.queue()).toEqual([[doomed.writeId, 'waiting']]);
    expect(db.states()).toEqual(['waiting']);

    // It goes again on the retry schedule, is refused again, and the refusal is kept once the phone can keep it.
    db.failRefusals = false;
    await until(() => phone.queue()[0]?.[1] === 'refused');
    expect(db.states()).toEqual(['refused']);
    expect(phone.sync().notSaved).toBe(false);
    expect(server.posted.length).toBeGreaterThanOrEqual(2);
  });

  it('ties "Back online" to the trip its stops belong to, and takes it away once that trip is checked in (Q-30)', async () => {
    hooks.signal = false;
    const server: Server = { session: DILSHAN, applied: [], refuse: new Set(), posted: [], named: [] };
    serve(server);
    const phone = await open(DILSHAN);
    // With no signal, the arrival and the closed shop wait on the phone.
    await phone.sender.saveAction(arrive(), 'Stop 1 · Fresh Nugegoda');
    await phone.sender.saveAction(closed(), 'Stop 1 · Fresh Nugegoda');
    expect(server.posted).toEqual([]);

    // The signal comes back: both go, and the green line names Nugegoda and the trip it belongs to.
    hooks.signal = true;
    for (const back of hooks.back) back();
    await until(() => phone.sync().backOnline !== null);
    expect(server.posted).toHaveLength(2);
    expect(phone.sync().backOnline).toEqual({ names: ['Nugegoda'], belongsTo: [TRIP] });

    // Checking the trip in takes the line away, so it never comes back on the next trip.
    await phone.sender.saveAction({ kind: 'finish', writeId: crypto.randomUUID(), tripId: TRIP, at: '2026-06-24T22:26:00.000Z', revision: 1 }, 'End of trip · VEH035');
    expect(phone.sync().backOnline).toBeNull();
    // The end of the trip goes too, and the loop is idle again before the test lets the server go.
    await until(() => phone.queue().length === 0);
    expect(server.posted).toHaveLength(3);
  });
});
