import { useSyncExternalStore } from 'react';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { z } from 'zod';

// What a phone keeps (spec 013's D-45 and D-49, spec 015's D-57, plan.md "The phone"): per signed-in account and queue,
// the driver's or the shop's, the last day the server sent and the writes not yet applied or refused, in the order they
// were saved, in the browser's database `wayfinder`. Only the tab that owns a queue opens its part. Another account
// signed in on the phone reads and sends only its own. A queue's screens read the account's part through useKept.

export interface Refusal { code: string; message: string }

// One record: a write saved on the phone, waiting to send or refused by the server.
export interface Queued<Write, Shown> {
  seq: number;
  // The queue it belongs to, 'driver' or 'shop'.
  queue: string;
  userId: string;
  // The exact request it will send, photo and all.
  write: Write;
  // What it is about, "Stop 2 · Fresh Wellawatte", kept with it so "Not accepted" can still name it after a reset took
  // its record off the day.
  about: string;
  // The app clock when it was saved.
  savedAt: string;
  state: 'waiting' | 'refused';
  // The server's code and sentence once it refused the write.
  refusal: Refusal | null;
  // A copy of what the queue's screen needs to draw the record without the day: for a receipt, the delivery as the form
  // showed it. null for a queue whose records need none, and for a copy kept by an older version that no longer fits,
  // whose write still goes.
  shown: Shown | null;
}

// The shapes a queue's records are read back with, so a record kept by an older version is told apart.
export interface Shapes<Day, Write, Shown> {
  Day: z.ZodType<Day>;
  Write: z.ZodType<Write>;
  Shown: z.ZodType<Shown>;
}

interface Stored {
  seq?: number;
  queue: string;
  userId: string;
  write: unknown;
  about: string;
  savedAt: string;
  state: 'waiting' | 'refused';
  refusal: Refusal | null;
  shown: unknown;
}

interface Schema extends DBSchema {
  days: { key: [string, string]; value: { queue: string; userId: string; day: unknown } };
  writes: { key: number; value: Stored; indexes: { byOwner: [string, string] } };
}

let opening: Promise<IDBPDatabase<Schema>> | null = null;
function database() {
  opening ??= openDB<Schema>('wayfinder', 2, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // Version 1 was spec 013's: the driver's records alone, by account. They are carried over as the driver queue's,
      // waiting writes and refusals in the order they were saved, so an update never loses what waited on the phone.
      let days: Record<string, unknown>[] = [];
      let writes: Record<string, unknown>[] = [];
      if (oldVersion === 1) {
        days = (await tx.objectStore('days').getAll()) as unknown as Record<string, unknown>[];
        writes = (await tx.objectStore('writes').getAll()) as unknown as Record<string, unknown>[];
        db.deleteObjectStore('days');
        db.deleteObjectStore('writes');
      }
      const dayStore = db.createObjectStore('days', { keyPath: ['queue', 'userId'] });
      const writeStore = db.createObjectStore('writes', { keyPath: 'seq', autoIncrement: true });
      writeStore.createIndex('byOwner', ['queue', 'userId']);
      for (const day of days) await dayStore.put({ ...day, queue: 'driver' } as Schema['days']['value']);
      for (const write of writes) await writeStore.put({ shown: null, ...write, queue: 'driver' } as Stored);
    },
  }).catch((error: unknown) => {
    // A database that would not open may open on the next try, such as once another tab lets go of an old version.
    opening = null;
    throw error;
  });
  return opening;
}

export interface Kept<Day, Write, Shown> {
  userId: string | null;
  // The database has been read for this account.
  ready: boolean;
  // The database could not be read for this account. Nothing is sent or saved for it until a later read works, so a
  // write kept earlier is never passed by a newer one.
  failed: boolean;
  // The day the server last sent, or null when the phone has none.
  day: Day | null;
  // Waiting and refused writes, oldest first.
  queue: Queued<Write, Shown>[];
}

const OLDER_SHAPE: Refusal = { code: 'invalid_input', message: 'This record was kept by an older version of Wayfinder and cannot be sent.' };

// One queue's part of the phone: its account's day and records, read and kept in the database under its name.
export function keptStore<Day extends { appliedWriteIds: string[] }, Write extends { writeId: string }, Shown>(name: string, shapes: Shapes<Day, Write, Shown>) {
  type Entry = Queued<Write, Shown>;
  const bySeq = (a: Entry, b: Entry) => a.seq - b.seq;
  const owner = (userId: string): [string, string] => [name, userId];

  let kept: Kept<Day, Write, Shown> = { userId: null, ready: false, failed: false, day: null, queue: [] };
  const listeners = new Set<() => void>();

  function set(next: Kept<Day, Write, Shown>) {
    kept = next;
    for (const listener of listeners) listener();
  }

  const readKept = () => kept;

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function useKept() {
    return useSyncExternalStore(subscribe, readKept);
  }

  async function readAccount(userId: string) {
    const db = await database();
    const tx = db.transaction(['days', 'writes'], 'readonly');
    const [stored, writes] = await Promise.all([tx.objectStore('days').get(owner(userId)), tx.objectStore('writes').index('byOwner').getAll(owner(userId)), tx.done]);
    // A day kept by an older version of the app that no longer fits the shape is dropped; the next fetch brings one.
    const day = shapes.Day.safeParse(stored?.day);
    // A write that no longer fits the shape could not be sent or shown, so it waits under "Not accepted" instead. A copy
    // that no longer fits is dropped, and its write still goes.
    const queue = writes.map((entry): Entry => {
      const write = shapes.Write.safeParse(entry.write);
      const shown = shapes.Shown.safeParse(entry.shown);
      const record = { ...entry, seq: entry.seq!, shown: shown.success ? shown.data : null };
      return write.success ? { ...record, write: write.data } : { ...record, write: entry.write as Write, state: 'refused', refusal: entry.refusal ?? OLDER_SHAPE };
    }).sort(bySeq);
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
  function openAccount(userId: string) {
    set({ userId, ready: false, failed: false, day: null, queue: [] });
    return read(userId);
  }

  // Whether the account's records have been read, reading them again first when they could not be. The loop asks it
  // before every send and a save before every new action.
  function readFirst(userId: string): Promise<boolean> {
    if (kept.userId !== userId) return Promise.resolve(false);
    if (kept.ready) return Promise.resolve(true);
    return read(userId);
  }

  // Saves one action as the request it will send, with its copy to draw. It is in the database when this resolves, and
  // not at all when it throws, such as when the phone is out of storage.
  async function addWrite(userId: string, write: Write, about: string, savedAt: string, shown: Shown | null): Promise<Entry> {
    const db = await database();
    const stored: Stored = { queue: name, userId, write, about, savedAt, state: 'waiting', refusal: null, shown };
    const seq = await db.add('writes', stored);
    askToPersist();
    const entry: Entry = { ...stored, write, shown, seq };
    if (kept.userId === userId) set({ ...kept, queue: [...kept.queue, entry].sort(bySeq) });
    return entry;
  }

  // Keeps the day the server sent and, in the same transaction, takes off the queue every write the day lists as
  // applied (D-45). The screen keeps the day even when the database fails, and the view leaves listed writes out.
  async function keepDay(userId: string, day: Day) {
    const listed = new Set(day.appliedWriteIds);
    const done = (entry: { state: string; write: unknown }) => entry.state === 'waiting' && listed.has((entry.write as { writeId: string }).writeId);
    try {
      const db = await database();
      const tx = db.transaction(['days', 'writes'], 'readwrite');
      const writes = tx.objectStore('writes');
      const own = await writes.index('byOwner').getAll(owner(userId));
      await Promise.all([
        tx.objectStore('days').put({ queue: name, userId, day }),
        ...own.filter(done).map((entry) => writes.delete(entry.seq!)),
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
  async function refuseWrite(entry: Entry, refusal: Refusal) {
    const next: Entry = { ...entry, state: 'refused', refusal };
    const db = await database();
    await db.put('writes', next);
    if (kept.userId === entry.userId) set({ ...kept, queue: kept.queue.map((held) => (held.seq === entry.seq ? next : held)) });
  }

  // "Clear": the refused writes of this account go, the ones the screen showed, or only those named. One refused while
  // it cleared stays for the next Clear.
  async function clearRefused(userId: string, only?: readonly number[]) {
    const refused = new Set(kept.queue.filter((entry) => entry.userId === userId && entry.state === 'refused' && (!only || only.includes(entry.seq))).map((entry) => entry.seq));
    const db = await database();
    const tx = db.transaction('writes', 'readwrite');
    await Promise.all([...[...refused].map((seq) => tx.store.delete(seq)), tx.done]);
    if (kept.userId === userId) set({ ...kept, queue: kept.queue.filter((entry) => !refused.has(entry.seq)) });
  }

  return { readKept, useKept, openAccount, readFirst, addWrite, keepDay, refuseWrite, clearRefused };
}

let askedToPersist = false;

// The first save asks the browser to keep this storage rather than clear it when space runs low.
function askToPersist() {
  if (askedToPersist) return;
  askedToPersist = true;
  navigator.storage?.persist?.().catch((error: unknown) => console.warn('Could not ask to keep this phone\'s storage.', error));
}
