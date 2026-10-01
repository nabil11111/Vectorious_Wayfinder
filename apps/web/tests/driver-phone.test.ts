import type { DriverDay, DriverWrite } from '@wayfinder/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The driver's phone (spec 013, rule 10, D-45, AC-45): what it keeps and the loop that sends it. The browser's
// database is a stand-in that can fail on cue, the server is a stubbed fetch, the signal is always there and the
// retry schedule is cut to milliseconds.

type Row = Record<string, unknown> & { seq: number; userId: string; state: string };

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
        get: async (key: string) => structuredClone(this.days.get(key)),
        put: async (value: { userId: string }) => { this.days.set(value.userId, structuredClone(value)); },
      };
    }
    return {
      index: () => ({
        getAll: async (userId: string) => {
          if (this.failReads > 0) {
            this.failReads -= 1;
            throw new DOMException('The read failed.', 'UnknownError');
          }
          return [...this.writes.values()].filter((row) => row.userId === userId).map((row) => structuredClone(row));
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

const hooks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('idb', () => ({ openDB: async () => hooks.db }));
// The loop starts from the owner's hook; outside React its snapshot is read directly.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../src/features/driver/signal', () => ({
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

// The server: whose session the cookie holds, the writes it applied, the ones it refuses, and every write posted.
interface Server { session: Account | null; applied: string[]; refuse: Set<string>; posted: string[] }

function serve(server: Server) {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (!server.session) return reply({ error: { code: 'signed_out', message: 'Sign in again.' } }, 401);
    if (url === '/api/v1/driver/writes') {
      const write = JSON.parse(String(init.body)) as DriverWrite;
      server.posted.push(write.writeId);
      // Dilshan's trip is not on another driver's list, whatever their name.
      if (server.session.id !== DILSHAN.id || server.refuse.has(write.writeId)) {
        return reply({ error: { code: 'unknown_record', message: 'That trip is not on your list.' } }, 404);
      }
      if (!server.applied.includes(write.writeId)) server.applied.push(write.writeId);
      return reply(dayFor(server.session, server.applied));
    }
    if (url === '/api/v1/driver') return reply(dayFor(server.session, server.applied));
    return reply({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  }));
}

// A write kept by an earlier session of the app, waiting to send.
function keptBefore(db: FakeDatabase, account: Account, write: DriverWrite) {
  void db.add('writes', { userId: account.id, write, about: 'Stop 1 · Fresh Nugegoda', savedAt: write.at, state: 'waiting', refusal: null });
}

async function until(done: () => boolean, ms = 4000) {
  const end = performance.now() + ms;
  while (!done()) {
    if (performance.now() > end) throw new Error(`Still waiting after ${ms} ms.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Opens the driver's app for an account: this tab owns it, and the loop starts.
async function open(account: Account) {
  const sender = await import('../src/features/driver/sender');
  const store = await import('../src/features/driver/store');
  sender.useOwner();
  sender.setAccount(account);
  return { sender, store, sync: () => sender.useSync(), queue: () => store.readKept().queue.map((entry) => [entry.write.writeId, entry.state]) };
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

describe('the driver\'s phone', () => {
  it('sends nothing under another account with the same name, refuses nothing for it, and sends once the session is the driver\'s own', async () => {
    const waiting = arrive();
    keptBefore(db, DILSHAN, waiting);
    const server: Server = { session: OTHER_DILSHAN, applied: [], refuse: new Set(), posted: [] };
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
    expect(phone.sync().signedOut).toBe(false);
  });
});
