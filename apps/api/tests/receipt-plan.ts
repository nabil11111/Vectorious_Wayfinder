import { randomUUID } from 'node:crypto';
import { deliveryFigures, ReceiptWrite, StoreDeliveries, StoreDelivery, StoreOrderList, type DriverTrip, type OrderListName } from '@wayfinder/contracts';
import { expect } from 'vitest';
import { depotInstant } from '../src/lib/clock';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite, readyWalkthrough } from './driver-plan';
import { THU, type Agent, type Walkthrough } from './loading-plan';

// The day every receipt test starts from (spec 015, plan.md "Test plan"): the walkthroughs of specs 009, 010 and 012,
// then Dilshan's writes through the driver's endpoint, the start at 03:31, the arrival at Fresh Nugegoda at 03:34 and
// its delivery with a photo at 03:38, and, when asked, Wellawatte's refusal or closed shop at 03:48. The clock then
// reads Thu 08:30. Each test file mocks the clock itself and hands its setter in here with the agents it signed in once.

export interface ReceiptWalk extends Walkthrough { kasun: Agent; dilshan: Agent }

// Complete SOF and scan headers. The server checks a JPEG's structure without decoding its pixels.
export const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]);
export const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

export const at = (minute: number, date = THU) => depotInstant(date, minute);
export const HANDED_OVER = 3 * 60 + 38;
export const MORNING_DONE = 8 * 60 + 30;

// Up to Nugegoda handed over at 03:38, and Wellawatte's ending when asked, with the clock left at Thu 08:30. It answers
// VEH035's trip as the driver's last answer has it.
export async function deliveredWalkthrough(walk: ReceiptWalk, { wellawatte, stopAt, reason }: { wellawatte?: 'refused' | 'closed'; stopAt?: 'arrived'; reason?: 'short' | 'wont_fit' } = {}): Promise<DriverTrip> {
  await readyWalkthrough(walk, { reason });
  const driver = driverScreen(walk.dilshan);
  const send = async (trip: DriverTrip, kind: ReceiptWriteKind, minute: number, seq?: number, more: object = {}) => {
    walk.freeze(THU, minute);
    return answeredTrip(await driver.send(driverWrite(trip, kind, at(minute).toISOString(), seq, more)));
  };
  let trip = driverTrip(await driver.read());
  trip = await send(trip, 'start', 3 * 60 + 31);
  trip = await send(trip, 'arrive', 3 * 60 + 34, 1);
  if (stopAt !== 'arrived') trip = await send(trip, 'deliver', HANDED_OVER, 1, { photo });
  if (wellawatte) {
    trip = await send(trip, 'arrive', 3 * 60 + 45, 2);
    const chilled = driverStop(trip, 2).lines.find((line) => line.temp === 'chilled')!;
    trip = await send(trip, wellawatte === 'refused' ? 'refuse' : 'closed', 3 * 60 + 48, 2, wellawatte === 'refused'
      ? { reason: 'damaged', note: '2 crushed at the bottom', lines: [{ lineId: chilled.lineId, refused: 2 }] }
      : { note: 'Lights off, gate locked' });
  }
  walk.freeze(THU, MORNING_DONE);
  return trip;
}
type ReceiptWriteKind = Parameters<typeof driverWrite>[1];

// The shop's screens: its deliveries, one delivery by its stop, and a receipt as the phone sends it.
export function shopScreen(agent: Agent) {
  return {
    async read(): Promise<StoreDeliveries> {
      const res = await agent.get('/api/v1/store/deliveries');
      expect(res.status).toBe(200);
      return StoreDeliveries.parse(res.body);
    },
    async one(stopId: string): Promise<StoreDelivery> {
      const res = await agent.get(`/api/v1/store/deliveries/${stopId}`);
      expect(res.status).toBe(200);
      return StoreDelivery.parse(res.body);
    },
    async list(name: OrderListName): Promise<StoreOrderList> {
      const res = await agent.get('/api/v1/store/orders').query({ list: name });
      expect(res.status).toBe(200);
      return StoreOrderList.parse(res.body);
    },
    send: (write: object) => agent.post('/api/v1/store/receipts').send(write),
  };
}

// A receipt as the phone makes it from the delivery on screen: every line counted, the stop's revision, the app clock
// as the phone knows it (the walkthrough's 08:31 unless told), Yes to the cold check when a chilled line came, and what
// the test adds.
export function receiptOf(delivery: StoreDelivery, counts: number[], more: Partial<Omit<ReceiptWrite, 'kind' | 'stopId' | 'lines'>> = {}): ReceiptWrite {
  return ReceiptWrite.parse({
    kind: 'receipt', writeId: randomUUID(), stopId: delivery.stopId, at: at(8 * 60 + 31).toISOString(), revision: delivery.revision,
    lines: delivery.lines.map((line, i) => ({ lineId: line.lineId, received: counts[i] })),
    cold: deliveryFigures(delivery).chilled ? true : null, reason: null, ...more,
  });
}
