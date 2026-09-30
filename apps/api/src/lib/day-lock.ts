import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { demoDay, depots } from '../db/schema';
import { demoClockAt, now, realNow } from './clock';
import { config } from './config';

// Step 1 of every write that plans or loads (specs 010 and 012), in one place so both take the same locks in the same
// order. In demo mode the demo_day row is taken for share: a reset takes it for update first, so a reset and these
// writes take turns and never deadlock. The clock is read from that locked row only once every lock is held, so a
// write is judged at the moment it got its turn, not the moment it was sent.
export interface DayMoment { at: Date; demoDay: number }

async function lockClockRow(tx: Tx) {
  if (!config.DEMO_MODE) return null;
  const [row] = await tx.select().from(demoDay).for('share');
  if (!row) throw new Error('The demo day has no clock row. Run the seed first.');
  return row;
}

const momentOf = (row: Awaited<ReturnType<typeof lockClockRow>>): DayMoment =>
  row ? { at: new Date(demoClockAt(row, realNow()).now), demoDay: row.day } : { at: now(), demoDay: 1 };

// The day's lock alone, for a write that works on one truck or one problem (spec 012's loader writes and answers).
export async function lockDay(tx: Tx): Promise<DayMoment> {
  return momentOf(await lockClockRow(tx));
}

// The day's lock, then the depot's row for no key update: every plan write and a truck's start queue one behind the
// other, so a plan cannot go back to edit while its first truck starts loading (D-33). null when there is no such
// depot.
export async function lockDepotDay(tx: Tx, depotId: string): Promise<DayMoment | null> {
  const row = await lockClockRow(tx);
  const [depot] = await tx.select({ id: depots.id }).from(depots).where(eq(depots.id, depotId)).for('no key update');
  return depot ? momentOf(row) : null;
}
