import { useReducer, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { Me } from '@wayfinder/contracts';
import { Wordmark } from '@/components/layout/Wordmark';
import { cn } from '@/lib/utils';
import { HOME, attemptSignIn, useLogin, useMe } from './api';
import { ContactDepot } from './parts/ContactDepot';
import { DistrictArtwork } from './parts/DistrictArtwork';
import { LanguageButtons } from './parts/LanguageButtons';
import { PinDots } from './parts/PinDots';
import { PinLine } from './parts/PinLine';
import { PinPad } from './parts/PinPad';
import { RememberStaffId } from './parts/RememberStaffId';
import { SignInButton } from './parts/SignInButton';
import { keepStaffId, rememberedStaffId } from './remember';
import { keyAction, loginBody, signIn, startForm } from './sign-in';
import { failureOf } from './words';

const LABEL = 'block text-xs font-semibold leading-[17px] text-label';
const FIELD = 'mt-1 h-[46px] w-full rounded-[8px] border border-border bg-card px-[13px] text-[15px] text-foreground outline-none transition-colors placeholder:text-mute focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
// The wordmark as the design draws it: the mark as wide as the words are tall, rounded to a pixel, then one pixel
// before "ayfinder". At 36 px the mark is 37 wide, at 24 px it is 24 wide.
const WORDMARK = 'leading-none gap-px';

// Sign-in as designed (spec 018): the desktop split from 1024 wide (frame 53:6373), and below it the phone frame
// (53:6276), centred at most 480 wide on a tablet. One form serves both: the desktop types the PIN into its field, the
// phone taps it on the pad, and both change the same PIN.
export function LoginPage() {
  const { data: me } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [form, dispatch] = useReducer(signIn, '', () => startForm(rememberedStaffId()));
  const pinField = useRef<HTMLInputElement>(null);
  const pinDots = useRef<HTMLOutputElement>(null);

  if (me) return <Navigate to={HOME[me.role]} replace />;

  const body = loginBody(form);
  const checking = form.line === 'checking';

  // After a failed sign-in the focus goes to the PIN: its field on a desktop, its dots on a phone, whichever shows.
  function focusPin() {
    pinField.current?.focus();
    if (document.activeElement !== pinField.current) pinDots.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body || checking) return;
    dispatch({ type: 'send' });
    let signedIn: Me;
    try {
      signedIn = await attemptSignIn(login, body);
    } catch (error) {
      dispatch({ type: 'fail', failure: failureOf(error) });
      focusPin();
      return;
    }
    keepStaffId(signedIn.staffId, form.remember);
    navigate(HOME[signedIn.role], { replace: true });
  }

  // A keyboard on the phone's dots or pad types digits as the keys do.
  function typeOnPad(event: KeyboardEvent) {
    const action = keyAction(event.key);
    if (!action) return;
    event.preventDefault();
    dispatch(action);
  }

  return (
    <div className="min-h-dvh bg-foreground lg:grid lg:grid-cols-[19fr_17fr] lg:bg-card">
      <header className="relative hidden min-h-[32rem] bg-foreground lg:block">
        <div className="absolute left-12 top-11">
          <Wordmark light className={cn('flex text-[36px]', WORDMARK, '[&>svg]:h-[0.74em]')} />
          <p className="mt-4 text-sm leading-[19px] text-mute">Delivery operations</p>
        </div>
        <div className="absolute inset-x-20 top-[148px] bottom-[92px]">
          <DistrictArtwork className="size-full" />
        </div>
      </header>

      <div className="relative mx-auto flex min-h-dvh max-w-[480px] flex-col lg:mx-0 lg:min-h-[32rem] lg:max-w-none lg:items-center lg:justify-center lg:pt-[72px]">
        <header className="relative h-[208px] shrink-0 lg:hidden">
          <Wordmark light className={cn('absolute left-6 top-12 text-2xl', WORDMARK, '[&>svg]:h-[0.72em]')} />
          <DistrictArtwork className="absolute left-[calc(50%-29px)] top-[33px] w-[149px]" />
        </header>
        <LanguageButtons pressed={form.language} onPress={(language) => dispatch({ type: 'pressLanguage', language })} className="absolute right-6 top-8 lg:right-10" />

        <main className="flex-1 rounded-t-[24px] bg-card px-6 pb-8 pt-[18px] lg:w-[400px] lg:flex-none lg:rounded-none lg:p-0">
          <form noValidate onSubmit={submit}>
            <h1 className="text-[22px] font-bold leading-[30px] text-foreground lg:text-[28px] lg:leading-[38px]">Sign in</h1>
            <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground lg:mt-[7px] lg:text-sm lg:leading-[19px]">Enter your staff ID and PIN.</p>

            <label htmlFor="staff-id" className={cn(LABEL, 'mt-2.5 lg:mt-6')}>Staff ID</label>
            <input id="staff-id" value={form.staffId} onChange={(event) => dispatch({ type: 'typeStaffId', value: event.target.value })} placeholder="D-014" autoComplete="username" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={16} readOnly={checking} className={cn(FIELD, 'font-mono')} />

            <label id="pin-label" htmlFor="pin" className={cn(LABEL, 'mt-[15px] lg:mt-[22px]')}>PIN</label>
            <input id="pin" ref={pinField} type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} value={form.pin} onChange={(event) => dispatch({ type: 'typePin', value: event.target.value })} placeholder="Enter four-digit PIN" aria-describedby="pin-line" readOnly={checking} className={cn(FIELD, 'hidden tracking-[0.3em] placeholder:tracking-normal lg:block')} />
            <PinDots ref={pinDots} count={form.pin.length} onKeyDown={typeOnPad} className="mt-2 lg:hidden" />
            <PinLine line={form.line} className="mt-[9px] lg:mt-[11px]" />
            <PinPad disabled={checking} onDigit={(digit) => dispatch({ type: 'pressDigit', digit })} onDelete={() => dispatch({ type: 'pressDelete' })} onKeyDown={typeOnPad} className="mt-[11px] lg:hidden" />

            <RememberStaffId checked={form.remember} onChange={(on) => dispatch({ type: 'tickRemember', on })} className="mt-4 lg:mt-[17px]" />
            <SignInButton ready={body !== null} checking={checking} className="mt-2 lg:mt-5" />
          </form>
          <ContactDepot open={form.contact} onPress={() => dispatch({ type: 'pressContact' })} className="mt-[22px] lg:mt-5" />
        </main>
      </div>
    </div>
  );
}
