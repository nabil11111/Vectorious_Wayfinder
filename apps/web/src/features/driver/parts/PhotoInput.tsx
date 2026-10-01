import type { RefObject } from 'react';

// The hidden file input behind "Take photo" and the Photo tile: the camera on a phone, the file picker on a laptop.
export function PhotoInput({ inputRef, onPick }: { inputRef: RefObject<HTMLInputElement | null>; onPick: (file: File) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture="environment"
      tabIndex={-1}
      aria-hidden="true"
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0];
        // The same picture can be picked again after a retake.
        event.target.value = '';
        if (file) onPick(file);
      }}
    />
  );
}
