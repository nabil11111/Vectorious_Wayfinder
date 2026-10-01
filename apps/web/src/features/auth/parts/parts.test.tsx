import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ARTWORK_DISTRICTS } from '@/lib/map/login-artwork-shapes';
import { CHECKING, CONTACT_LINE, FAILURE_LINE, HINT, languageLine, pinCount } from '../words';
import { ContactDepot } from './ContactDepot';
import { DistrictArtwork } from './DistrictArtwork';
import { LanguageButtons } from './LanguageButtons';
import { PinDots } from './PinDots';
import { PinLine } from './PinLine';
import { PinPad } from './PinPad';
import { RememberStaffId } from './RememberStaffId';
import { SignInButton } from './SignInButton';

// The sign-in page's parts (spec 018), drawn to markup and pressed through their props: every control is a real
// button or input with a name, and each one asks the page for the change it stands for.

type Props = Record<string, unknown> & { children?: ReactNode };

// Every element a part draws, parts inside it included.
function drawn(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(drawn);
  if (!isValidElement<Props>(node)) return [];
  if (typeof node.type === 'function') return drawn((node.type as (props: Props) => ReactNode)(node.props));
  return [node, ...drawn(node.props.children)];
}
const textOf = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<Props>(node) ? textOf(node.props.children) : '';
};
// A button's name: its label, or else the words on it.
const nameOf = (element: ReactElement<Props>) => (element.props['aria-label'] as string | undefined) ?? textOf(element.props.children);
const buttons = (node: ReactNode) => drawn(node).filter((element) => element.type === 'button');
const button = (node: ReactNode, name: string) => {
  const found = buttons(node).find((element) => nameOf(element) === name);
  if (!found) throw new Error(`No button named ${name}.`);
  return found;
};
const press = (element: ReactElement<Props>) => (element.props.onClick as () => void)();
const count = (markup: string, part: string) => markup.split(part).length - 1;

describe('AC-6 the district artwork', () => {
  const markup = renderToStaticMarkup(<DistrictArtwork />);

  it('draws every district in the design frame of 600 by 660', () => {
    expect(markup).toContain('viewBox="0 0 600 660"');
    expect(count(markup, '<path')).toBe(25);
  });

  it('fills the served districts teal and the rest slate, with borders in the panel colour', () => {
    expect(count(markup, 'fill-art-served')).toBe(ARTWORK_DISTRICTS.filter((district) => district.served).length);
    expect(count(markup, 'fill-art-land')).toBe(ARTWORK_DISTRICTS.filter((district) => !district.served).length);
    expect(count(markup, 'stroke-foreground')).toBe(25);
  });

  it('is decoration only, hidden from screen readers', () => {
    expect(markup).toMatch(/^<svg[^>]*aria-hidden="true"/);
  });
});

describe('AC-7 the PIN pad', () => {
  const pad = (disabled: boolean, onDigit = vi.fn(), onDelete = vi.fn()) => PinPad({ disabled, onDigit, onDelete });

  it('has the ten digits in the design order and a delete key, all real buttons', () => {
    const keys = buttons(pad(false));
    expect(keys.map(nameOf)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Delete last PIN digit']);
    expect(keys.every((key) => key.props.type === 'button')).toBe(true);
  });

  it('asks for the digit on its key, and delete asks to delete', () => {
    const onDigit = vi.fn();
    const onDelete = vi.fn();
    const drawnPad = pad(false, onDigit, onDelete);
    press(button(drawnPad, '7'));
    press(button(drawnPad, '0'));
    press(button(drawnPad, 'Delete last PIN digit'));
    expect(onDigit.mock.calls).toEqual([['7'], ['0']]);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('turns every key off while the details are being checked', () => {
    expect(buttons(pad(false)).some((key) => key.props.disabled)).toBe(false);
    expect(buttons(pad(true)).every((key) => key.props.disabled)).toBe(true);
  });
});

describe('AC-7 the PIN dots', () => {
  it('fills one dot per digit and says the count to a screen reader', () => {
    for (const digits of [0, 1, 3, 4]) {
      const markup = renderToStaticMarkup(<PinDots count={digits} />);
      expect(count(markup, 'data-filled="true"')).toBe(digits);
      expect(count(markup, 'data-filled="false"')).toBe(4 - digits);
      expect(markup).toContain(pinCount(digits));
    }
  });

  it('is named by the PIN label and described by the line under it', () => {
    const markup = renderToStaticMarkup(<PinDots count={0} />);
    expect(markup).toContain('aria-labelledby="pin-label"');
    expect(markup).toContain('aria-describedby="pin-line"');
  });
});

describe('AC-8 the line under the PIN', () => {
  it('gives the phone its hint, and the desktop no line until there is something to say', () => {
    const markup = renderToStaticMarkup(<PinLine line="hint" />);
    expect(markup).toContain(HINT);
    expect(markup).toContain('lg:hidden');
  });

  it('says the details are being checked, and why a sign-in failed', () => {
    expect(renderToStaticMarkup(<PinLine line="checking" />)).toContain(CHECKING);
    for (const failure of ['wrong', 'tooMany', 'noSignal', 'failed'] as const) {
      const markup = renderToStaticMarkup(<PinLine line={failure} />);
      expect(markup).toContain(FAILURE_LINE[failure]);
      expect(markup).toContain('text-bad-ink');
    }
  });

  it('is announced when it changes', () => {
    const markup = renderToStaticMarkup(<PinLine line="wrong" />);
    expect(markup).toContain('id="pin-line"');
    expect(markup).toContain('aria-live="polite"');
  });
});

describe('the Sign in button', () => {
  it('stays off until there is a staff ID and four digits', () => {
    expect(SignInButton({ ready: false, checking: false }).props.disabled).toBe(true);
    expect(SignInButton({ ready: true, checking: false }).props.disabled).toBe(false);
    expect(textOf(SignInButton({ ready: true, checking: false }))).toBe('Sign in');
  });

  it('says Signing in while the details are being checked, and takes no second press', () => {
    const checking = SignInButton({ ready: true, checking: true });
    expect(textOf(checking)).toBe('Signing in…');
    expect(checking.props['aria-disabled']).toBe(true);
    expect(checking.props.type).toBe('submit');
  });
});

describe('AC-9 Remember my staff ID', () => {
  it('is a real checkbox named by its words, with the PIN reminder as its description', () => {
    const markup = renderToStaticMarkup(<RememberStaffId checked={false} onChange={vi.fn()} />);
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Remember my staff ID');
    expect(markup).toContain('You’ll still enter your PIN.');
    expect(markup).toContain('aria-describedby="remember-hint"');
  });

  it('shows whether it is ticked and asks for the change', () => {
    const onChange = vi.fn();
    const input = drawn(RememberStaffId({ checked: true, onChange })).find((element) => element.type === 'input');
    if (!input) throw new Error('No checkbox drawn.');
    expect(input.props.checked).toBe(true);
    (input.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('AC-10 the language buttons', () => {
  const drawnButtons = (pressed: 'si' | 'ta' | null, onPress = vi.fn()) => LanguageButtons({ pressed, onPress });

  it('names each language, and English stays the one pressed', () => {
    for (const pressed of [null, 'si', 'ta'] as const) {
      const keys = buttons(drawnButtons(pressed));
      expect(keys.map((key) => [nameOf(key), key.props['aria-pressed']])).toEqual([['Sinhala', false], ['Tamil', false], ['English', true]]);
    }
  });

  it('shows each language in its own letters', () => {
    const markup = renderToStaticMarkup(<LanguageButtons pressed={null} onPress={vi.fn()} />);
    expect(markup).toContain('lang="si"');
    expect(markup).toContain('සිං');
    expect(markup).toContain('lang="ta"');
    expect(markup).toContain('த');
    expect(markup).toContain('EN');
  });

  it('asks for the language pressed', () => {
    const onPress = vi.fn();
    const drawnGroup = drawnButtons(null, onPress);
    press(button(drawnGroup, 'Sinhala'));
    press(button(drawnGroup, 'Tamil'));
    press(button(drawnGroup, 'English'));
    expect(onPress.mock.calls).toEqual([['si'], ['ta'], ['en']]);
  });

  it('says the pressed language comes later in a line under the buttons, and nothing before', () => {
    expect(renderToStaticMarkup(<LanguageButtons pressed={null} onPress={vi.fn()} />)).not.toContain('is coming');
    expect(renderToStaticMarkup(<LanguageButtons pressed="si" onPress={vi.fn()} />)).toContain(languageLine('si'));
    expect(renderToStaticMarkup(<LanguageButtons pressed="ta" onPress={vi.fn()} />)).toContain(languageLine('ta'));
  });
});

describe('AC-11 Contact your depot', () => {
  it('is a button that says whether its line is open', () => {
    expect(button(ContactDepot({ open: false, onPress: vi.fn() }), 'Contact your depot').props['aria-expanded']).toBe(false);
    expect(button(ContactDepot({ open: true, onPress: vi.fn() }), 'Contact your depot').props['aria-expanded']).toBe(true);
  });

  it('shows who can help only once pressed', () => {
    const closed = renderToStaticMarkup(<ContactDepot open={false} onPress={vi.fn()} />);
    expect(closed).toContain('Can’t sign in?');
    expect(closed).not.toContain('dispatcher');
    expect(renderToStaticMarkup(<ContactDepot open onPress={vi.fn()} />)).toContain(CONTACT_LINE);
  });

  it('asks the page to open or close its line', () => {
    const onPress = vi.fn();
    press(button(ContactDepot({ open: false, onPress }), 'Contact your depot'));
    expect(onPress).toHaveBeenCalledOnce();
  });
});
