import { useState } from 'react';
import { cn } from '@/lib/utils';
import { hhmm, readClock } from '../words';

// The trip's leaving time (rule 5, Edit plan · leaves 03:15). The chip says when the trip leaves; a click opens a
// field where Enter keeps a time written HH:MM, anything else stays unsaved with how to write it, and Escape or
// leaving the field changes nothing. A time the dispatcher set shows in slate with × back to the usual time.
export function LeaveField({ set, usual, onSet }: {
  // The time the dispatcher set, or null for the usual one.
  set: number | null;
  // When the trip leaves by itself, as the checker timed it, or null when it has no times yet.
  usual: number | null;
  onSet: (minutes: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(false);
  const shown = set ?? usual;

  if (editing) {
    return (
      <span className="flex flex-col items-end gap-1">
        <label className="flex h-[23px] items-center gap-1.5 rounded-full border bg-card pr-1 pl-2.5 text-[11px] font-semibold focus-within:ring-3 focus-within:ring-ring/50">
          leaves
          <input
            // The field opens because it was asked for, so it takes the typing at once.
            autoFocus
            value={text}
            placeholder="03:15"
            aria-label="Leaving time"
            aria-invalid={wrong}
            onChange={(event) => { setText(event.target.value); setWrong(false); }}
            onBlur={() => { setEditing(false); setWrong(false); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEditing(false);
                setWrong(false);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const minutes = readClock(text);
                if (minutes === null) {
                  setWrong(true);
                } else {
                  onSet(minutes);
                  setEditing(false);
                }
              }
            }}
            className="w-11 bg-transparent font-mono outline-none placeholder:text-muted-foreground/65"
          />
        </label>
        {wrong && <span role="alert" className="text-[11px] font-semibold text-bad">Write the time as 03:15.</span>}
      </span>
    );
  }

  const open = () => {
    setText(shown === null ? '' : hhmm(shown));
    setEditing(true);
  };
  if (set === null) {
    return (
      <button type="button" onClick={open} className="h-[23px] rounded-full bg-muted px-2.5 text-[11px] font-semibold whitespace-nowrap outline-none hover:bg-border focus-visible:ring-3 focus-visible:ring-ring/50">
        {shown === null ? 'leaving time' : `leaves ${hhmm(shown)}`}
      </button>
    );
  }
  return (
    <span className={cn('flex h-[23px] items-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground')}>
      <button type="button" onClick={open} className="h-full rounded-l-full pr-1 pl-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">leaves {hhmm(set)}</button>
      <button type="button" aria-label="Leave at the usual time" onClick={() => onSet(null)} className="h-full rounded-r-full pr-2.5 pl-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">×</button>
    </span>
  );
}
