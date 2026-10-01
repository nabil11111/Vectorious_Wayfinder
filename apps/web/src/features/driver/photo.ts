import { useRef, useState } from 'react';

// The proof photo (spec 013, D-47, plan.md "The photo"). The picture is turned upright, drawn at most 1280 px on its
// long side and made a JPEG at quality 0.7, then at 0.5 and 960 px if it is still over 500 KB. It is kept as a data
// URL, which rides inside the write and is also the preview: the app's content policy allows data: images and not
// blob: ones. The server takes only a whole JPEG of at most 500 KB and 2000 px a side.

export const PHOTO_MAX_BYTES = 512_000;

const TRIES = [{ side: 1280, quality: 0.7 }, { side: 960, quality: 0.5 }];

// A picture the phone could not turn into a photo the server takes: not an image, or one this browser cannot read.
export class UnusablePhoto extends Error {}

function jpegOf(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function dataUrlOf(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new UnusablePhoto('The photo could not be read.')));
    reader.onerror = () => reject(new UnusablePhoto('The photo could not be read.'));
    reader.readAsDataURL(blob);
  });
}

interface Picture { source: CanvasImageSource; width: number; height: number; done: () => void }

// The picture, upright. createImageBitmap turns it by its EXIF orientation; a browser whose createImageBitmap cannot
// read it, such as an older Safari, decodes it through an image element instead, from a data URL the content policy
// allows, and draws it upright as images are by default.
async function pictureOf(file: File): Promise<Picture> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
    } catch (error) {
      console.warn('createImageBitmap could not read the picture; decoding it as an image instead.', error);
    }
  }
  try {
    const image = new Image();
    image.src = await dataUrlOf(file);
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, done: () => image.removeAttribute('src') };
  } catch (error) {
    throw new UnusablePhoto(`That picture could not be read: ${String(error)}`);
  }
}

export async function photoOf(file: File): Promise<string> {
  const picture = await pictureOf(file);
  try {
    if (picture.width < 1 || picture.height < 1) throw new UnusablePhoto('The picture has no size.');
    const canvas = document.createElement('canvas');
    for (const { side, quality } of TRIES) {
      const scale = Math.min(1, side / Math.max(picture.width, picture.height));
      canvas.width = Math.max(1, Math.round(picture.width * scale));
      canvas.height = Math.max(1, Math.round(picture.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new UnusablePhoto('This phone could not draw the photo.');
      context.drawImage(picture.source, 0, 0, canvas.width, canvas.height);
      const jpeg = await jpegOf(canvas, quality);
      if (jpeg && jpeg.type === 'image/jpeg' && jpeg.size <= PHOTO_MAX_BYTES) return await dataUrlOf(jpeg);
    }
    throw new UnusablePhoto('The photo stayed over 500 KB.');
  } finally {
    picture.done();
  }
}

export const UNUSABLE = 'That picture could not be used. Take it again.';

// A form's photo: the data URL once taken, whether the last picture could not be used, and the input to take one.
export function usePhoto() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [unusable, setUnusable] = useState(false);
  const [reading, setReading] = useState(false);

  const pick = async (file: File) => {
    setReading(true);
    setUnusable(false);
    try {
      setPhoto(await photoOf(file));
    } catch (error) {
      console.warn('The picture could not be used.', error);
      setPhoto(null);
      setUnusable(true);
    } finally {
      setReading(false);
    }
  };

  return { photo, unusable, reading, inputRef, take: () => inputRef.current?.click(), pick: (file: File) => { void pick(file); } };
}
