import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(web, file));

function pngSize(file: string) {
  const bytes = read(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

it('links a manifest Chrome can install as an app, with square 192 and 512 icons', () => {
  const html = read('index.html').toString();
  expect(html).toContain('<link rel="manifest" href="/manifest.json" />');
  const manifest = JSON.parse(read('public/manifest.json').toString()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ name: 'Wayfinder', short_name: 'Wayfinder', start_url: '/', display: 'standalone' });
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }),
    expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }),
  ]));
  expect(pngSize('public/icon-192.png')).toEqual({ width: 192, height: 192 });
  expect(pngSize('public/icon-512.png')).toEqual({ width: 512, height: 512 });
});
