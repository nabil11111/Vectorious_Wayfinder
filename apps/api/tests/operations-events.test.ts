import { randomUUID } from 'node:crypto';
import { ISSUE_KINDS, OPERATIONS_EVENT_KINDS } from '@wayfinder/contracts';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, issueLines, issues, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { driverStop, driverTrip, driverWrite } from './driver-plan';
import { resetDay, signIn, THU, WED } from './loading-plan';
import { decide, journey, operations, photo } from './operations-plan';
import { receiptOf, shopScreen } from './receipt-plan';
import { serve, stop } from './serve';
const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const freeze = (date: string, min: number) => { const at = depotInstant(date, min); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server), dilshan = request.agent(server);
const walk = { ruwan, nadeesha, kasun, dilshan, freeze }, road = journey(walk), read = () => operations(ruwan);
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun'], [dilshan, 'dilshan']] as const) await signIn(agent, name);
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 960); });
afterAll(async () => { await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null); await stop(server); await pool.end(); });
const sorted = <T extends { at: string; key: string }>(events: T[]) => [...events].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));

it('AC-17 replayed late refusal yields unique business time events', async () => {
  const trip = await road.wellawatte();
  const line = driverStop(trip, 2).lines.find(line => line.temp === 'chilled')!;
  freeze(THU, 600);
  const write = driverWrite(trip, 'refuse', depotInstant(THU, 220).toISOString(), 2, { photo, reason: 'damaged', note: '2 crushed cartons', lines: [{ lineId: line.lineId, refused: 2 }] });
  expect((await road.driver.send(write)).status).toBe(200);
  const first = await read();
  expect(first.events.find(event => event.issueId === write.writeId)).toMatchObject({ kind: 'problem_raised', issueKind: 'refused', hasPhoto: true, at: depotInstant(THU, 225).toISOString(), lines: [expect.objectContaining({ counted: 2, loaded: 48, delivered: 46 })] });
  expect(first.events.filter(event => event.kind === 'delivered')).toHaveLength(1);
  expect(first.events.find(event => event.kind === 'delivered')).toMatchObject({ hasPhoto: true, lines: expect.arrayContaining([expect.objectContaining({ delivered: 12 }), expect.objectContaining({ delivered: 8 }), expect.objectContaining({ delivered: 3 })]) });
  freeze(THU, 650);
  expect((await road.driver.send(write)).status).toBe(200);
  const second = await read();
  expect(second.events).toEqual(first.events);
  expect(second.events).toEqual(sorted(second.events));
  expect(new Set(second.events.map(event => event.key)).size).toBe(second.events.length);
  expect(JSON.stringify(second.events)).not.toContain('data:image');
  expect(second.events.every(event => !('jpeg' in event) && !('url' in event))).toBe(true);
});

it('AC-17 every joined problem kind and recorded source appears once', async () => {
  let trip = await road.started();
  trip = await road.write(trip, 'arrive', 214, 1);
  trip = await road.write(trip, 'closed', 218, 1);
  const closed = trip.problems.find(problem => problem.kind === 'closed')!;
  freeze(THU, 219);
  await decide(ruwan, closed.id, 'try_again');
  trip = driverTrip(await road.driver.read());
  trip = await road.write(trip, 'arrive', 225, 2);
  trip = await road.write(trip, 'refuse', 228, 2, { reason: 'damaged', note: '', lines: [{ lineId: driverStop(trip, 2).lines[0]!.lineId, refused: 2 }] });
  trip = await road.write(trip, 'arrive', 230, 1);
  trip = await road.write(trip, 'deliver', 233, 1, { photo });
  await road.write(trip, 'finish', 235);
  // The shop's report on its receipt (spec 015) is the fourth kind: Nadeesha counts one chilled carton missing.
  freeze(THU, 8 * 60 + 31);
  const shop = shopScreen(nadeesha);
  const nugegoda = (await shop.read()).deliveries.find(delivery => delivery.stopId === driverStop(trip, 1).id)!;
  expect((await shop.send(receiptOf(nugegoda, [11, 8, 3], { reason: 'missing' }))).status).toBe(200);
  const day = await read();
  expect(new Set(day.events.map(event => event.kind))).toEqual(new Set(OPERATIONS_EVENT_KINDS));
  // This fails at the join if a new issue kind lacks its integration scenario.
  expect(new Set(day.events.filter(event => event.kind === 'problem_raised').map(event => event.issueKind))).toEqual(new Set(ISSUE_KINDS));
  expect(day.events.find(event => event.kind === 'plan_sent')).toMatchObject({ planId: day.plan!.id, planRevision: day.plan!.revision, actor: 'Ruwan', at: depotInstant(WED, 960).toISOString() });
  expect(day.events.filter(event => event.kind === 'stop_loaded')).toHaveLength(2);
  expect(day.events.filter(event => event.kind === 'answer_sent')).toHaveLength(2);
  expect(day.events.filter(event => event.kind === 'arrived')).toHaveLength(2);
  expect(day.events.find(event => event.kind === 'problem_raised' && event.issueKind === 'closed')!.hasPhoto).toBe(false);
  expect(day.events).toEqual(sorted(day.events));
  expect((await read()).events).toEqual(day.events);
});

it('AC-18 latest fifty events never survive their reset', async () => {
  const trip = await road.started();
  const [raiser] = await db.select().from(users).where(eq(users.username, 'kasun'));
  const stop = driverStop(trip, 1), at = depotInstant(THU, 500);
  const extra = Array.from({ length: 51 }, () => ({ id: randomUUID(), kind: 'loading' as const, reason: 'short', stopId: stop.id, raisedBy: raiser!.id, raisedAt: at }));
  await db.insert(issues).values(extra);
  await db.insert(issueLines).values(extra.map(issue => ({ issueId: issue.id, orderLineId: stop.lines[0]!.lineId, counted: 11 })));
  await db.insert(auditLog).values({ action: 'not.a.live.event', entity: 'trip', entityId: trip.tripId, at: new Date('2040-01-01T00:00:00Z') });
  freeze(THU, 600);
  const day = await read();
  expect(day.eventsTruncated).toBe(true);
  expect(day.events).toHaveLength(50);
  expect(day.events.every(event => event.at === at.toISOString() && event.kind === 'problem_raised')).toBe(true);
  expect(day.events.map(event => event.issueId)).toEqual(extra.map(issue => issue.id).sort().slice(0, 50));
  const auditCount = (await db.select().from(auditLog)).length;
  await resetDay(); freeze(WED, 960);
  expect((await db.select().from(auditLog)).length).toBe(auditCount);
  expect(await read()).toMatchObject({ events: [], eventsTruncated: false, groups: [] });
});
