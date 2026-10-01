import { hash, verify } from '@node-rs/argon2';
import { eq, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema';
import { realNow, setClockForTests } from '../src/lib/clock';
import { serve, stop } from './serve';
import { PIN, SIGN_IN, signInAs, signInBody } from './sign-in';

// Every hash and every PIN check goes through argon2. The spies count them and change nothing.
vi.mock('@node-rs/argon2', async (original) => {
  const argon2 = await original<typeof import('@node-rs/argon2')>();
  return { ...argon2, hash: vi.fn(argon2.hash), verify: vi.fn(argon2.verify) };
});

const app = await serve(createApp());
// The rules' tests run on an app that believes the forwarded address, so each test asks from an address of its own
// and the address limit (10 failed tries in 15 minutes) never answers for the lock.
const forwarded = createApp();
forwarded.set('trust proxy', 'loopback');
const lockServer = await serve(forwarded);
const from = (address: string) => request.agent(lockServer).set('X-Forwarded-For', address);

const MINUTE = 60_000;
// A PIN that is not the demo one, whatever SEED_PIN says.
const WRONG_PIN = PIN === '0000' ? '1111' : '0000';
const WRONG = { status: 401, code: 'bad_credentials', message: "Staff ID or PIN isn't correct. Try again." };
const LOCKED = { status: 429, code: 'locked', message: 'Too many tries. Wait 15 minutes, or contact your depot.' };
const answer = (res: request.Response) => ({ status: res.status, code: res.body.error?.code, message: res.body.error?.message });

// Accounts made here for what the fixtures must never go through, a lock above all. Each is named after its staff
// ID, and they go at the end with their sessions, as does whatever a run that was stopped halfway left.
const MADE = 'auth-test-';
const removeMade = () => db.delete(users).where(like(users.username, `${MADE}%`));
async function makeAccount(staffId: string, { active = true, pin = PIN as string | null } = {}) {
  const username = `${MADE}${staffId.toLowerCase()}`;
  await db.delete(users).where(eq(users.username, username));
  await db.insert(users).values({ username, staffId, displayName: `Test ${staffId}`, role: 'store_manager', outletId: 'OUT001', active, pinHash: pin === null ? null : await hash(pin) });
}
const accountOf = async (staffId: string) => (await db.select().from(users).where(eq(users.staffId, staffId)))[0]!;

beforeAll(removeMade);
afterEach(() => setClockForTests(null));
afterAll(async () => {
  await removeMade();
  await stop(lockServer);
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
  it('rejects a wrong PIN without saying which part was wrong', async () => {
    await makeAccount('S-950');
    const res = await request(app).post(SIGN_IN).send({ staffId: 'S-950', pin: WRONG_PIN });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('bad_credentials');
  });

  it('signs in with a staff ID and PIN, returns the role and the staff ID and sets an httpOnly cookie', async () => {
    const res = await request(app).post(SIGN_IN).send({ staffId: 'P-001', pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'ruwan', staffId: 'P-001', role: 'dispatcher', depotId: 'Peliyagoda' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/wf_session=.+HttpOnly/);
  });

  it('knows who you are from the cookie, and forgets you after logout', async () => {
    const agent = request.agent(app);
    await signInAs(agent, 'nadeesha');
    const me = await agent.get('/api/v1/auth/me');
    expect(me.body).toMatchObject({ staffId: 'S-001', role: 'store_manager', outletId: 'OUT001' });
    await agent.post('/api/v1/auth/logout').set('Content-Type', 'application/json');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('gives the Peliyagoda depot its own driver, so one delivery can be followed end to end', async () => {
    const res = await signInAs(request(app), 'dilshan');
    expect(res.body).toMatchObject({ staffId: 'D-001', role: 'driver', depotId: 'Peliyagoda' });
  });

  it('gives the Style and the Tech brand a store manager too, each at their own shop', async () => {
    const style = await signInAs(request(app), 'ishara');
    expect(style.body).toMatchObject({ staffId: 'S-002', role: 'store_manager', outletId: 'OUT017', depotId: 'Peliyagoda' });
    const tech = await signInAs(request(app), 'tharindu');
    expect(tech.body).toMatchObject({ staffId: 'S-003', role: 'store_manager', outletId: 'OUT064', depotId: 'Peliyagoda' });
  });

  it('keeps the admin account off the shared demo PIN', async () => {
    const demo = await request(app).post(SIGN_IN).send({ staffId: 'A-001', pin: PIN });
    expect(demo.status).toBe(401);
    const own = await signInAs(request(app), 'admin');
    expect(own.body).toMatchObject({ staffId: 'A-001', role: 'admin' });
  });

  it('refuses a missing field with the shared error shape', async () => {
    const res = await request(app).post(SIGN_IN).send({ staffId: 'P-001' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_input');
  });

  // Only an account seeded before staff IDs, or made without one, can have no staff ID. Its session then ends, as
  // the sign-in treats it as unknown.
  it('counts a session as signed out once its account has no staff ID', async () => {
    await makeAccount('S-951');
    const agent = request.agent(app);
    expect((await signInAs(agent, { staffId: 'S-951', pin: PIN })).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).body).toMatchObject({ staffId: 'S-951' });
    await db.update(users).set({ staffId: null }).where(eq(users.username, `${MADE}s-951`));
    const me = await agent.get('/api/v1/auth/me');
    expect([me.status, me.body.error?.code]).toEqual([401, 'signed_out']);
  });
});

describe('rule 1: a staff ID whatever its case and spaces', () => {
  it('AC-1 signs Ruwan in with " p-001 ", answers his Me with his staff ID and sets the session', async () => {
    for (const staffId of [' p-001 ', 'p-001', 'P-001']) {
      const asker = from('192.0.2.11');
      const res = await signInAs(asker, { staffId, pin: PIN });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ username: 'ruwan', staffId: 'P-001', role: 'dispatcher' });
      expect((await asker.get('/api/v1/auth/me')).body).toMatchObject({ staffId: 'P-001' });
    }
  });
});

describe('rule 3: one answer for any wrong pair', () => {
  it('AC-2 answers an unknown staff ID, a wrong PIN, a switched-off account and a row with no PIN alike, with no session', async () => {
    await makeAccount('S-952');
    await makeAccount('S-953', { active: false });
    await makeAccount('S-954', { pin: null });
    const asker = from('192.0.2.12');
    for (const body of [
      { staffId: 'X-404', pin: PIN }, // nobody has it
      { staffId: 'nadeesha', pin: PIN }, // a username is not a staff ID, and is unknown rather than a wrong shape
      { staffId: 'S-952', pin: WRONG_PIN },
      { staffId: 'S-953', pin: PIN }, // switched off, with its own PIN
      { staffId: 'S-954', pin: PIN }, // no PIN
    ]) {
      const res = await signInAs(asker, body);
      expect(answer(res)).toEqual(WRONG);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect((await asker.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('AC-2 checks a staff ID nobody has against a made-up hash as costly as a real one, so it takes as long as a wrong PIN', async () => {
    await makeAccount('S-955');
    await makeAccount('S-956', { active: false });
    await makeAccount('S-957', { pin: null });
    const asker = from('192.0.2.13');
    const real = (await accountOf('S-955')).pinHash!;
    const cost = (argon2Hash: string) => argon2Hash.split('$').slice(1, 4).join('$');
    for (const body of [{ staffId: 'X-404', pin: PIN }, { staffId: 'S-955', pin: WRONG_PIN }, { staffId: 'S-956', pin: PIN }, { staffId: 'S-957', pin: PIN }]) {
      vi.mocked(hash).mockClear();
      vi.mocked(verify).mockClear();
      expect(answer(await signInAs(asker, body))).toEqual(WRONG);
      expect(vi.mocked(hash)).not.toHaveBeenCalled();
      expect(vi.mocked(verify)).toHaveBeenCalledOnce();
      const checked = vi.mocked(verify).mock.calls[0]![0] as string;
      expect(cost(checked)).toBe(cost(real));
    }
  });
});

describe('rule 2: a PIN is four digits', () => {
  it('AC-3 refuses a PIN that is not four digits with 400 and checks nothing', async () => {
    await makeAccount('S-958');
    const asker = from('192.0.2.14');
    vi.mocked(verify).mockClear();
    const select = vi.spyOn(db, 'select');
    try {
      for (const pin of ['123', '12a4', '12345', '', ' 1234', '１２３４', 1234, null]) {
        const res = await asker.post(SIGN_IN).send({ staffId: 'S-958', pin });
        expect([res.status, res.body.error?.code]).toEqual([400, 'invalid_input']);
      }
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
    expect(vi.mocked(verify)).not.toHaveBeenCalled();
    expect((await accountOf('S-958')).failedPins).toBe(0);
  });
});

describe('rule 4: five wrong PINs in a row lock the staff ID for 15 minutes', () => {
  it('AC-4 answers the fifth wrong PIN and every sign-in after it locked, right PIN included, until 15 minutes on', async () => {
    await makeAccount('S-959');
    const asker = from('192.0.2.15');
    for (let i = 1; i <= 4; i++) expect(answer(await signInAs(asker, { staffId: 'S-959', pin: WRONG_PIN }))).toEqual(WRONG);
    expect((await accountOf('S-959')).failedPins).toBe(4);

    const before = realNow().getTime();
    const fifth = await signInAs(asker, { staffId: 'S-959', pin: WRONG_PIN });
    const after = realNow().getTime();
    expect(answer(fifth)).toEqual(LOCKED);
    const locked = await accountOf('S-959');
    expect(locked.failedPins).toBe(0);
    expect(locked.lockedUntil!.getTime()).toBeGreaterThanOrEqual(before + 15 * MINUTE);
    expect(locked.lockedUntil!.getTime()).toBeLessThanOrEqual(after + 15 * MINUTE);

    // The right PIN is refused like a wrong one while the lock lasts, and neither counts.
    for (const pin of [PIN, WRONG_PIN]) {
      const res = await signInAs(asker, { staffId: ' s-959 ', pin });
      expect(answer(res)).toEqual(LOCKED);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(await accountOf('S-959')).toMatchObject({ failedPins: 0, lockedUntil: locked.lockedUntil });

    // The lock runs on real time, as sessions do, so moving the demo clock a day on does not lift it.
    setClockForTests(new Date(after + 24 * 60 * MINUTE));
    expect(answer(await signInAs(asker, { staffId: 'S-959', pin: PIN }))).toEqual(LOCKED);
    setClockForTests(null);

    // Fifteen minutes on, which the lock's end set a second into the past stands for, the right PIN signs in.
    await db.update(users).set({ lockedUntil: new Date(realNow().getTime() - 1000) }).where(eq(users.staffId, 'S-959'));
    const back = await signInAs(asker, { staffId: 'S-959', pin: PIN });
    expect([back.status, back.body.staffId]).toEqual([200, 'S-959']);
    expect(await accountOf('S-959')).toMatchObject({ failedPins: 0, lockedUntil: null });
  });

  it('AC-4 sets the count back to 0 at a right PIN before the fifth', async () => {
    await makeAccount('S-960');
    const asker = from('192.0.2.16');
    for (let i = 1; i <= 4; i++) expect(answer(await signInAs(asker, { staffId: 'S-960', pin: WRONG_PIN }))).toEqual(WRONG);
    expect((await signInAs(asker, { staffId: 'S-960', pin: PIN })).status).toBe(200);
    expect((await accountOf('S-960')).failedPins).toBe(0);
    for (let i = 1; i <= 4; i++) expect(answer(await signInAs(asker, { staffId: 'S-960', pin: WRONG_PIN }))).toEqual(WRONG);
    expect(await accountOf('S-960')).toMatchObject({ failedPins: 4, lockedUntil: null });
  });

  // Each wrong PIN is added in one statement, so five that arrive together still make five and lock.
  it('AC-4 counts five wrong PINs sent at once and locks at the fifth', async () => {
    await makeAccount('S-961');
    const tries = await Promise.all(Array.from({ length: 5 }, () => signInAs(from('192.0.2.17'), { staffId: 'S-961', pin: WRONG_PIN })));
    expect(tries.map((res) => answer(res)).sort((a, b) => a.status - b.status)).toEqual([WRONG, WRONG, WRONG, WRONG, LOCKED]);
    expect((await accountOf('S-961')).lockedUntil).not.toBeNull();
    expect(answer(await signInAs(from('192.0.2.17'), { staffId: 'S-961', pin: PIN }))).toEqual(LOCKED);
  });
});

describe('security basics', () => {
  it('refuses writes that are not JSON', async () => {
    const res = await request(app).post(SIGN_IN).type('form').send('staffId=P-001&pin=1234');
    expect(res.status).toBe(415);
  });

  it('answers a broken JSON body with 400, not a server error', async () => {
    const res = await request(app).post(SIGN_IN).set('Content-Type', 'application/json').send('{"staffId":"P-001","pin":"1234"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('sends security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // docker compose serves the app over plain http on localhost. A browser that does not treat localhost as secure
  // would drop a Secure cookie there, and upgrading every request to https would break the page.
  it('asks for no https upgrade, and sets the cookie Secure only when the request came over https', async () => {
    const health = await request(app).get('/api/v1/health');
    expect(health.headers['content-security-policy']).not.toMatch(/upgrade-insecure-requests/);

    const plain = await signInAs(request(app), 'kasun');
    expect(plain.status).toBe(200);
    expect(plain.headers['set-cookie']?.[0]).not.toMatch(/Secure/);

    // Hosted, the proxy in front ends https and says so; the app trusts it when TRUST_PROXY is set.
    const proxied = createApp();
    proxied.set('trust proxy', 1);
    const hosted = await serve(proxied);
    try {
      const secure = await request(hosted).post(SIGN_IN).set('X-Forwarded-Proto', 'https').send(signInBody('kasun'));
      expect(secure.status).toBe(200);
      expect(secure.headers['set-cookie']?.[0]).toMatch(/Secure/);
    } finally {
      await stop(hosted);
    }
  });

  // Judges who share one network share one address. Only failed sign-ins count towards the limit.
  it('lets every role sign in many times from one address', async () => {
    const tries = [];
    for (let i = 0; i < 12; i++) tries.push(await signInAs(request(app), 'dilshan'));
    expect(tries.map((res) => res.status)).toEqual(Array(12).fill(200));
  });

  // Keep this one last: it uses up the sign-in allowance for this test file's own address. Each try names a staff ID
  // nobody has, so the limit on the address is what stops them, never a lock.
  it('blocks rapid guessing, even when each try claims a different address', async () => {
    const tries = [];
    for (let i = 0; i < 12; i++) tries.push(await request(app).post(SIGN_IN).set('X-Forwarded-For', `203.0.113.${i}`).send({ staffId: `X-${100 + i}`, pin: PIN }));
    expect([tries.at(-1)!.status, tries.at(-1)!.body.error.code]).toEqual([429, 'too_many_attempts']);
  });
});
