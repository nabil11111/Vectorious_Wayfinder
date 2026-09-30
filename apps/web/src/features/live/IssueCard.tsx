import { useState } from 'react';
import { LOADING_DECISIONS, type Issue, type LoadingDecision } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { orangeButton } from '@/features/plan/parts/look';
import { brandOfShop, clockTime, countedLine, issuePlace, issueTitle, raisedLine } from '@/features/loader/words';
import { cn } from '@/lib/utils';
import type { Answering } from './issues';

// The two answers to a loader's flag (D-37), as the design's option cards.
const ANSWER: Record<LoadingDecision, { title: string; line: string }> = {
  go_short: { title: 'Go short', line: 'The truck leaves with what is at the dock.' },
  load_all: { title: 'Load it all', line: 'The rest comes from stock and goes on.' },
};

// When a problem was raised, "02:33", in a grey chip. The first problem's sits on the column's heading row, as in
// the frame, and every later one's beside its title.
export function RaisedAt({ issue }: { issue: Issue }) {
  return <span className="shrink-0 rounded-full bg-muted px-2.5 py-[5px] text-[10px] leading-3 font-semibold tabular-nums">{clockTime(issue.raisedAt)}</span>;
}

// One open problem in full (Dispatcher · Live day · issue open): what is wrong, where, who flagged it and when, what
// is at the dock and the note, then the two answers with "Go short" chosen, and "Send to loader".
export function IssueCard({ issue, answering, time, className }: { issue: Issue; answering: Answering; time: boolean; className?: string }) {
  const [choice, setChoice] = useState<LoadingDecision>('go_short');
  const brand = brandOfShop(issue.stop.shopName);
  const sending = answering.sending === issue.id;
  const busy = answering.sending !== null;
  return (
    <article aria-label={issueTitle(issue)} className={className}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] leading-5 font-bold">{issueTitle(issue)}</h3>
        {time && <RaisedAt issue={issue} />}
      </div>
      <p className="mt-2 text-[11px] leading-[15px] text-muted-foreground">{issuePlace(issue)}</p>

      <dl className="mt-[9px] space-y-1 text-[11px] leading-[14px]">
        <Row label="Loader" value={raisedLine(issue)} first />
        <Row label="At the dock" value={issue.lines.map((line) => countedLine(line, brand)).join(', ')} />
        {issue.note && <Row label="Note" value={issue.note} />}
      </dl>

      <p id={`answer-${issue.id}`} className="mt-[13px] text-xs leading-4 font-semibold">What should the loader do?</p>
      <div role="radiogroup" aria-labelledby={`answer-${issue.id}`} className="mt-[9px] space-y-2.5">
        {LOADING_DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            role="radio"
            aria-checked={choice === decision}
            disabled={busy}
            onClick={() => setChoice(decision)}
            className={cn(
              'flex w-full items-center gap-3 rounded-[10px] bg-card px-[11px] py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              choice === decision ? 'border-2 border-foreground' : 'm-px w-[calc(100%-2px)] border',
            )}
          >
            <span aria-hidden="true" className={cn('size-[14px] shrink-0 rounded-full', choice === decision ? 'bg-foreground' : 'border-[1.5px] border-muted-foreground/60')} />
            <span className="min-w-0">
              <span className="block text-xs leading-4 font-semibold">{ANSWER[decision].title}</span>
              <span className="block text-[10px] leading-[14px] text-muted-foreground">{ANSWER[decision].line}</span>
            </span>
          </button>
        ))}
      </div>

      <Button className={orangeButton('mt-[13px] h-[34px] w-full text-xs')} disabled={busy} focusableWhenDisabled onClick={() => answering.decide(issue, choice)}>
        {sending ? 'Sending…' : 'Send to loader'}
      </Button>
      {answering.failed === issue.id && <p role="alert" className="mt-2 text-xs leading-4 font-semibold text-bad">Could not send. Try again.</p>}
    </article>
  );
}

// A row of the problem's facts: what on the left, the detail on the right, as the design's report rows.
function Row({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn('shrink-0', first && 'font-semibold')}>{label}</dt>
      <dd className="min-w-0 text-right text-muted-foreground">{value}</dd>
    </div>
  );
}
