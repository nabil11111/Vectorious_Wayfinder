import { describe, expect, it } from 'vitest';
import { keyAction, loginBody, signIn, startForm, type SignInAction, type SignInForm } from './sign-in';

// The sign-in form's one piece of state (spec 018): the desktop's PIN field and the phone's pad change the same PIN.

const run = (form: SignInForm, ...actions: SignInAction[]) => actions.reduce(signIn, form);
const press = (...digits: string[]): SignInAction[] => digits.map((digit) => ({ type: 'pressDigit', digit }));
const blank = startForm('');
const typed = run(blank, { type: 'typeStaffId', value: 'P-001' }, ...press('1', '2', '3', '4'));

describe('AC-7 the pad fills one dot per digit up to four, ignores a fifth and empties the last on delete', () => {
  it('starts with no digits', () => {
    expect(blank.pin).toBe('');
  });

  it('adds one digit per key, up to four', () => {
    const forms = press('1', '2', '3', '4').reduce<SignInForm[]>((seen, action) => [...seen, signIn(seen.at(-1) ?? blank, action)], []);
    expect(forms.map((form) => form.pin)).toEqual(['1', '12', '123', '1234']);
  });

  it('ignores a fifth digit and leaves the form as it was', () => {
    const four = run(blank, ...press('1', '2', '3', '4'));
    expect(signIn(four, { type: 'pressDigit', digit: '5' })).toBe(four);
  });

  it('empties the last dot on delete, and does nothing with no digits', () => {
    expect(run(blank, ...press('1', '2', '3'), { type: 'pressDelete' }).pin).toBe('12');
    expect(signIn(blank, { type: 'pressDelete' })).toBe(blank);
  });

  it('takes only digits from the pad', () => {
    expect(signIn(blank, { type: 'pressDigit', digit: 'a' })).toBe(blank);
    expect(signIn(blank, { type: 'pressDigit', digit: '12' })).toBe(blank);
  });

  it('changes the same PIN from the desktop field and the pad', () => {
    expect(run(blank, { type: 'typePin', value: '12' }, ...press('3')).pin).toBe('123');
    expect(run(blank, ...press('1'), { type: 'typePin', value: '19' }).pin).toBe('19');
  });

  it('keeps only the digits typed in the desktop field, four at most', () => {
    expect(signIn(blank, { type: 'typePin', value: '12a4' }).pin).toBe('124');
    expect(signIn(blank, { type: 'typePin', value: '123456' }).pin).toBe('1234');
  });

  it('lets a keyboard type on the pad: a digit presses its key, Backspace and Delete delete', () => {
    expect(keyAction('7')).toEqual({ type: 'pressDigit', digit: '7' });
    expect(keyAction('Backspace')).toEqual({ type: 'pressDelete' });
    expect(keyAction('Delete')).toEqual({ type: 'pressDelete' });
    expect(keyAction('a')).toBeNull();
    expect(keyAction('Enter')).toBeNull();
  });
});

describe('rule 2 Sign in stays off until there is a staff ID and four digits', () => {
  it('sends nothing without a staff ID or with fewer than four digits', () => {
    expect(loginBody({ staffId: '', pin: '1234' })).toBeNull();
    expect(loginBody({ staffId: '   ', pin: '1234' })).toBeNull();
    expect(loginBody({ staffId: 'P-001', pin: '123' })).toBeNull();
    expect(loginBody({ staffId: 'P-001', pin: '12a4' })).toBeNull();
  });

  it('sends the staff ID in the shared shape, upper-cased and trimmed', () => {
    expect(loginBody({ staffId: ' p-001 ', pin: '1234' })).toEqual({ staffId: 'P-001', pin: '1234' });
  });
});

describe('AC-8 what a failed sign-in does to the form', () => {
  const sent = signIn(typed, { type: 'send' });

  it('shows Checking your details while the server checks', () => {
    expect(sent.line).toBe('checking');
  });

  it('changes nothing typed while the details are being checked', () => {
    expect(run(sent, { type: 'typeStaffId', value: 'D-014' }, { type: 'typePin', value: '9' }, { type: 'pressDelete' }, ...press('9'), { type: 'tickRemember', on: true })).toBe(sent);
  });

  it('empties the PIN and keeps the staff ID on a wrong staff ID or PIN', () => {
    const wrong = signIn(sent, { type: 'fail', failure: 'wrong' });
    expect(wrong).toMatchObject({ line: 'wrong', pin: '', staffId: 'P-001' });
  });

  it('keeps the PIN on too many tries, no signal and a server error', () => {
    for (const failure of ['tooMany', 'noSignal', 'failed'] as const) {
      expect(signIn(sent, { type: 'fail', failure })).toMatchObject({ line: failure, pin: '1234', staffId: 'P-001' });
    }
  });

  it('brings the hint back once the person changes the staff ID or the PIN', () => {
    const wrong = signIn(sent, { type: 'fail', failure: 'wrong' });
    expect(run(wrong, ...press('5')).line).toBe('hint');
    expect(run(signIn(sent, { type: 'fail', failure: 'noSignal' }), { type: 'pressDelete' }).line).toBe('hint');
    expect(run(wrong, { type: 'typeStaffId', value: 'P-002' }).line).toBe('hint');
  });

  it('keeps the line when a key changes nothing', () => {
    const noSignal = signIn(sent, { type: 'fail', failure: 'noSignal' });
    expect(run(noSignal, ...press('5'))).toBe(noSignal);
  });
});

describe('AC-9 the form starts from the remembered staff ID', () => {
  it('fills the staff ID in and ticks Remember my staff ID when one is kept', () => {
    expect(startForm('P-001')).toMatchObject({ staffId: 'P-001', remember: true, pin: '' });
  });

  it('starts empty and unticked when none is kept', () => {
    expect(startForm('')).toMatchObject({ staffId: '', remember: false, pin: '' });
  });

  it('ticks and unticks Remember my staff ID', () => {
    expect(run(blank, { type: 'tickRemember', on: true }).remember).toBe(true);
    expect(run(blank, { type: 'tickRemember', on: true }, { type: 'tickRemember', on: false }).remember).toBe(false);
  });
});

describe('AC-10 Sinhala and Tamil say they come later and English stays', () => {
  it('remembers which language was pressed, and English clears it', () => {
    expect(signIn(blank, { type: 'pressLanguage', language: 'si' }).language).toBe('si');
    expect(signIn(blank, { type: 'pressLanguage', language: 'ta' }).language).toBe('ta');
    expect(run(blank, { type: 'pressLanguage', language: 'ta' }, { type: 'pressLanguage', language: 'en' }).language).toBeNull();
  });

  it('leaves what was typed alone', () => {
    expect(signIn(typed, { type: 'pressLanguage', language: 'si' })).toMatchObject({ staffId: 'P-001', pin: '1234', line: 'hint' });
  });
});

describe('AC-11 Contact your depot shows who can help', () => {
  it('opens its line on a press and closes it on the next', () => {
    expect(blank.contact).toBe(false);
    expect(signIn(blank, { type: 'pressContact' }).contact).toBe(true);
    expect(run(blank, { type: 'pressContact' }, { type: 'pressContact' }).contact).toBe(false);
  });
});
