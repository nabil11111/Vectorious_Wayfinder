import { NotificationList, PlanBoard, type Notification } from '@wayfinder/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, orderLines, orders } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { answeredTrip, driverScreen, driverStop, driverTrip, driverWrite } from './driver-plan';
import { answeredTruck, answerFlag, code, dryLine, loaderScreen, placeWalkthroughDraft, resetDay, sendThursdaysPlan, sendWalkthroughPlan, signIn, THU, truckOf, WED, type Agent } from './loading-plan';
import { photo, receiptOf, shopScreen } from './receipt-plan';
import { serve, stop } from './serve';

// Spec 025: every role's updates, read from the records the app already keeps at their own times (AC-1), and what each
// walkthrough person's bell shows after each step of the README's walkthrough on the seeded day (AC-4).

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const at = depotInstant(date, minute); testClock.at = at.toISOString(); setClockForTests(at); };
const at = (minute: number, date = THU) => depotInstant(date, minute);

const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
let addresses = 0;
const agent = () => request.agent(server).set('X-Forwarded-For', `192.0.2.${100 + ++addresses}`);
const nadeesha = agent();
const ruwan = agent();
const kasun = agent();
const dilshan = agent();
// Fresh Wellawatte's manager (OUT002), Style Liberty Plaza's (OUT017), and Kandy's loader and a Kandy driver.
const chamari = agent();
const ishara = agent();
const sarath = agent();
const prasanna = agent();
const admin = agent();
const walk = { nadeesha, ruwan, kasun, freeze };
const loader = loaderScreen(kasun);
const driver = driverScreen(dilshan);
let originalClock: typeof demoDay.$inferSelect;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [who, username] of [[nadeesha, 'nadeesha'], [ruwan, 'ruwan'], [kasun, 'kasun'], [dilshan, 'dilshan'], [chamari, 'chamari'], [ishara, 'ishara'],
    [sarath, 'sarath'], [prasanna, 'prasanna'], [admin, 'admin']] as const) await signIn(who, username);
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 15 * 60);
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

async function updatesOf(who: Agent, query: Record<string, string> = {}): Promise<Notification[]> {
  const res = await who.get('/api/v1/notifications').query(query);
  expect(res.status, JSON.stringify(res.body.error)).toBe(200);
  return NotificationList.parse(res.body).items;
}
// What a row shows: its time on the app clock and its line.
const rows = async (who: Agent, query?: Record<string, string>) => (await updatesOf(who, query)).map((item) => `${item.time} · ${item.line}`);

it('AC-1 AC-4 on a fresh install, Nadeesha\'s bell holds Wednesday\'s updates and nobody else\'s, and the others\' are empty', async () => {
  expect(await rows(nadeesha)).toEqual([
    'Tue 23 Jun 17:00 · 12 chilled cartons will not come on Wed 24 Jun: The fridge van was full.',
    'Tue 23 Jun 08:05 · Your order is placed: 12 chilled cartons for Wed 24 Jun',
    'Tue 23 Jun 08:05 · Your order is placed: 6 dry cartons for Wed 24 Jun',
  ]);
  const [moved, placed] = await updatesOf(nadeesha);
  // The order that waited was placed for Wednesday, and Wednesday's plan left it out.
  expect(moved).toMatchObject({ kind: 'order_moved', tone: 'warn', link: '/store/orders', at: depotInstant('2026-06-23', 17 * 60).toISOString() });
  expect(placed).toMatchObject({ kind: 'order_placed', tone: 'good', link: '/store/orders', issueKind: null, decision: null, answer: null });
  // A shop's own: Fresh Wellawatte's Thursday orders came in on Wednesday morning, before the clock starts.
  expect(await rows(chamari)).toEqual([
    '08:10 · Your order is placed: 46 dry cartons for Thu 25 Jun',
    '08:10 · Your order is placed: 48 chilled cartons for Thu 25 Jun',
  ]);
  // The demo day they belong to comes with them, so a browser keeps what was seen per day and a reset starts afresh.
  const [clock] = await db.select().from(demoDay);
  expect(NotificationList.parse((await nadeesha.get('/api/v1/notifications')).body).demoDay).toBe(clock!.day);
  // Wednesday's seeded plan has no trucks, so it is nothing for the dock or a driver.
  for (const who of [ruwan, kasun, dilshan, sarath, prasanna, admin]) expect(await updatesOf(who)).toEqual([]);
});

it('AC-4 each walkthrough person\'s bell after each step of the walkthrough', async () => {
  // 1. Nadeesha places her draft at 15:30.
  await placeWalkthroughDraft(walk);
  expect(await rows(nadeesha)).toEqual([
    '15:30 · Your order is placed: 4 dry cartons for Thu 25 Jun',
    '15:30 · Your order is placed: 8 chilled cartons for Thu 25 Jun',
    'Tue 23 Jun 17:00 · 12 chilled cartons will not come on Wed 24 Jun: The fridge van was full.',
    'Tue 23 Jun 08:05 · Your order is placed: 12 chilled cartons for Wed 24 Jun',
    'Tue 23 Jun 08:05 · Your order is placed: 6 dry cartons for Wed 24 Jun',
  ]);
  for (const who of [ruwan, kasun, dilshan]) expect(await updatesOf(who)).toEqual([]);

  // 2 to 6. Orders close at 16:00, and Ruwan sends Thursday's plan: VEH035 to Nugegoda and Wellawatte, Dilshan driving.
  // From 16:00 the day being worked is Thursday, so Wednesday's updates leave the bell.
  const board = await sendThursdaysPlan(walk);
  freeze(WED, 16 * 60 + 5);
  const nadeeshaSees = [
    '16:00 · Thursday\'s delivery is planned: Dilshan\'s reefer van, window 05:00 to 07:30',
    '15:30 · Your order is placed: 4 dry cartons for Thu 25 Jun',
    '15:30 · Your order is placed: 8 chilled cartons for Thu 25 Jun',
  ];
  expect(await rows(nadeesha)).toEqual(nadeeshaSees);
  expect((await updatesOf(nadeesha))[0]).toMatchObject({ kind: 'delivery_planned', link: '/store', tone: 'info' });
  const kasunSees = ['16:00 · Thursday\'s plan is out: 1 truck to load'];
  expect(await rows(kasun)).toEqual(kasunSees);
  expect((await updatesOf(kasun))[0]).toMatchObject({ kind: 'plan_out', link: '/loader' });
  const dilshanSees = ['16:00 · Your trip for Thursday is sent: VEH035 leaves 04:36 with 2 stops'];
  expect(await rows(dilshan)).toEqual(dilshanSees);
  expect((await updatesOf(dilshan))[0]).toMatchObject({ kind: 'trip_sent', link: '/driver' });
  const ruwanSees: string[] = [];
  expect(await rows(ruwan)).toEqual(ruwanSees);
  // The orders the plan left out are their shops' news, with the reason Ruwan gave.
  expect(await rows(ishara)).toEqual([
    '16:00 · 135 boxes will not come on Thu 25 Jun: Scheduled for a later run.',
    '09:25 · Your order is placed: 135 boxes for Thu 25 Jun',
  ]);
  expect(board.plan.status).toBe('published');

  // 8 and 9. Loading at 02:30: Kasun loads stop 2 and flags Nugegoda's dry cartons 1 short at 02:33. From here
  // Wednesday's times carry their day.
  freeze(THU, 2 * 60 + 30);
  for (const list of [nadeeshaSees, kasunSees, dilshanSees]) list.splice(0, list.length, ...list.map((row) => `Wed 24 Jun ${row}`));
  const day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  freeze(THU, 2 * 60 + 31);
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  freeze(THU, 2 * 60 + 33);
  truck = answeredTruck(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 3 }], { note: 'Only 3 dry cartons in the store' }), 'VEH035');
  const flagId = truck.issues[0]!.id;
  ruwanSees.unshift('02:33 · Kasun flagged 1 dry carton short for Fresh Nugegoda on Dilshan\'s reefer van');
  expect(await rows(ruwan)).toEqual(ruwanSees);
  expect((await updatesOf(ruwan))[0]).toMatchObject({ id: `problem:${flagId}`, kind: 'problem', issueKind: 'loading', tone: 'bad', link: `/dispatcher/live?issue=${flagId}` });
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 10. Ruwan keeps Go short at 02:35, and Kasun is told.
  freeze(THU, 2 * 60 + 34);
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  freeze(THU, 2 * 60 + 35);
  await answerFlag(ruwan, flagId, 'go_short');
  kasunSees.unshift('02:35 · Ruwan answered on VEH035: Go with 1 dry carton short for Fresh Nugegoda.');
  expect(await rows(kasun)).toEqual(kasunSees);
  expect((await updatesOf(kasun))[0]).toMatchObject({ kind: 'flag_answered', decision: 'go_short', link: `/loader/trucks/${truck.tripId}` });
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [ruwan, ruwanSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 11. Kasun marks VEH035 ready at 02:36: Ruwan and Dilshan hear it.
  freeze(THU, 2 * 60 + 36);
  truck = answeredTruck(await loader.ready(truckOf(await loader.read(), 'VEH035')), 'VEH035');
  ruwanSees.unshift('02:36 · Dilshan\'s reefer van is loaded and ready: 117 of 118 on, 1 short');
  dilshanSees.unshift('02:36 · VEH035 is loaded and ready: 117 of 118 on, 1 short');
  expect(await rows(ruwan)).toEqual(ruwanSees);
  expect((await updatesOf(ruwan))[0]).toMatchObject({ kind: 'truck_ready', tone: 'good', link: `/dispatcher/live?trip=${truck.tripId}` });
  expect(await rows(dilshan)).toEqual(dilshanSees);
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [kasun, kasunSees]] as const) expect(await rows(who)).toEqual(sees);

  // 12. Dilshan starts the trip at 03:31: the truck has left, for the shop and the dispatcher.
  const send = async (kind: Parameters<typeof driverWrite>[1], minute: number, seq?: number, more: object = {}) => {
    freeze(THU, minute);
    return answeredTrip(await driver.send(driverWrite(driverTrip(await driver.read()), kind, at(minute).toISOString(), seq, more)));
  };
  await send('start', 3 * 60 + 31);
  nadeeshaSees.unshift('03:31 · Dilshan\'s reefer van left the depot: you are stop 1 of 2');
  ruwanSees.unshift('03:31 · Dilshan\'s reefer van left the depot with 2 stops');
  expect(await rows(nadeesha)).toEqual(nadeeshaSees);
  expect((await updatesOf(nadeesha))[0]).toMatchObject({ kind: 'truck_left', link: '/store' });
  expect(await rows(ruwan)).toEqual(ruwanSees);
  for (const [who, sees] of [[kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 13. He arrives at Fresh Nugegoda at 03:34 and hands over 20 chilled and 3 dry cartons at 03:38.
  await send('arrive', 3 * 60 + 34, 1);
  nadeeshaSees.unshift('03:34 · Dilshan has arrived');
  expect(await rows(nadeesha)).toEqual(nadeeshaSees);
  let trip = await send('deliver', 3 * 60 + 38, 1, { photo });
  const nugegoda = driverStop(trip, 1);
  nadeeshaSees.unshift('03:38 · Dilshan delivered 20 chilled and 3 dry cartons. Confirm what you received.');
  expect(await rows(nadeesha)).toEqual(nadeeshaSees);
  expect((await updatesOf(nadeesha))[0]).toMatchObject({ id: `delivered:${nugegoda.id}`, kind: 'delivered', tone: 'good', link: `/store/deliveries/${nugegoda.id}` });
  for (const [who, sees] of [[ruwan, ruwanSees], [kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 14 and 15. Fresh Wellawatte refuses 2 damaged chilled cartons at 03:48.
  await send('arrive', 3 * 60 + 45, 2);
  trip = driverTrip(await driver.read());
  const chilled = driverStop(trip, 2).lines.find((line) => line.temp === 'chilled')!;
  trip = await send('refuse', 3 * 60 + 48, 2, { reason: 'damaged', note: '2 crushed at the bottom', lines: [{ lineId: chilled.lineId, refused: 2 }] });
  const refusal = trip.problems[0]!;
  ruwanSees.unshift('03:48 · Fresh Wellawatte refused 2 chilled cartons from Dilshan\'s reefer van: damaged');
  expect(await rows(ruwan)).toEqual(ruwanSees);
  expect((await updatesOf(ruwan))[0]).toMatchObject({ kind: 'problem', issueKind: 'refused', link: `/dispatcher/live?issue=${refusal.id}` });
  expect((await rows(chamari)).slice(0, 2)).toEqual(['03:48 · Dilshan delivered 92 of 94 cartons, with 2 refused', '03:45 · Dilshan has arrived']);
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 16. Ruwan answers Bring them back at 03:52: Dilshan's glanceable answer.
  freeze(THU, 3 * 60 + 52);
  const open = (await ruwan.get('/api/v1/issues')).body.issues.find((issue: { id: string }) => issue.id === refusal.id);
  expect((await ruwan.post(`/api/v1/issues/${refusal.id}/decide`).send({ revision: open.revision, decision: 'bring_back' })).status).toBe(200);
  dilshanSees.unshift('03:52 · Ruwan answered: Bring the 2 chilled cartons back to Peliyagoda.');
  expect(await rows(dilshan)).toEqual(dilshanSees);
  expect((await updatesOf(dilshan))[0]).toMatchObject({
    id: `answer:${refusal.id}`, kind: 'problem_answered', decision: 'bring_back', link: '/driver',
    answer: { short: 'Bring back · 2 chilled', by: 'Ruwan', sentence: 'Bring the 2 chilled cartons back to Peliyagoda.' },
  });
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [ruwan, ruwanSees], [kasun, kasunSees]] as const) expect(await rows(who)).toEqual(sees);

  // 17. Back at the depot at 04:20.
  await send('finish', 4 * 60 + 20);
  ruwanSees.unshift('04:20 · Dilshan\'s reefer van is back at the depot: 2 of 2 stops done');
  expect(await rows(ruwan)).toEqual(ruwanSees);
  expect((await updatesOf(ruwan))[0]).toMatchObject({ kind: 'truck_back', tone: 'good' });
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 19 and 20. Nadeesha's receipt, made at 08:31 and sent at 08:33, reports 1 chilled carton missing.
  freeze(THU, 8 * 60 + 33);
  const shop = shopScreen(nadeesha);
  const delivery = (await shop.read()).deliveries.find((each) => each.stopId === nugegoda.id)!;
  const write = receiptOf(delivery, [11, 8, 3], { reason: 'missing' });
  expect((await shop.send(write)).status).toBe(200);
  ruwanSees.unshift('08:31 · Nadeesha reported 1 chilled carton missing at Fresh Nugegoda');
  expect(await rows(ruwan)).toEqual(ruwanSees);
  expect((await updatesOf(ruwan))[0]).toMatchObject({ kind: 'problem', issueKind: 'receipt', link: `/dispatcher/live?issue=${write.writeId}` });
  for (const [who, sees] of [[nadeesha, nadeeshaSees], [kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // 21 and 22. Ruwan sends 1 replacement on Fri 26 Jun at 08:35, and Nadeesha is told.
  freeze(THU, 8 * 60 + 35);
  const report = (await ruwan.get('/api/v1/issues')).body.issues.find((issue: { id: string }) => issue.id === write.writeId);
  expect((await ruwan.post(`/api/v1/issues/${write.writeId}/decide`).send({ revision: report.revision, decision: 'send_replacements' })).status).toBe(200);
  nadeeshaSees.unshift('08:35 · The depot answered your report, 1 chilled carton missing: a replacement comes on Fri 26 Jun');
  expect(await rows(nadeesha)).toEqual(nadeeshaSees);
  expect((await updatesOf(nadeesha))[0]).toMatchObject({ kind: 'report_answered', decision: 'send_replacements', link: `/store/deliveries/${nugegoda.id}` });
  for (const [who, sees] of [[ruwan, ruwanSees], [kasun, kasunSees], [dilshan, dilshanSees]] as const) expect(await rows(who)).toEqual(sees);

  // A reset brings the seeded day's updates back, and nothing of the walkthrough.
  await resetDay();
  await initClock();
  freeze(WED, 15 * 60);
  expect(await rows(nadeesha)).toEqual([
    'Tue 23 Jun 17:00 · 12 chilled cartons will not come on Wed 24 Jun: The fridge van was full.',
    'Tue 23 Jun 08:05 · Your order is placed: 12 chilled cartons for Wed 24 Jun',
    'Tue 23 Jun 08:05 · Your order is placed: 6 dry cartons for Wed 24 Jun',
  ]);
  for (const who of [ruwan, kasun, dilshan]) expect(await updatesOf(who)).toEqual([]);
});

it('A3 retains the ready-time loading count after a full refusal and a closed-shop return', async () => {
  await sendWalkthroughPlan(walk);
  const day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  await loader.ready(truck);
  const before = async (who: Agent) => (await updatesOf(who)).find((item) => item.kind === 'truck_ready');
  const dispatchReady = await before(ruwan);
  const driverReady = await before(dilshan);
  const send = async (kind: Parameters<typeof driverWrite>[1], minute: number, seq?: number, more: object = {}) => {
    freeze(THU, minute);
    return answeredTrip(await driver.send(driverWrite(driverTrip(await driver.read()), kind, at(minute).toISOString(), seq, more)));
  };
  await send('start', 211);
  await send('arrive', 214, 1);
  let trip = driverTrip(await driver.read());
  trip = await send('refuse', 218, 1, { reason: 'damaged', note: '', lines: driverStop(trip, 1).lines.map((line) => ({ lineId: line.lineId, refused: line.loaded! })) });
  await send('arrive', 225, 2);
  trip = await send('closed', 228, 2, { note: 'Gate locked' });
  for (const problem of trip.problems) {
    const open = (await ruwan.get('/api/v1/issues')).body.issues.find((issue: { id: string }) => issue.id === problem.id);
    expect((await ruwan.post(`/api/v1/issues/${problem.id}/decide`).send({ revision: open.revision, decision: 'bring_back' })).status).toBe(200);
  }
  await send('finish', 260);
  expect(await before(ruwan)).toEqual(dispatchReady);
  expect(await before(dilshan)).toEqual(driverReady);
});

it('AC-1 a closed shop: the shop and the dispatcher are told, and the driver\'s answer to try again is short', async () => {
  await sendWalkthroughPlan(walk);
  const day = await loader.read();
  let truck = answeredTruck(await loader.start(truckOf(day, 'VEH035'), day.plan!), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 2), 'VEH035');
  truck = answeredTruck(await loader.stopLoaded(truck, 1), 'VEH035');
  answeredTruck(await loader.ready(truck), 'VEH035');
  const send = async (kind: Parameters<typeof driverWrite>[1], minute: number, seq?: number, more: object = {}) => {
    freeze(THU, minute);
    return answeredTrip(await driver.send(driverWrite(driverTrip(await driver.read()), kind, at(minute).toISOString(), seq, more)));
  };
  await send('start', 3 * 60 + 31);
  await send('arrive', 3 * 60 + 34, 1);
  await send('deliver', 3 * 60 + 38, 1, { photo });
  await send('arrive', 3 * 60 + 45, 2);
  const trip = await send('closed', 3 * 60 + 48, 2, { note: 'Lights off, gate locked' });
  const closed = trip.problems[0]!;
  expect((await rows(chamari)).slice(0, 2)).toEqual(['03:48 · Dilshan found the shop closed: 48 chilled and 46 dry cartons not delivered', '03:45 · Dilshan has arrived']);
  expect((await updatesOf(chamari))[0]).toMatchObject({ kind: 'shop_closed', tone: 'bad', link: '/store' });
  expect((await rows(ruwan))[0]).toBe('03:48 · Nobody at Fresh Wellawatte: 48 chilled and 46 dry cartons still on Dilshan\'s reefer van');
  freeze(THU, 3 * 60 + 50);
  const open = (await ruwan.get('/api/v1/issues')).body.issues.find((issue: { id: string }) => issue.id === closed.id);
  expect((await ruwan.post(`/api/v1/issues/${closed.id}/decide`).send({ revision: open.revision, decision: 'try_again' })).status).toBe(200);
  expect((await updatesOf(dilshan))[0]).toMatchObject({
    time: '03:50', line: 'Ruwan answered: Try Fresh Wellawatte again after the other stops.', decision: 'try_again',
    answer: { short: 'Try again · Fresh Wellawatte', by: 'Ruwan', sentence: 'Try Fresh Wellawatte again after the other stops.' },
  });
  // Try again cleared the stop's arrival, and the closed attempt keeps its own time and count.
  expect(await rows(chamari)).toEqual([
    '03:48 · Dilshan found the shop closed: 48 chilled and 46 dry cartons not delivered',
    '03:31 · Dilshan\'s reefer van left the depot: you are stop 2 of 2',
    'Wed 24 Jun 16:00 · Thursday\'s delivery is planned: Dilshan\'s reefer van, window 05:30 to 08:00',
    'Wed 24 Jun 08:10 · Your order is placed: 46 dry cartons for Thu 25 Jun',
    'Wed 24 Jun 08:10 · Your order is placed: 48 chilled cartons for Thu 25 Jun',
  ]);
});

it('AC-1 a plan taken back and sent again: the dock hears each, and the shop and the driver see the plan as it stands', async () => {
  const sent = await sendWalkthroughPlan(walk);
  freeze(WED, 16 * 60 + 10);
  const back = await ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision });
  expect(back.status).toBe(200);
  expect(await rows(kasun)).toEqual(['16:10 · Thursday\'s plan was taken back to edit. Wait for it to be sent again.', '16:00 · Thursday\'s plan is out']);
  expect((await updatesOf(kasun))[0]).toMatchObject({ kind: 'plan_taken_back', tone: 'warn', link: '/loader' });
  // The plan as it stands has no trip for Dilshan and no delivery for Nadeesha.
  expect(await updatesOf(dilshan)).toEqual([]);
  expect((await rows(nadeesha))[0]).toBe('15:30 · Your order is placed: 4 dry cartons for Thu 25 Jun');
  freeze(WED, 16 * 60 + 20);
  const draft = PlanBoard.parse(back.body);
  const again = await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: draft.plan.id, revision: draft.plan.revision });
  expect(again.status).toBe(200);
  expect(await rows(kasun)).toEqual([
    '16:20 · Thursday\'s plan changed: 1 truck to load',
    '16:10 · Thursday\'s plan was taken back to edit. Wait for it to be sent again.',
    '16:00 · Thursday\'s plan is out',
  ]);
  expect((await updatesOf(kasun))[0]).toMatchObject({ kind: 'plan_changed', link: '/loader/changes' });
  expect(await rows(dilshan)).toEqual(['16:20 · Thursday\'s plan changed: your trip is VEH035, leaving 04:36 with 2 stops']);
  expect((await updatesOf(dilshan))[0]).toMatchObject({ kind: 'trip_changed', tone: 'warn' });
  expect((await rows(nadeesha))[0]).toBe('16:20 · Thursday\'s delivery is planned: Dilshan\'s reefer van, window 05:00 to 07:30');
});

it('AC-1 each person sees only their own: another shop, another depot, a dispatcher on both depots, and no one signed out', async () => {
  await sendWalkthroughPlan(walk);
  freeze(WED, 16 * 60 + 5);
  // Nadeesha's bell names none of Wellawatte's orders, and Wellawatte's names none of hers.
  expect((await rows(nadeesha)).some((line) => line.includes(': 46 dry'))).toBe(false);
  expect((await rows(chamari)).some((line) => line.includes(': 8 chilled'))).toBe(false);
  expect((await updatesOf(ishara)).every((item) => item.link.startsWith('/store'))).toBe(true);
  // Kandy's dock and Kandy's drivers hear nothing of Peliyagoda's plan.
  expect(await updatesOf(sarath)).toEqual([]);
  expect(await updatesOf(prasanna)).toEqual([]);
  // A dispatcher's read takes ?depot= as every dispatcher read does (spec 021).
  expect(code(await ruwan.get('/api/v1/notifications').query({ depot: 'Kandy' }))).toEqual([409, 'depot_changed']);
  expect(await updatesOf(ruwan, { depot: 'Peliyagoda' })).toEqual(await updatesOf(ruwan));
  const both = agent();
  await signIn(both, 'ruwan');
  expect((await both.put('/api/v1/me/depot').send({ depotId: 'Both' })).status).toBe(200);
  expect(code(await both.get('/api/v1/notifications'))).toEqual([400, 'pick_a_depot']);
  expect(await updatesOf(both, { depot: 'Kandy' })).toEqual([]);
  expect(code(await both.get('/api/v1/notifications').query({ depot: 'Galle' }))).toEqual([400, 'unknown_record']);
  // Admin belongs to no shop and no depot, and is told nothing.
  expect(await updatesOf(admin)).toEqual([]);
  expect(code(await request(server).get('/api/v1/notifications'))).toEqual([401, 'signed_out']);
});

it('AC-1 answers at most 30, newest first', async () => {
  // 40 more of Nadeesha's orders for Thursday, placed a minute apart from 09:00.
  for (let i = 0; i < 40; i += 1) {
    const [order] = await db.insert(orders).values({ outletId: 'OUT001', deliveryDate: THU, temp: 'dry', status: 'placed', placedAt: depotInstant(WED, 9 * 60 + i) }).returning();
    await db.insert(orderLines).values({ orderId: order!.id, productId: 'fresh-dry-carton', quantity: i + 1 });
  }
  const items = await updatesOf(nadeesha);
  expect(items).toHaveLength(30);
  expect(items[0]!.line).toBe('Your order is placed: 40 dry cartons for Thu 25 Jun');
  expect(items.map((item) => item.at)).toEqual([...items.map((item) => item.at)].sort().reverse());
  expect(new Set(items.map((item) => item.id)).size).toBe(30);
});
