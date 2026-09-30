import { DEMO_DAY } from '@wayfinder/contracts';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { seedDemoDay } from '../src/db/demo-day';
import { demoDay } from '../src/db/schema';
import { serve, stop } from './serve';

const app = await serve(createApp());
afterAll(async () => {
  await stop(app);
  await pool.end();
});

// The shared wiring of spec 008. What each endpoint answers once someone is signed in is tested with the
// task that builds it.
describe('the clock, the demo control and the live stream', () => {
  it('are there and need a session', async () => {
    const asked = [
      await request(app).get('/api/v1/clock'),
      await request(app).get('/api/v1/events'),
      await request(app).post('/api/v1/demo/clock/next').send({ revision: 0 }),
      await request(app).post('/api/v1/demo/reset').set('Content-Type', 'application/json'),
    ];
    expect(asked.map((res) => [res.status, res.body.error?.code])).toEqual(Array(4).fill([401, 'signed_out']));
  });

  it('keep the live stream out of the rate limit', async () => {
    const stream = await request(app).get('/api/v1/events');
    const health = await request(app).get('/api/v1/health');
    expect(stream.headers).not.toHaveProperty('ratelimit');
    expect(health.headers).toHaveProperty('ratelimit');
  });
});

describe('the seed in demo mode', () => {
  it('writes the clock row once, at the start of the demo day', async () => {
    await seedDemoDay();
    await seedDemoDay();
    const rows = await db.select().from(demoDay);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, clockBase: new Date(DEMO_DAY.parts[0].at), revision: 0, day: 1 });
  });
});
