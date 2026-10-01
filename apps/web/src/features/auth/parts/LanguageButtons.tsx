import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { languageLine, type Language } from '../words';

// The frame draws the letters in Noto Sans Sinhala and Noto Sans Tamil, bold. Most computers lack them, so each
// language names fonts that draw its letter at the frame's size: on a Mac, Sinhala Sangam MN as it is, and Tamil MN
// two pixels up, as the Mac's own Tamil fallback draws the letter a third smaller.
const LETTERS_FONT: Record<Language, CSSProperties> = {
  si: { fontFamily: '"Noto Sans Sinhala", "Sinhala Sangam MN", "Nirmala UI", sans-serif' },
  ta: { fontFamily: '"Tamil MN", "Noto Sans Tamil", "Nirmala UI", sans-serif', fontSize: 15 },
};

const LANGUAGES: { key: Language | 'en'; letters: string; name: string }[] = [
  { key: 'si', letters: 'සිං', name: 'Sinhala' },
  { key: 'ta', letters: 'த', name: 'Tamil' },
  { key: 'en', letters: 'EN', name: 'English' },
];

const CIRCLE = 'flex size-10 items-center justify-center rounded-full border text-[13px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50';
// On the phone's dark header English is the white circle; on the desktop's white side it is the ink one.
const IN_USE = 'border-card bg-card font-semibold text-foreground lg:border-foreground lg:bg-foreground lg:text-secondary-foreground';
const LATER = 'border-ink-line font-bold text-secondary-foreground hover:bg-secondary-foreground/10 lg:border-border lg:bg-card lg:text-foreground lg:hover:bg-muted';

// The language buttons (frames 53:6373 and 53:6276), each language in its own letters. Only English works for now:
// it stays pressed, and Sinhala or Tamil says in a line under the buttons that it comes later (spec 018, AC-10).
export function LanguageButtons({ pressed, onPress, className }: { pressed: Language | null; onPress: (language: Language | 'en') => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-end', className)}>
      <div role="group" aria-label="Language" className="flex flex-col gap-1.5">
        {LANGUAGES.map(({ key, letters, name }) => (
          <button key={key} type="button" aria-label={name} aria-pressed={key === 'en'} onClick={() => onPress(key)} className={cn(CIRCLE, key === 'en' ? IN_USE : LATER)}>
            {key === 'en' ? letters : <span lang={key} style={LETTERS_FONT[key]}>{letters}</span>}
          </button>
        ))}
      </div>
      {/* Over the phone's artwork the line keeps the header's ink behind it, so it reads clearly. */}
      <p role="status" className="absolute right-0 top-full mt-2 w-max max-w-[10.5rem] rounded-[4px] bg-foreground text-right text-[11px] leading-[15px] text-secondary-foreground lg:max-w-none lg:bg-transparent lg:text-xs lg:leading-[17px] lg:text-muted-foreground">
        {pressed && languageLine(pressed)}
      </p>
    </div>
  );
}
