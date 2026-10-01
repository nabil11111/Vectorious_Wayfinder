import { z } from 'zod';
import { DriverDay, DriverWrite, phoneView } from '@wayfinder/contracts';
import { createPhoneQueue } from '@/lib/phone/queue';
import type { Queued as PhoneRecord } from '@/lib/phone/store';

// The driver's queue (spec 013, rule 10, D-45): the shared phone queue with the driver's parts. Its day is GET /driver
// and its writes go to POST /driver/writes; the query ['driver'] brings the live stream's driver messages; the view is
// phoneView. A record carries no copy to draw: "Not accepted" names it by its about line, "Stop 2 · Fresh Wellawatte".

// A stop with something waiting is one record, and the trip's start and its end are one each, as the design's bar
// counts deliveries (rule 12).
export const recordOf = (write: DriverWrite) => ('stopId' in write ? `stop:${write.stopId}` : `${write.kind}:${write.tripId}`);

export type Queued = PhoneRecord<DriverWrite, null>;

// "Wellawatte" for a stop, "the start of the trip" and "the end of the trip" for the trip's own records.
function placeOf(entry: Queued) {
  if (entry.write.kind === 'start') return 'the start of the trip';
  if (entry.write.kind === 'finish') return 'the end of the trip';
  const shop = entry.about.split(' · ')[1] ?? entry.about;
  return shop.includes(' ') ? shop.slice(shop.indexOf(' ') + 1) : shop;
}

export const driverQueue = createPhoneQueue({
  name: 'driver',
  dayPath: '/driver',
  writePath: '/driver/writes',
  key: ['driver'],
  shapes: { Day: DriverDay, Write: DriverWrite, Shown: z.null() },
  view: phoneView,
  accountOf: (day) => day.driverId,
  recordOf,
  // The green "Back online" line belongs to the trip of the records it names, and shows only on that trip (Q-30). The
  // next stop done on the road ends it, and so does checking the trip in.
  backOnline: {
    placeOf,
    belongsTo: (write) => write.tripId,
    closedBy: (write) => write.kind === 'deliver' || write.kind === 'refuse' || write.kind === 'closed' || write.kind === 'finish',
  },
});

export const {
  readKept, useKept, useSync, useOwner, waitingOf, setAccount, readAgain, fetchNow, retrySync, clearRefused, closeBackOnline,
} = driverQueue;
export const useDriverQuery = driverQueue.useQueueQuery;

// Saves one action on the phone before the screen moves on (rule 10).
export const saveAction = (write: DriverWrite, about: string) => driverQueue.saveAction(write, about, null);

// A button's save, one at a time.
export function useSave() {
  const { save, saving, failed } = driverQueue.useSave();
  return { save: (write: DriverWrite, about: string) => save(write, about, null), saving, failed };
}
