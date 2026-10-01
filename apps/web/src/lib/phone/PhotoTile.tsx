import type { RefObject } from 'react';
import proofPhoto from '@/assets/icons/icon-proof-photo.png';
import { cn } from '@/lib/utils';

// The hidden file input behind "Take photo" and the photo tile: the camera on a phone, the file picker on a laptop.
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

// The photo tile (spec 013's Something's wrong, spec 015's report): the design's proof-photo picture and its label until
// a photo is taken, then the photo itself, and "Reading…" while a picture is being read. A tap takes a photo.
export function PhotoTile({ photo, reading, disabled = false, onTake, label = 'Photo', className }: {
  photo: string | null; reading: boolean; disabled?: boolean; onTake: () => void; label?: string; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onTake}
      disabled={disabled}
      className={cn('flex h-[52px] w-[130px] shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-[10px] border-[1.5px] border-dashed border-border bg-card/60 text-[13px] leading-none font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}
    >
      {photo
        ? <img src={photo} alt="The photo taken" className="h-full w-full object-cover" />
        : <><img src={proofPhoto} alt="" className="size-6 object-contain" />{reading ? 'Reading…' : label}</>}
    </button>
  );
}
