import type { AuthErrorCode } from '@wayfinder/contracts';
import { ApiRequestError } from '@/lib/api';

// The lines of the sign-in page (spec 018, "Screen states"), in the design's words. The page picks its line from
// the error's code, never from the server's message.

export type Failure = 'wrong' | 'tooMany' | 'noSignal' | 'failed';
export type Language = 'si' | 'ta';

export const HINT = 'Enter your four-digit PIN.';
export const CHECKING = 'Checking your details…';

export const FAILURE_LINE: Record<Failure, string> = {
  wrong: 'Staff ID or PIN isn’t correct. Try again.',
  tooMany: 'Too many tries. Wait 15 minutes, or contact your depot.',
  noSignal: 'No signal. Signing in needs the network.',
  failed: 'Could not sign in. Try again.',
};

// The address limit's too_many_attempts is not a lock, but the person can do the same about it: wait.
const BY_CODE = new Map<string, Failure>([
  ['bad_credentials', 'wrong'],
  ['locked', 'tooMany'],
  ['too_many_attempts', 'tooMany'],
] satisfies [AuthErrorCode | 'too_many_attempts', Failure][]);

export function failureOf(error: unknown): Failure {
  if (error instanceof ApiRequestError) return BY_CODE.get(error.code) ?? 'failed';
  // fetch rejects with a TypeError when the request never reaches the server.
  if (error instanceof TypeError) return 'noSignal';
  return 'failed';
}

// What a screen reader hears for the PIN's dots.
export const pinCount = (digits: number) => `${digits} of 4 digits entered`;

export const LANGUAGE_NAME: Record<Language, string> = { si: 'Sinhala', ta: 'Tamil' };
export const languageLine = (language: Language) => `${LANGUAGE_NAME[language]} is coming. Wayfinder is in English for now.`;

export const CONTACT_LINE = 'Ask your depot’s dispatcher for your staff ID and PIN.';
