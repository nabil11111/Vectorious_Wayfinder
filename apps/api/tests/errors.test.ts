import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { logger } from '../src/lib/logger';
import { errorHandler } from '../src/middleware/errors';
import { serve, stop } from './serve';

const server = await serve(createApp());
afterAll(async () => {
  await stop(server);
  await pool.end();
});
afterEach(() => vi.restoreAllMocks());

const logged = (spy: { mock: { calls: unknown[][] } }) => JSON.stringify(spy.mock.calls);

describe('error logging', () => {
  it('does not write a broken request body into the log', async () => {
    const spy = vi.spyOn(logger, 'error');
    await request(server).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"username":"ruwan","password":"hunter2"');
    expect(logged(spy)).not.toContain('hunter2');
  });

  it('logs an unexpected error without whatever else is attached to it', async () => {
    const spy = vi.spyOn(logger, 'error');
    const app = express();
    app.get('/boom', (_req, _res, next) => next(Object.assign(new Error('boom'), { body: '{"password":"hunter2"}' })));
    app.use(errorHandler);
    const boom = await serve(app);
    const res = await request(boom).get('/boom');
    await stop(boom);
    expect(res.status).toBe(500);
    expect(logged(spy)).toContain('boom');
    expect(logged(spy)).not.toContain('hunter2');
  });
});
