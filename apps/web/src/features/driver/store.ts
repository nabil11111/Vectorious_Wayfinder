import { useSyncExternalStore } from 'react';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DriverDay, DriverWrite } from '@wayfinder/contracts';

// What the driver's phone keeps (spec 013, D-45, D-49, plan.md "What it keeps"): per signed-in account, the last day
// the server sent and the writes not yet applied or refused, in the order they were saved, in the browser's database
// `wayfinder`. Only the tab that holds the driver's app opens it. Another account signed in on the phone reads and
// sends only its own. The screens read the account's part through useKept.

export interface Refusal { code: string; message: string }

export interface Queued {
  seq: number;
  userId: string;
  // The exact request it will send, photo and all.
  write: DriverWrite;
  // What it is about, "Stop 2 · Fresh Wellawatte", kept with it so "Not accepted" can still name it after a reset
  // took its trip off the day.
  about: string;
  // The app clock when it was saved.
  savedAt: string;
  state: 'waiting' | 'refused';
  // The server's code and sentence once it refused the write.
  refusal: Refusal | null;
}

type Stored = Omit<Queued, 'seq'> & { seq?: number };

interface Schema extends DBSchema {
  days: { key: string; value: { userId: string; day: unknown } };
  writes: { key: number; value: Stored; indexes: { byUser: string } };
}

let opening: Promise<IDBPDatabase<Schema>> | null = null;
function database() {
  opening ??= openDB<Schema>('wayfinder', 1, {
    upgrade(db) {
      db.createObjectStore('days', { keyPath: 'userId' });
      db.createObjectStore('writes', { keyPath: 'seq', autoIncrement: true }).createIndex('byUser', 'userId');
    },
  }).catch((error: unknown) => {
    // A database that would not open may open on the next try, such as once another tab lets go of an old version.
    opening = null;
    throw error;
  });
  return opening;
}

export interface Kept {
  userId: string | null;
  // The database has been read for this account.
  ready: boolean;
  // The database could not be read for this account. Nothing is sent or saved for it until a later read works, so a
  // write kept earlier is never passed by a newer one.
  failed: boolean;
  // The day the server last sent, or null when the phone has none.
  day: DriverDay | null;
  // Waiting and refused writes, oldest first.
  queue: Queued[];
}

let kept: Kept = { userId: null, ready: false, failed: false, day: null, queue: [] };
const listeners = new Set<() => void>();

function set(next: Kept) {
  kept = next;
  for (const listener of listeners) listener();
}

export const readKept = () => kept;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useKept() {
  return useSyncExternalStore(subscribe, readKept);
}

const bySeq = (a: Queued, b: Queued) => a.seq - b.seq;

const OLDER_SHAPE: Refusal = { code: 'invalid_input', message: 'This record was kept by an older version of Wayfinder and cannot be sent.' };

async function readAccount(userId: string) {
  const db = await database();
  const tx = db.transaction(['days', 'writes'], 'readonly');
  const [stored, writes] = await Promise.all([tx.objectStore('days').get(userId), tx.objectStore('writes').index('byUser').getAll(userId), tx.done]);
  // A day kept by an older version of the app that no longer fits the shape is dropped; the next fetch brings one.
  const day = DriverDay.safeParse(stored?.day);
  // A write that no longer fits the shape could not be sent or shown, so it waits under "Not accepted" instead.
  const queue = (writes as Queued[]).sort(bySeq).map((entry): Queued => {
    const write = DriverWrite.safeParse(entry.write);
    return write.success ? { ...entry, write: write.data } : { ...entry, state: 'refused', refusal: entry.refusal ?? OLDER_SHAPE };
  });
  return { day: day.success ? day.data : null, queue };
}

// The read running now, so a second caller waits for it rather than reading again.
let reading: { userId: string; done: Promise<boolean> } | null = null;

// Reads an account's day and writes, three tries 300 ms apart. It resolves whether they were read: on success the
// account is ready, and otherwise it is failed and shows "Could not read what this phone kept.".
function read(userId: string): Promise<boolean> {
  if (reading?.userId === userId) return reading.done;
  const done = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const found = await readAccount(userId);
        if (kept.userId !== userId) return false;
        set({ userId, ready: true, failed: false, ...found });
        return true;
      } catch (error) {
        console.warn('Could not read what this phone kept.', error);
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    }
    if (kept.userId === userId) set({ ...kept, ready: false, failed: true });
    return false;
  })();
  reading = { userId, done };
  void done.then(() => { if (reading?.done === done) reading = null; });
  return done;
}

// Opens an account's part of the phone, its day and writes from the database, so the screens can open at once with
// no signal. A start whose reads all fail stays failed: it never shows an empty queue as if nothing waited.
export function openAccount(userId: string) {
  set({ userId, ready: false, failed: false, day: null, queue: [] });
  return read(userId);
}

// Whether the account's records have been read, reading them again first when they could not be. The loop asks it
// before every send and a save before every new action.
export function readFirst(userId: string): Promise<boolean> {
  if (kept.userId !== userId) return Promise.resolve(false);
  if (kept.ready) return Promise.resolve(true);
  return read(userId);
}

let askedToPersist = false;

// Saves one action as the request it will send. It is in the database when this resolves, and not at all when it
// throws, such as when the phone is out of storage.
export async function addWrite(userId: string, write: DriverWrite, about: string, savedAt: string): Promise<Queued> {
  const db = await database();
  const stored: Stored = { userId, write, about, savedAt, state: 'waiting', refusal: null };
  const seq = await db.add('writes', stored);
  // The first save asks the browser to keep this storage rather than clear it when space runs low.
  if (!askedToPersist) {
    askedToPersist = true;
    navigator.storage?.persist?.().catch((error: unknown) => console.warn('Could not ask to keep this phone\'s storage.', error));
  }
  const entry: Queued = { ...stored, seq };
  if (kept.userId === userId) set({ ...kept, queue: [...kept.queue, entry].sort(bySeq) });
  return entry;
}

// Keeps the day the server sent and, in the same transaction, takes off the queue every write the day lists as
// applied (D-45). The screen keeps the day even when the database fails, and phoneView leaves listed writes out.
export async function keepDay(userId: string, day: DriverDay) {
  const listed = new Set(day.appliedWriteIds);
  const done = (entry: Queued) => entry.state === 'waiting' && listed.has(entry.write.writeId);
  try {
    const db = await database();
    const tx = db.transaction(['days', 'writes'], 'readwrite');
    const writes = tx.objectStore('writes');
    const own = (await writes.index('byUser').getAll(userId)) as Queued[];
    await Promise.all([
      tx.objectStore('days').put({ userId, day }),
      ...own.filter(done).map((entry) => writes.delete(entry.seq)),
      tx.done,
    ]);
  } catch (error) {
    console.warn('Could not keep the day on this phone.', error);
  }
  if (kept.userId === userId) set({ ...kept, day, queue: kept.queue.filter((entry) => !done(entry)) });
}

// A write the server refused is never sent again. It stays under "Not accepted" with the server's sentence. The
// database keeps the refusal first and the screen shows it after, so a reload never finds the write waiting and sends
// it again. It throws when the database could not keep it, and the write stays waiting, here and there.
export async function refuseWrite(entry: Queued, refusal: Refusal) {
  const next: Queued = { ...entry, state: 'refused', refusal };
  const db = await database();
  await db.put('writes', next);
  if (kept.userId === entry.userId) set({ ...kept, queue: kept.queue.map((held) => (held.seq === entry.seq ? next : held)) });
}

// "Clear" on the waiting sheet: the refused writes of this account go, the ones the sheet showed. One refused while
// it cleared stays for the next Clear.
export async function clearRefused(userId: string) {
  const refused = new Set(kept.queue.filter((entry) => entry.userId === userId && entry.state === 'refused').map((entry) => entry.seq));
  const db = await database();
  const tx = db.transaction('writes', 'readwrite');
  await Promise.all([...[...refused].map((seq) => tx.store.delete(seq)), tx.done]);
  if (kept.userId === userId) set({ ...kept, queue: kept.queue.filter((entry) => !refused.has(entry.seq)) });
}
