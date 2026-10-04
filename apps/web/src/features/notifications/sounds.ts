import type { NotificationTone } from '@wayfinder/contracts';
import bad from '@/assets/sounds/bad.mp3';
import good from '@/assets/sounds/good.mp3';
import info from '@/assets/sounds/info.mp3';
import warn from '@/assets/sounds/warn.mp3';

// One short clip for each tone the bell already uses (spec 031). They are files in the app. Nothing is fetched
// to make a sound. Off is kept in the browser, and a browser that blocks storage stays on.
const CLIP: Record<NotificationTone, string> = { info, good, warn, bad };
export const SOUND_KEY = 'wayfinder-sounds';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

// The store is read inside the try. A render with no localStorage, as the tests do, stays on.
function storeOf(storage?: Store): Store {
  if (storage) return storage;
  return localStorage;
}

export function soundsOn(storage?: Store): boolean {
  try { return storeOf(storage).getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSoundsOn(on: boolean, storage?: Store): void {
  try { storeOf(storage).setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (error) { console.warn('Could not keep the sound setting.', error); }
}

// A browser that has not been clicked yet can refuse. The update is still shown.
export function playUpdate(tone: NotificationTone, storage?: Store): void {
  if (!soundsOn(storage)) return;
  void new Audio(CLIP[tone]).play().catch((error) => {
    // The update is already on screen. A tab that has never been clicked can refuse the sound.
    console.warn('Could not play the update sound.', error);
  });
}
