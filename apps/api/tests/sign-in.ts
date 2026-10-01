import type { LoginRequest } from '@wayfinder/contracts';
import type request from 'supertest';
import { DEMO_USERS } from '../src/db/fixtures';
import { config } from '../src/lib/config';

// Every test signs in through here (spec 018). A fixture account is named by its username, which nobody types any
// more: its staff ID comes from the fixtures, and its PIN is the one the seed gave it, admin's own for admin.

export const SIGN_IN = '/api/v1/auth/login';
export const PIN = config.SEED_PIN;
export const ADMIN_PIN = config.SEED_ADMIN_PIN;

export function signInBody(username: string): LoginRequest {
  const account = DEMO_USERS.find((user) => user.username === username);
  if (!account) throw new Error(`${username} is not a fixture account.`);
  return { staffId: account.staffId, pin: account.role === 'admin' ? ADMIN_PIN : PIN };
}

// Sends the sign-in from whatever asks, so an agent keeps the session cookie it is answered with. A fixture account
// is named by its username, and an account a test made itself by its staff ID and PIN.
export const signInAs = (asker: { post(url: string): request.Test }, who: string | LoginRequest) =>
  asker.post(SIGN_IN).send(typeof who === 'string' ? signInBody(who) : who);
