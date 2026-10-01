import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from '@/lib/api';
import { CHECKING, CONTACT_LINE, FAILURE_LINE, HINT, failureOf, languageLine, pinCount } from './words';

// The lines of the sign-in page (spec 018, "Screen states"), and which one a failed sign-in shows. The page picks its
// line from the error's code, never from the server's message.

const answer = (status: number, code: string) => new ApiRequestError(status, code, 'The server said something else.');

describe('AC-8 the line picked from a failed sign-in', () => {
  it('shows the Error line for a wrong staff ID or PIN', () => {
    expect(failureOf(answer(401, 'bad_credentials'))).toBe('wrong');
    expect(FAILURE_LINE.wrong).toBe('Staff ID or PIN isn’t correct. Try again.');
  });

  it('shows Too many tries for a locked staff ID, and for the address limit too', () => {
    expect(failureOf(answer(429, 'locked'))).toBe('tooMany');
    expect(failureOf(answer(429, 'too_many_attempts'))).toBe('tooMany');
    expect(FAILURE_LINE.tooMany).toBe('Too many tries. Wait 15 minutes, or contact your depot.');
  });

  it('shows No signal when the request never reaches the server', () => {
    expect(failureOf(new TypeError('Failed to fetch'))).toBe('noSignal');
    expect(FAILURE_LINE.noSignal).toBe('No signal. Signing in needs the network.');
  });

  it('shows the server error line for any other failure', () => {
    for (const error of [answer(500, 'internal'), answer(502, 'network'), answer(400, 'invalid_input'), answer(400, 'toString'), new Error('Something broke.')]) {
      expect(failureOf(error)).toBe('failed');
    }
    expect(FAILURE_LINE.failed).toBe('Could not sign in. Try again.');
  });

  it('has the hint and the checking line where the failures show', () => {
    expect(HINT).toBe('Enter your four-digit PIN.');
    expect(CHECKING).toBe('Checking your details…');
  });
});

describe('AC-8 the lines for what the API client really throws', () => {
  afterEach(() => vi.unstubAllGlobals());

  const failure = async () => {
    try {
      await api('/auth/login', { method: 'POST', json: { staffId: 'P-001', pin: '1234' } });
    } catch (error) {
      return failureOf(error);
    }
    throw new Error('The sign-in should have failed.');
  };

  it('is No signal when fetch cannot reach the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await failure()).toBe('noSignal');
  });

  it('is the Error line for the 401 the server sends for a wrong pair', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'bad_credentials', message: "Staff ID or PIN isn't correct. Try again." } }, { status: 401 })));
    expect(await failure()).toBe('wrong');
  });

  it('is Too many tries for the 429 the address limit sends', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'too_many_attempts', message: 'Too many sign-in attempts. Try again in a few minutes.' } }, { status: 429 })));
    expect(await failure()).toBe('tooMany');
  });

  it('is the server error line for a proxy page that is not the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Bad gateway</h1>', { status: 502 })));
    expect(await failure()).toBe('failed');
  });
});

describe('the PIN digits, as a screen reader hears them', () => {
  it('counts the digits entered out of four', () => {
    expect([0, 1, 4].map(pinCount)).toEqual(['0 of 4 digits entered', '1 of 4 digits entered', '4 of 4 digits entered']);
  });
});

describe('AC-10 the line for a language that comes later', () => {
  it('names the language and says the app is in English for now', () => {
    expect(languageLine('si')).toBe('Sinhala is coming. Wayfinder is in English for now.');
    expect(languageLine('ta')).toBe('Tamil is coming. Wayfinder is in English for now.');
  });
});

describe('AC-11 the line under Contact your depot', () => {
  it('says who can help', () => {
    expect(CONTACT_LINE).toBe('Ask your depot’s dispatcher for your staff ID and PIN.');
  });
});
