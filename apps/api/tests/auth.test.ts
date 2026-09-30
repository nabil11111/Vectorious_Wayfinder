import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { serve, stop } from './serve';

const app = await serve(createApp());
const password = process.env.SEED_PASSWORD ?? 'wayfinder-demo';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'wayfinder-admin';
afterAll(async () => {
  await stop(app);
  await pool.end();
});

describe('health', () => {
  it('reports the database is up', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: 'up' });
  });
});

describe('sign in', () => {
  it('rejects a wrong password without saying which part was wrong', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ruwan', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('bad_credentials');
  });

  it('signs in, returns the role and sets an httpOnly cookie', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ruwan', password });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'ruwan', role: 'dispatcher', depotId: 'Peliyagoda' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/wf_session=.+HttpOnly/);
  });

  it('knows who you are from the cookie, and forgets you after logout', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ username: 'nadeesha', password });
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body).toMatchObject({ role: 'store_manager', outletId: 'OUT001' });
    await agent.post('/api/v1/auth/logout').set('Content-Type', 'application/json');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('gives the Peliyagoda depot its own driver, so one delivery can be followed end to end', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'dilshan', password });
    expect(res.body).toMatchObject({ role: 'driver', depotId: 'Peliyagoda' });
  });

  it('gives the Style and the Tech brand a store manager too, each at their own shop', async () => {
    const style = await request(app).post('/api/v1/auth/login').send({ username: 'ishara', password });
    expect(style.body).toMatchObject({ role: 'store_manager', outletId: 'OUT017', depotId: 'Peliyagoda' });
    const tech = await request(app).post('/api/v1/auth/login').send({ username: 'tharindu', password });
    expect(tech.body).toMatchObject({ role: 'store_manager', outletId: 'OUT064', depotId: 'Peliyagoda' });
  });

  it('keeps the admin account off the shared demo password', async () => {
    const demo = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password });
    expect(demo.status).toBe(401);
    const own = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: adminPassword });
    expect(own.body).toMatchObject({ role: 'admin' });
  });

  it('refuses a missing field with the shared error shape', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'ruwan' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });
});

describe('security basics', () => {
  it('refuses writes that are not JSON', async () => {
    const res = await request(app).post('/api/v1/auth/login').type('form').send('username=ruwan&password=x');
    expect(res.status).toBe(415);
  });

  it('answers a broken JSON body with 400, not a server error', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"username":"ruwan","password":"hunter2"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('sends security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // Keep this one last: it uses up the sign-in allowance for this test file.
  it('blocks rapid password guessing, even when each try claims a different address', async () => {
    const tries = [];
    for (let i = 0; i < 12; i++) tries.push(await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', `203.0.113.${i}`).send({ username: 'kasun', password: 'guess' + i }));
    expect(tries.at(-1)!.status).toBe(429);
  });
});
