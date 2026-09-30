import { createHash } from 'node:crypto';
import { DEMO_DAY } from '@wayfinder/contracts';
import { realNow } from '../lib/clock';
import { config } from '../lib/config';
import { db, type Db, type Tx } from './client';
import { demoDay } from './schema';

// The seeded delivery day (spec 008): Thu 25 Jun 2026 from Peliyagoda, written once in demo mode. Each later
// piece adds its own block of records to seedDemoDay, so a reset brings them back too.
//
// The names, the clock row and demoId are here so other pieces can build on them. The day itself (the
// orders, the drafts, the plans with their deferrals, the workshop rows and the fuel rows) and clearDemoDay
// are task T3 of spec 008.

// The same id for the same seeded row on every machine and after every reset, so a test or a later seed can
// point at "OUT002's chilled order for Thursday": demoId('order', '2026-06-25:OUT002:chilled'). It is a
// SHA-1 of "kind:key" shaped as a UUID.
export function demoId(kind: string, key: string): string {
  const bytes = Buffer.from(createHash('sha1').update(`${kind}:${key}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Writes the seeded day and says whether it wrote it. It does nothing when demo mode is off or when the day
// is already written. It runs in one transaction, so it is all or nothing. Handed a transaction, as the
// reset does, that becomes a savepoint inside it.
export async function seedDemoDay(on: Db | Tx = db): Promise<boolean> {
  if (!config.DEMO_MODE) return false;
  return on.transaction(async (tx) => {
    // The clock, when there is none yet: the first part's start, set at this moment.
    await tx.insert(demoDay).values({ clockBase: new Date(DEMO_DAY.parts[0].at), clockSetAt: realNow() }).onConflictDoNothing();
    // T3: stop here when seeded_at is set. Otherwise write the day, set seeded_at and return true.
    return false;
  });
}

// Removes the day: every order and plan with all that hangs off them, the fuel rows, the workshop rows and
// the note that the day was written. It leaves the clock row alone. The reset calls it before it writes the
// day again, and the seed's tests call it inside a transaction they roll back.
export async function clearDemoDay(_tx: Tx): Promise<void> {
  throw new Error('clearDemoDay is not built yet (spec 008, task T3).');
}
