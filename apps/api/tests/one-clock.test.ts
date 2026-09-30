import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every time a person sees comes from the app's one clock (D-18). Only these files may read the system time: the
// clock itself on both sides, and the sessions, which stay on real time.
const apps = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED = ['api/src/lib/clock.ts', 'web/src/lib/clock.ts', 'api/src/middleware/auth.ts', 'api/src/routes/auth.ts'];

// Comments are taken out first, so a sentence about new Date() is not a call to it.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const readsSystemTime = (source: string) => /\bnew Date\(\s*\)|\bDate\.now\(\s*\)/.test(code(source));

const sourceFiles = (dir: string) => readdirSync(path.join(apps, dir), { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => path.posix.join(dir, file.split(path.sep).join('/')));

describe('one clock', () => {
  it('AC-13 no source file outside the short list reads the system time', () => {
    const files = [...sourceFiles('api/src'), ...sourceFiles('web/src')];
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => !ALLOWED.includes(file) && readsSystemTime(readFileSync(path.join(apps, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('AC-13 the check catches new Date() with nothing in the brackets and Date.now(), and nothing else', () => {
    expect(readsSystemTime('const at = new Date();')).toBe(true);
    expect(readsSystemTime('const at = new Date( );')).toBe(true);
    expect(readsSystemTime('const ms = Date.now();')).toBe(true);
    expect(readsSystemTime('const at = new Date(clock.now);')).toBe(false);
    expect(readsSystemTime('// never call new Date() here\nconst at = now();')).toBe(false);
    expect(readsSystemTime('/* Date.now() is not allowed */ const at = now();')).toBe(false);
  });
});
