import { hash, verify } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { signInReady } from '../src/routes/auth';
import { serve, stop } from './serve';
import { PIN, SIGN_IN } from './sign-in';

// Spec 018, rule 3, in a process that has just started. This test has a file of its own, so no sign-in before it
// has made anything the first sign-in with a staff ID nobody has would need.

// Every hash and every PIN check goes through argon2. The spies count them and change nothing.
vi.mock('@node-rs/argon2', async (original) => {
  const argon2 = await original<typeof import('@node-rs/argon2')>();
  return { ...argon2, hash: vi.fn(argon2.hash), verify: vi.fn(argon2.verify) };
});

const app = await serve(createApp());
afterAll(async () => {
  await stop(app);
  await pool.end();
});

it('AC-2 answers the first unknown staff ID after a start with one PIN check and no hash, as it answers a wrong PIN', async () => {
  // What server.ts waits for before it listens.
  await signInReady();
  vi.mocked(hash).mockClear();
  vi.mocked(verify).mockClear();
  const res = await request(app).post(SIGN_IN).send({ staffId: 'X-404', pin: PIN });
  expect([res.status, res.body.error?.code]).toEqual([401, 'bad_credentials']);
  expect(vi.mocked(verify)).toHaveBeenCalledOnce();
  expect(vi.mocked(hash)).not.toHaveBeenCalled();
});
