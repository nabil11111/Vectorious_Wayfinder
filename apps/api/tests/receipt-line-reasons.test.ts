import { IssueList, LookupHistory, OperationsDay, StoreDeliveries, type ReceiptWrite } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { demoDay, issueLines, issues } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { announce } from '../src/lib/live';
import { driverStop, heldDriverRows } from './driver-plan';
import { code, resetDay, signIn, THU, WED } from './loading-plan';
import { deliveredWalkthrough, receiptOf, shopScreen, type ReceiptWalk } from './receipt-plan';
import { serve, stop } from './serve';

// Q-40: a receipt gives each short line its own reason and takes a note of up to 200 characters, and the dispatcher's
// card, Live day, the Dashboard and History read each line's reason and the note. A receipt kept before this, with one
// reason for the whole receipt, still reads, each short line taking that reason.

const testClock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async (original) => {
  const clock = await original<typeof import('../src/lib/clock')>();
  return { ...clock, demoClockAt: (...args: Parameters<typeof clock.demoClockAt>) => ({ ...clock.demoClockAt(...args), now: testClock.at || clock.demoClockAt(...args).now }) };
});
vi.mock('../src/lib/live', async (original) => ({ ...await original<typeof import('../src/lib/live')>(), announce: vi.fn() }));
const freeze = (date: string, minute: number) => { const instant = depotInstant(date, minute); testClock.at = instant.toISOString(); setClockForTests(instant); };
const app = createApp();
app.set('trust proxy', 'loopback');
const server = await serve(app);
const agentAt = (address: string) => request.agent(server).set('X-Forwarded-For', address);
const kasun = agentAt('192.0.2.81');
const ruwan = agentAt('192.0.2.82');
const nadeesha = agentAt('192.0.2.83');
const dilshan = agentAt('192.0.2.84');
const walk: ReceiptWalk = { nadeesha, ruwan, kasun, dilshan, freeze };
const shop = shopScreen(nadeesha);
let originalClock: typeof demoDay.$inferSelect;

beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, username] of [[kasun, 'kasun'], [ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [dilshan, 'dilshan']] as const) await signIn(agent, username);
});
beforeEach(async () => {
  await resetDay();
  await initClock();
  freeze(WED, 16 * 60);
  vi.mocked(announce).mockReset();
});
afterAll(async () => {
  await resetDay();
  await db.update(demoDay).set(originalClock);
  testClock.at = '';
  setClockForTests(null);
  await stop(server);
  await pool.end();
});

const SENT = 8 * 60 + 33;
const NOTE = 'The 12-carton crate was crushed at one corner; the dry carton never came off the van.';

// Nugegoda handed over at 03:38 and her delivery as her phone reads it at 08:30.
async function toConfirm() {
  const trip = await deliveredWalkthrough(walk);
  return (await shop.read()).deliveries.find((each) => each.stopId === driverStop(trip, 1).id)!;
}
// The receipt's lines with the reasons given, by the line's place: 12 chilled, 8 chilled, 3 dry.
const withReasons = (write: ReceiptWrite, reasons: (string | null | undefined)[]) =>
  ({ ...write, lines: write.lines.map((line, i) => (reasons[i] === undefined ? line : { ...line, reason: reasons[i] })) });
async function needsRuwan() {
  const res = await ruwan.get('/api/v1/issues');
  expect(res.status).toBe(200);
  return IssueList.parse(res.body);
}

it('keeps each short line\'s own reason and the note, and every reader gives them back', async () => {
  const delivery = await toConfirm();
  const [twelve, , dry] = delivery.lines;
  const write = withReasons(receiptOf(delivery, [11, 8, 2], { note: NOTE }), ['damaged', null, 'missing']);
  freeze(THU, SENT);
  const res = await shop.send(write);
  expect(res.status).toBe(200);

  // The receipt the shop reads back: each counted line with its reason, and the note.
  const report = StoreDeliveries.parse(res.body).deliveries[0]!.receipt!.report!;
  expect(report.lines).toEqual([{ lineId: twelve!.lineId, counted: 1, reason: 'damaged' }, { lineId: dry!.lineId, counted: 1, reason: 'missing' }]);
  expect(report.note).toBe(NOTE);
  // The problem keeps the first short line's reason as its own, each line its reason, and the note.
  expect(await db.select({ reason: issues.reason, note: issues.note }).from(issues).where(eq(issues.id, write.writeId))).toEqual([{ reason: 'damaged', note: NOTE }]);
  expect((await db.select().from(issueLines).where(eq(issueLines.issueId, write.writeId))).map((line) => [line.orderLineId, line.counted, line.reason]).sort())
    .toEqual([[twelve!.lineId, 1, 'damaged'], [dry!.lineId, 1, 'missing']].sort());

  // Live day's card and the Dashboard's Needs you read the problem list.
  const open = (await needsRuwan()).issues.find((problem) => problem.id === write.writeId)!;
  expect(open.note).toBe(NOTE);
  expect(open.lines.map((line) => [line.lineId, line.counted, line.reason])).toEqual([[twelve!.lineId, 1, 'damaged'], [dry!.lineId, 1, 'missing']]);

  // The Dashboard's truck row sums the report up by its lines' reasons.
  const day = OperationsDay.parse((await ruwan.get('/api/v1/operations')).body);
  const row = day.groups.flatMap((group) => group.trips).find((trip) => trip.openIssueIds.includes(write.writeId));
  expect(row?.outRow?.status).toMatchObject({ kind: 'open_problem', issueId: write.writeId, summary: 'Damaged, missing' });

  // History's confirmation carries the same report.
  const history = LookupHistory.parse((await ruwan.get('/api/v1/lookup/history').query({ date: THU })).body);
  const kept = history.trips.flatMap((trip) => trip.stops).find((each) => each.id === delivery.stopId)!.receipt!.report!;
  expect(kept.lines).toEqual(report.lines);
  expect(kept.note).toBe(NOTE);
});

it('takes a receipt saved before lines had reasons, giving each short line the receipt\'s one reason', async () => {
  const delivery = await toConfirm();
  const [twelve, , dry] = delivery.lines;
  const write = receiptOf(delivery, [11, 8, 2], { reason: 'missing' });
  freeze(THU, SENT);
  const res = await shop.send(write);
  expect(res.status).toBe(200);
  expect(StoreDeliveries.parse(res.body).deliveries[0]!.receipt!.report).toMatchObject({
    reason: 'missing', note: null, lines: [{ lineId: twelve!.lineId, counted: 1, reason: 'missing' }, { lineId: dry!.lineId, counted: 1, reason: 'missing' }],
  });
});

it('reads a report stored with one reason for the whole receipt as that reason on each short line', async () => {
  const delivery = await toConfirm();
  const [twelve] = delivery.lines;
  const write = withReasons(receiptOf(delivery, [11, 8, 3], { cold: false }), ['damaged', null, null]);
  freeze(THU, SENT);
  expect((await shop.send(write)).status).toBe(200);
  // As a report kept before lines had reasons: none on its lines.
  await db.update(issueLines).set({ reason: null }).where(eq(issueLines.issueId, write.writeId));
  const report = (await shop.read()).deliveries[0]!.receipt!.report!;
  // The short line takes the receipt's reason; a chilled line counted only because the goods came warm takes none.
  expect(report.lines).toEqual([{ lineId: twelve!.lineId, counted: 1, reason: 'damaged' }, { lineId: delivery.lines[1]!.lineId, counted: 0, reason: null }]);
  expect((await needsRuwan()).issues.find((problem) => problem.id === write.writeId)!.lines.map((line) => line.reason)).toEqual(['damaged', null]);
});

it('refuses a short line with no reason, a reason on a full line, a note with no report and a note over 200 characters, writing nothing', async () => {
  const delivery = await toConfirm();
  freeze(THU, SENT);
  const cases: [object, string][] = [
    [withReasons(receiptOf(delivery, [11, 8, 2]), ['damaged', null, null]), 'Say what is wrong with the cartons that are short.'],
    [withReasons(receiptOf(delivery, [11, 8, 3]), ['damaged', 'missing', null]), 'Say what is wrong only when a line is short.'],
    [receiptOf(delivery, [12, 8, 3], { note: 'All fine' }), 'Add a note only to a report.'],
    [{ ...withReasons(receiptOf(delivery, [11, 8, 3]), ['damaged', null, null]), note: 'x'.repeat(201) }, 'Some fields are missing or wrong.'],
  ];
  for (const [write, message] of cases) {
    const before = await heldDriverRows();
    const res = await shop.send(write);
    expect(code(res)).toEqual([400, 'invalid_input']);
    expect(res.body.error.message).toBe(message);
    expect(await heldDriverRows()).toEqual(before);
  }
  // A note of spaces is no note, so a receipt with nothing wrong takes it and keeps none.
  expect((await shop.send(receiptOf(delivery, [12, 8, 3], { note: '   ' }))).status).toBe(200);
  expect(await db.select().from(issues).where(eq(issues.kind, 'receipt'))).toEqual([]);
});
