import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { REMEMBER_KEY } from './remember';

// The whole sign-in page drawn once, as the browser gets it before any script runs (spec 018). Both layouts are in
// it and the screen's width shows one: the desktop split from 1024 wide, the phone frame below.

function drawPage() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const kept = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null, setItem: vi.fn(), removeItem: vi.fn() });
// The page's landmarks in order: the desktop's dark panel, then the phone's dark header.
const headers = (markup: string) => markup.split('<header').slice(1).map((part) => part.slice(0, part.indexOf('</header>')));

describe('the sign-in page', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('AC-6 draws the desktop panel from 1024 wide and the phone header below it, each with the artwork', () => {
    const [desktop, phone] = headers(drawPage());
    expect(desktop).toMatch(/^ class="[^"]*\bhidden\b[^"]*\blg:block\b/);
    expect(desktop).toContain('Delivery operations');
    expect(desktop).toContain('viewBox="0 0 600 660"');
    expect(phone).toMatch(/^ class="[^"]*\blg:hidden\b/);
    expect(phone).toContain('viewBox="0 0 600 660"');
  });

  it('AC-6 gives the phone its dots and pad, and the desktop its PIN field', () => {
    const markup = drawPage();
    expect(markup).toMatch(/<input[^>]*id="pin"[^>]*class="[^"]*\bhidden\b[^"]*\blg:block\b/);
    expect(markup).toMatch(/<output[^>]*class="[^"]*\blg:hidden\b/);
    expect(markup).toMatch(/<div[^>]*class="[^"]*\blg:hidden\b[^"]*"[^>]*><button type="button"[^>]*>1<\/button>/);
  });

  it('AC-9 fills in the remembered staff ID with Remember my staff ID ticked', () => {
    vi.stubGlobal('window', { localStorage: kept({ [REMEMBER_KEY]: 'P-001' }) });
    const markup = drawPage();
    expect(markup).toMatch(/<input[^>]*id="staff-id"[^>]*value="P-001"/);
    expect(markup).toMatch(/<input type="checkbox"[^>]*checked=""/);
  });

  it('AC-9 starts empty when the storage refuses, and Sign in stays off', () => {
    vi.stubGlobal('window', { get localStorage(): Storage { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    const markup = drawPage();
    expect(markup).toMatch(/<input[^>]*id="staff-id"[^>]*value=""/);
    expect(markup).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(markup).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Sign in<\/button>/);
  });
});
