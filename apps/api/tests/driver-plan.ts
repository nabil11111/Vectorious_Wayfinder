import { randomUUID } from 'node:crypto';
import { DriverDay, DriverWrite, type DriverTrip, type DriverStop, type DriverWriteKind, type LoadingTruck } from '@wayfinder/contracts';
import type request from 'supertest';
import { expect } from 'vitest';
import { db } from '../src/db/client';
import { driverWrites, photos } from '../src/db/schema';
import {
  answeredTruck, answerFlag, dryLine, heldRows, loaderScreen, sendWalkthroughPlan, THU, truckOf,
  type Agent, type Walkthrough,
} from './loading-plan';

// The three walkthroughs through the APIs: Nadeesha places, Ruwan sends, Kasun loads with one dry carton short,
// Ruwan accepts the shortage, and Kasun marks VEH035 ready at 02:36. The driver's clock starts at 03:30.
export async function readyWalkthrough(walk: Walkthrough & { kasun: Agent }, options: { withVeh004?: boolean } = {}): Promise<LoadingTruck> {
  await sendWalkthroughPlan(walk, options);
  const loader = loaderScreen(walk.kasun);
  const day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  walk.freeze(THU, 2 * 60 + 31);
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  walk.freeze(THU, 2 * 60 + 33);
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 3 }], { note: 'Only 3 dry cartons in the store' }), 'VEH035');
  walk.freeze(THU, 2 * 60 + 34);
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  walk.freeze(THU, 2 * 60 + 35);
  await answerFlag(walk.ruwan, truck.issues[0]!.id, 'go_short');
  truck = truckOf(await loader.read(), 'VEH035');
  walk.freeze(THU, 2 * 60 + 36);
  truck = answeredTruck(await loader.ready(truck), 'VEH035');
  walk.freeze(THU, 3 * 60 + 30);
  return truck;
}

export function driverTrip(day: DriverDay, vehicleId = 'VEH035', tripNo = 1): DriverTrip {
  const trip = day.trips.find(trip => trip.vehicleId === vehicleId && trip.tripNo === tripNo);
  if (!trip) throw new Error(`${vehicleId} trip ${tripNo} is not on the driver's day.`);
  return trip;
}
export function driverStop(trip: DriverTrip, seq: number): DriverStop {
  const stop = trip.stops.find(stop => stop.seq === seq);
  if (!stop) throw new Error(`${trip.vehicleId} has no stop ${seq}.`);
  return stop;
}
export function answeredDay(res: request.Response): DriverDay {
  expect(res.status).toBe(200);
  return DriverDay.parse(res.body);
}
export const answeredTrip = (res: request.Response, vehicleId = 'VEH035', tripNo = 1) => driverTrip(answeredDay(res), vehicleId, tripNo);

export function driverScreen(agent: Agent) {
  return {
    async read(): Promise<DriverDay> { return answeredDay(await agent.get('/api/v1/driver')); },
    send: (write: object) => agent.post('/api/v1/driver/writes').send(write),
  };
}
// Build the exact request from the day the phone has seen. Deliberately invalid tests can alter it before send.
export function driverWrite(trip: DriverTrip, kind: DriverWriteKind, at: string, seq?: number, more: object = {}): DriverWrite {
  const stop = seq === undefined ? undefined : driverStop(trip, seq);
  return DriverWrite.parse({ writeId: randomUUID(), tripId: trip.tripId, kind, at, revision: stop?.revision ?? trip.revision,
    ...(stop ? { stopId: stop.id } : {}), ...more });
}
export async function heldDriverRows() {
  return { ...await heldRows(), writes: await db.select().from(driverWrites).orderBy(driverWrites.id), photos: await db.select().from(photos).orderBy(photos.id) };
}
