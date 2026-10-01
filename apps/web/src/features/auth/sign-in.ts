import { LoginRequest } from '@wayfinder/contracts';
import type { Failure, Language } from './words';

// The sign-in form as one piece of state (spec 018). The desktop's PIN field and the phone's pad change the same
// PIN, so a person can switch between them and the dots and the field always agree.

const PIN_LENGTH = 4;

// What shows where the hint was: the hint, "Checking your details…" while the server checks, or why it failed.
export type Line = 'hint' | 'checking' | Failure;

export interface SignInForm {
  staffId: string;
  pin: string;
  remember: boolean;
  // A language that was pressed and comes later. English is always the one in use.
  language: Language | null;
  // Whether Contact your depot's line is open.
  contact: boolean;
  line: Line;
}

export type SignInAction =
  | { type: 'typeStaffId'; value: string }
  | { type: 'typePin'; value: string }
  | { type: 'pressDigit'; digit: string }
  | { type: 'pressDelete' }
  | { type: 'tickRemember'; on: boolean }
  | { type: 'pressLanguage'; language: Language | 'en' }
  | { type: 'pressContact' }
  | { type: 'send' }
  | { type: 'fail'; failure: Failure };

// A remembered staff ID is filled in, with Remember my staff ID still ticked.
export const startForm = (remembered: string): SignInForm => ({ staffId: remembered, pin: '', remember: remembered !== '', language: null, contact: false, line: 'hint' });

// The body Sign in sends, or null until the shared shape takes it: a staff ID and exactly four digits (rule 2).
export function loginBody(form: Pick<SignInForm, 'staffId' | 'pin'>): LoginRequest | null {
  const parsed = LoginRequest.safeParse({ staffId: form.staffId, pin: form.pin });
  return parsed.success ? parsed.data : null;
}

// A keyboard on the phone's pad: a digit presses its key, Backspace and Delete delete.
export function keyAction(key: string): SignInAction | null {
  if (/^\d$/.test(key)) return { type: 'pressDigit', digit: key };
  return key === 'Backspace' || key === 'Delete' ? { type: 'pressDelete' } : null;
}

// While the details are being checked nothing typed changes. Afterwards, a change brings the hint back, and a key
// that changes nothing, such as a fifth digit, leaves the form as it was.
function typing(form: SignInForm, change: Pick<SignInForm, 'staffId'> | Pick<SignInForm, 'pin'>): SignInForm {
  if (form.line === 'checking') return form;
  const next = { ...form, ...change };
  if (next.staffId === form.staffId && next.pin === form.pin) return form;
  return { ...next, line: 'hint' };
}

export function signIn(form: SignInForm, action: SignInAction): SignInForm {
  switch (action.type) {
    case 'typeStaffId':
      return typing(form, { staffId: action.value });
    case 'typePin':
      return typing(form, { pin: action.value.replace(/\D/g, '').slice(0, PIN_LENGTH) });
    case 'pressDigit':
      return /^\d$/.test(action.digit) && form.pin.length < PIN_LENGTH ? typing(form, { pin: form.pin + action.digit }) : form;
    case 'pressDelete':
      return typing(form, { pin: form.pin.slice(0, -1) });
    case 'tickRemember':
      // Kept as it was sent: the choice is read when the sign-in works.
      return form.line === 'checking' ? form : { ...form, remember: action.on };
    case 'pressLanguage':
      return { ...form, language: action.language === 'en' ? null : action.language };
    case 'pressContact':
      return { ...form, contact: !form.contact };
    case 'send':
      return { ...form, line: 'checking' };
    case 'fail':
      // A wrong pair empties the PIN for the next try; any other failure keeps it to send again.
      return { ...form, line: action.failure, pin: action.failure === 'wrong' ? '' : form.pin };
  }
}
