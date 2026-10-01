import { HttpError } from '../lib/errors';

const prefix = 'data:image/jpeg;base64,';
const maxBytes = 512_000;

function invalidPhoto(): never {
  throw new HttpError(400, 'invalid_input', 'The photo must be a whole JPEG of at most 500 KB.');
}

function photoBytes(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(prefix) || dataUrl.length > prefix.length + Math.ceil(maxBytes / 3) * 4) invalidPhoto();
  const encoded = dataUrl.slice(prefix.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalidPhoto();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > maxBytes || bytes.length < 4 || bytes.toString('base64') !== encoded) invalidPhoto();
  if (bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) invalidPhoto();
  return bytes;
}

function checkFrame(bytes: Buffer, offset: number, length: number): void {
  if (length < 8) invalidPhoto();
  const height = bytes.readUInt16BE(offset + 3);
  const width = bytes.readUInt16BE(offset + 5);
  const components = bytes[offset + 7]!;
  if (height < 1 || height > 2000 || width < 1 || width > 2000 || components === 0 || length !== 8 + 3 * components) invalidPhoto();
}

// Scan bytes are opaque: only their escaped FF bytes and restart markers matter to the marker walk.
function nextMarker(bytes: Buffer, offset: number): number {
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) continue;
    const start = offset - 1;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset]!;
    if (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) offset++;
    else return start;
  }
  return offset;
}

export function jpegOf(dataUrl: string): Buffer {
  const bytes = photoBytes(dataUrl);
  let offset = 2;
  let hasFrame = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalidPhoto();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!hasFrame || offset !== bytes.length) invalidPhoto();
      return bytes;
    }
    if (marker === 0x01) continue;
    if (marker === undefined || marker < 0xc0 || (marker >= 0xd0 && marker <= 0xd8)) invalidPhoto();
    if (offset + 2 > bytes.length) invalidPhoto();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalidPhoto();
    if (marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      checkFrame(bytes, offset, length);
      hasFrame = true;
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2];
      if (!hasFrame || length < 6 || !components || length !== 6 + 2 * components) invalidPhoto();
      offset = nextMarker(bytes, offset + length);
    } else offset += length;
  }
  return invalidPhoto();
}
