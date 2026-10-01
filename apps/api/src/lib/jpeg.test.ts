import { describe, expect, it } from 'vitest';
import { HttpError } from './errors';
import { jpegOf } from './jpeg';

const start = Buffer.from([0xff, 0xd8]);
const end = Buffer.from([0xff, 0xd9]);
const message = 'The photo must be a whole JPEG of at most 500 KB.';

function segment(marker: number, payload: number[] | Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, Buffer.from(payload)]);
}

function frame(width = 1280, height = 960, marker = 0xc0): Buffer {
  return segment(marker, [8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
}

const jpeg = (...parts: Buffer[]) => Buffer.concat([start, ...parts, end]);
const dataUrl = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString('base64')}`;
const scan = () => segment(0xda, [1, 1, 0, 0, 63, 0]);

function rejectPhoto(value: string): void {
  expect(() => jpegOf(value)).toThrowError(HttpError);
  expect(() => jpegOf(value)).toThrowError(expect.objectContaining({ status: 400, code: 'invalid_input', message }));
}

describe('driver proof JPEGs', () => {
  it('AC-10 returns the original bytes after checking markers before the frame', () => {
    const bytes = jpeg(segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), segment(0xfe, [1, 2, 3]), frame());
    expect(jpegOf(dataUrl(bytes))).toEqual(bytes);
  });

  it.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])('AC-10 accepts SOF marker %i and dimensions at the allowed edges', (marker) => {
    for (const [width, height] of [[1, 2000], [2000, 1]]) {
      const bytes = jpeg(frame(width, height, marker));
      expect(jpegOf(dataUrl(bytes))).toEqual(bytes);
    }
  });

  it('AC-10 accepts exactly 512,000 bytes and refuses one more', () => {
    const headers = Buffer.concat([start, frame(), scan()]);
    const bytes = Buffer.concat([headers, Buffer.alloc(512_000 - headers.length - end.length, 0x11), end]);
    expect(jpegOf(dataUrl(bytes))).toEqual(bytes);
    rejectPhoto(dataUrl(Buffer.concat([bytes.subarray(0, -2), Buffer.from([0x11]), end])));
  });

  it('AC-10 refuses a missing JPEG start, missing end or trailing bytes', () => {
    const bytes = jpeg(frame());
    for (const invalid of [Buffer.alloc(0), bytes.subarray(2), bytes.subarray(0, -2), Buffer.concat([bytes, Buffer.from([0])])]) {
      rejectPhoto(dataUrl(invalid));
    }
  });

  it.each([0xc4, 0xc8, 0xcc])('AC-10 does not mistake marker %i for a frame', (marker) => {
    rejectPhoto(dataUrl(jpeg(frame(1280, 960, marker))));
  });

  it('AC-10 refuses a forged start with no frame, including a frame hidden inside a segment', () => {
    rejectPhoto(dataUrl(jpeg()));
    rejectPhoto(dataUrl(jpeg(segment(0xe0, frame()))));
    rejectPhoto(dataUrl(jpeg(scan(), frame())));
  });

  it.each([[2400, 960], [2001, 960], [1280, 2001], [0, 960], [1280, 0]])('AC-10 refuses dimensions %i by %i', (width, height) => {
    rejectPhoto(dataUrl(jpeg(frame(width, height))));
  });

  it('refuses malformed or truncated segments before and after a frame', () => {
    const malformed = [
      Buffer.from([0xff, 0xe0, 0]),
      Buffer.from([0xff, 0xe0, 0, 0]),
      Buffer.from([0xff, 0xe0, 0, 1]),
      Buffer.from([0xff, 0xe0, 0, 10, 1]),
      Buffer.from([0x11, 0xe0, 0, 2]),
      Buffer.from([0xff, 0x00]),
      start,
    ];
    for (const bytes of malformed) {
      rejectPhoto(dataUrl(jpeg(bytes, frame())));
      rejectPhoto(dataUrl(jpeg(frame(), bytes)));
    }
  });

  it('refuses a frame without its whole header or with missing component records', () => {
    rejectPhoto(dataUrl(jpeg(segment(0xc0, [8, 0, 1, 0, 1]))));
    rejectPhoto(dataUrl(jpeg(segment(0xc0, [8, 0, 1, 0, 1, 0]))));
    rejectPhoto(dataUrl(jpeg(segment(0xc0, [8, 0, 1, 0, 1, 2, 1, 0x11, 0]))));
  });

  it('accepts marker fill bytes, stuffed scan bytes and restart markers without decoding the image', () => {
    const bytes = jpeg(Buffer.from([0xff]), frame(), scan(), Buffer.from([0x12, 0xff, 0, 0x34, 0xff, 0xd0, 0x56]));
    expect(jpegOf(dataUrl(bytes))).toEqual(bytes);
  });

  it('refuses a premature end marker, a second start or a malformed segment after scan data', () => {
    for (const bytes of [end, start, Buffer.from([0xff, 0xe0, 0, 20])]) {
      rejectPhoto(dataUrl(jpeg(frame(), scan(), Buffer.from([0x12]), bytes)));
    }
  });

  it('refuses wrong data URLs and noncanonical base64 instead of accepting the decoder fallback', () => {
    const value = dataUrl(jpeg(frame()));
    for (const invalid of [
      '', value.replace('image/jpeg', 'image/png'), value.replace(';base64', ''), value.replace('data:', ''),
      `${value}!`, `${value}\n`, value.replace(',', ', '), value.replace('base64,', 'base64,='),
      `${value.slice(0, -2)}l=`, value.replace(/=+$/, ''),
    ]) rejectPhoto(invalid);
  });
});
