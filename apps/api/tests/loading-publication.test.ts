import { randomUUID } from 'node:crypto';
import { LoadingDay, PlanBoard } from '@wayfinder/contracts';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { auditLog, demoDay, plans, users } from '../src/db/schema';
import { depotInstant, initClock, setClockForTests } from '../src/lib/clock';
import { answeredTruck, answerFlag, dryLine, loaderScreen, resetDay, sendWalkthroughPlan, signIn, THU, truckOf, WED } from './loading-plan';
import { serve, stop } from './serve';

const clock = vi.hoisted(() => ({ at: '' }));
vi.mock('../src/lib/clock', async original => {
  const actual = await original<typeof import('../src/lib/clock')>();
  return { ...actual, demoClockAt: (...args: Parameters<typeof actual.demoClockAt>) => ({ ...actual.demoClockAt(...args), now: clock.at || actual.demoClockAt(...args).now }) };
});
const freeze = (date: string, minutes: number) => { const at = depotInstant(date, minutes); clock.at = at.toISOString(); setClockForTests(at); };
const server = await serve(createApp());
const ruwan = request.agent(server), nadeesha = request.agent(server), kasun = request.agent(server);
const walk = { ruwan, nadeesha, kasun, freeze };
let originalClock: typeof demoDay.$inferSelect;
beforeAll(async () => {
  originalClock = (await db.select().from(demoDay))[0]!;
  for (const [agent, name] of [[ruwan, 'ruwan'], [nadeesha, 'nadeesha'], [kasun, 'kasun']] as const) await signIn(agent, name);
});
beforeEach(async () => { await resetDay(); await initClock(); freeze(WED, 16 * 60); });
afterAll(async () => {
  await resetDay(); await db.update(demoDay).set(originalClock); clock.at = ''; setClockForTests(null);
  await stop(server); await pool.end();
});
const read = async () => { const res = await kasun.get('/api/v1/loading'); expect(res.status).toBe(200); return res.body; };
const generation = async () => (await db.select().from(demoDay))[0]!.day;

it('AC-20 loading publication names its actual sender and generation', async () => {
  const sent = await sendWalkthroughPlan(walk);
  const [someoneElse] = await db.select().from(users).where(eq(users.username, 'kasun'));
  await db.update(plans).set({ createdBy: someoneElse!.id }).where(eq(plans.id, sent.plan.id!));
  // A later real-time audit with a different revision must not supply the sender or publication time.
  await db.insert(auditLog).values({ actorId: someoneElse!.id, action: 'plan.sent', entity: 'plan', entityId: sent.plan.id!, after: { revision: sent.plan.revision + 20 }, at: new Date('2030-01-01T00:00:00Z') });
  expect(await read()).toMatchObject({ demoDay: await generation(), plan: { id: sent.plan.id, revision: sent.plan.revision,
    publishedAt: depotInstant(WED, 16 * 60).toISOString(), publishedBy: 'Ruwan' } });
  expect((await ruwan.post(`/api/v1/plans/${THU}/unsend`).send({ planId: sent.plan.id, revision: sent.plan.revision })).status).toBe(200);
  expect(await read()).toMatchObject({ demoDay: await generation(), plan: null });
  freeze(THU, 2 * 60 + 31);
  const board = PlanBoard.parse((await ruwan.get(`/api/v1/plans?date=${THU}`)).body);
  const resent = await ruwan.post(`/api/v1/plans/${THU}/send`).send({ planId: board.plan.id, revision: board.plan.revision });
  expect(resent.status).toBe(200);
  expect(await read()).toMatchObject({ demoDay: await generation(), plan: { id: board.plan.id, revision: resent.body.plan.revision,
    publishedAt: depotInstant(THU, 2 * 60 + 31).toISOString(), publishedBy: 'Ruwan' } });
});

it('AC-20 loader writes and their replay carry the same publication and locked generation', async () => {
  await sendWalkthroughPlan(walk);
  const initial = await read();
  expect(initial.demoDay).toBe(await generation());
  expect(initial.plan.publishedBy).toBe('Ruwan');
  const loader = loaderScreen(kasun);
  let truck = truckOf(LoadingDay.parse(initial), 'VEH035');
  const samePublication = (res: request.Response) => {
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ demoDay: initial.demoDay, plan: initial.plan });
    return answeredTruck(res, 'VEH035');
  };
  const id = randomUUID();
  const before = truck;
  truck = samePublication(await loader.start(truck, initial.plan, id));
  samePublication(await loader.start(before, initial.plan, id));
  truck = samePublication(await loader.stopLoaded(truck, 2));
  truck = samePublication(await loader.flag(truck, 1, [{ lineId: dryLine(truck).lineId, counted: 3 }]));
  await answerFlag(ruwan, truck.issues[0]!.id, 'go_short');
  truck = samePublication(await loader.stopLoaded(truck, 1));
  samePublication(await loader.ready(truck));
});

it('AC-20 legacy publication has no guessed publisher and reset generation is read afresh', async () => {
  freeze(WED, 15 * 60);
  expect(await read()).toMatchObject({ demoDay: await generation(), plan: { publishedAt: depotInstant('2026-06-23', 17 * 60).toISOString(), publishedBy: null } });
  const before = await generation();
  await db.update(demoDay).set({ day: sql`${demoDay.day} + 1` });
  expect(await read()).toMatchObject({ demoDay: before + 1 });
});

it('AC-20 a newly sent publication without its matching sender audit fails visibly', async () => {
  const sent = await sendWalkthroughPlan(walk);
  await db.delete(auditLog).where(and(eq(auditLog.entityId, sent.plan.id!), eq(auditLog.action, 'plan.sent')));
  expect((await kasun.get('/api/v1/loading')).status).toBe(500);
});
