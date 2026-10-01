import { OperationsDay, type DriverTrip, type DriverWrite, type IssueDecision } from '@wayfinder/contracts';
import { expect } from 'vitest';
import { depotInstant } from '../src/lib/clock';
import { answeredTrip, driverScreen, driverTrip, driverWrite, readyWalkthrough } from './driver-plan';
import { THU, type Agent, type Walkthrough } from './loading-plan';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
  0xff, 0xda, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 0, 0xff, 0xd9]);
export const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
export const FRI = '2026-06-26';
export async function operations(agent: Agent): Promise<OperationsDay> {
  const res = await agent.get('/api/v1/operations');
  expect(res.status).toBe(200);
  return OperationsDay.parse(res.body);
}
export function shownTrip(day: OperationsDay, vehicleId = 'VEH035') {
  const trip = day.groups.flatMap(group => group.trips).find(trip => trip.vehicleId === vehicleId);
  if (!trip?.detailRecorded) throw new Error(`${vehicleId} needs recorded detail in this test.`);
  return trip;
}
export async function decide(agent: Agent, issueId: string, decision: IssueDecision) {
  const res = await agent.post(`/api/v1/issues/${issueId}/decide`).send({ revision: 0, decision });
  expect(res.status).toBe(200);
}
export function journey(walk: Walkthrough & { kasun: Agent; dilshan: Agent }) {
  const driver = driverScreen(walk.dilshan);
  const write = async (trip: DriverTrip, kind: DriverWrite['kind'], minute: number, seq?: number, more: object = {}, date = THU) => {
    walk.freeze(date, minute);
    return answeredTrip(await driver.send(driverWrite(trip, kind, depotInstant(date, minute).toISOString(), seq, more)));
  };
  const ready = async () => { await readyWalkthrough(walk); return driverTrip(await driver.read()); };
  const started = async () => write(await ready(), 'start', 211);
  const wellawatte = async () => {
    let trip = await started();
    trip = await write(trip, 'arrive', 214, 1);
    trip = await write(trip, 'deliver', 218, 1, { photo });
    return write(trip, 'arrive', 225, 2);
  };
  return { driver, ready, write, started, wellawatte };
}
