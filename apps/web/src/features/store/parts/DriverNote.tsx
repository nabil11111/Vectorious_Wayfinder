import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { noteFits, noteLine } from '../words';

// The note for the driver, with its label above and its line below, as the style guide's inputs are (Q-06). The
// box takes any length, so the browser never cuts a paste on its own. A change that would make the note longer than
// 200 characters is refused whole and the line says so in red. Near the end the line counts what is left, and at 200
// it says the note is full.
export function DriverNote({ note, disabled, onChange }: { note: string; disabled: boolean; onChange: (note: string) => void }) {
  const [refused, setRefused] = useState(false);
  const line = noteLine(note.length, refused);
  const lineId = useId();
  return (
    <>
      <label htmlFor="driver-note" className="block pt-0.5 text-xs leading-[15px] font-semibold text-muted-foreground">Note for the driver</label>
      <textarea
        id="driver-note"
        rows={1}
        value={note}
        disabled={disabled}
        aria-describedby={line ? lineId : undefined}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setRefused(!noteFits(next));
          if (noteFits(next)) onChange(next);
        }}
        className="mt-2 block field-sizing-content min-h-[47px] w-full resize-none rounded-[10px] border border-input bg-card px-3 py-[11px] text-[13px] leading-4 outline-none focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground disabled:text-muted-foreground/65 pointer-coarse:text-base"
      />
      {line && (
        <p id={lineId} role={line.refused ? 'alert' : undefined} className={cn('mt-1.5 text-right text-[11px] leading-[14px]', line.refused ? 'font-semibold text-bad' : 'text-muted-foreground')}>
          {line.words}
        </p>
      )}
    </>
  );
}
