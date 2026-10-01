import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LOADING_DECISIONS, type Issue, type IssueDecision, type LoadingDecision } from '@wayfinder/contracts';
import storeManager from '@/assets/icons/icon-person-store-manager.png';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { orangeButton } from '@/features/plan/parts/look';
import {
  brandOfShop, clockTime, coldWords, countedLine, driverSentLine, issuePlace, issueTitle, NO_REPLACEMENT, raisedLine, receivedOf, refusalReplacementLine,
  REPORT_QUESTION, reportPlace, reportReplacementLine, reportSentLine, reportTitle, sendReplacementsTitle,
} from '@/features/loader/words';
import { cn } from '@/lib/utils';
import { openIssuePhoto, useReplaceOn, type Answering } from './issues';
import {
  answeredLine, atTheDock, driverAnswers, driverIssuePlace, driverIssueTitle, driverQuestion, driverRaised, stillOnLabel, stillOnValue,
} from './words';

// The two answers to a loader's flag (D-37), as the design's option cards.
const ANSWER: Record<LoadingDecision, { title: string; line: string }> = {
  go_short: { title: 'Go short', line: 'The truck leaves with what is at the dock.' },
  load_all: { title: 'Load it all', line: 'The rest comes from stock and goes on.' },
};
// A truck that cannot take it all (Q-20) gets the same two answers, said about room on the truck and not about stock.
const ROOM_ANSWER: Record<LoadingDecision, { title: string; line: string }> = {
  go_short: { title: 'Go short', line: 'The truck leaves with what fits.' },
  load_all: { title: 'Load it all', line: 'Make room on the truck for the rest.' },
};

// When a problem was raised, "02:33", in a grey chip. The first problem's sits on the column's heading row, as in
// the frame, and every later one's beside its title.
export function RaisedAt({ issue }: { issue: Issue }) {
  return <span className="shrink-0 rounded-full bg-muted px-2.5 py-[5px] text-[10px] leading-3 font-semibold tabular-nums">{clockTime(issue.raisedAt)}</span>;
}

// The line of the green card once an answer is sent, which names the depot the cartons go back to. A driver's problem
// and a shop's report tell the shop too (spec 015).
export function AnsweredLine({ issue }: { issue: Issue }) {
  const { data: me } = useMe();
  const depot = me?.depotId ?? 'the depot';
  if (issue.kind === 'loading') return <>{answeredLine(issue, depot)}</>;
  return <>{issue.kind === 'receipt' ? reportSentLine(issue) : driverSentLine(issue, depot)}</>;
}

// One open problem in full (Dispatcher · Live day · issue open): what is wrong, where, who raised it and when, the
// facts that bear on it, then the answers and the orange button that sends the chosen one.
export function IssueCard({ issue, answering, time, className }: { issue: Issue; answering: Answering; time: boolean; className?: string }) {
  if (issue.kind === 'loading') return <FlagCard issue={issue} answering={answering} time={time} className={className} />;
  if (issue.kind === 'receipt') return <ReportCard issue={issue} answering={answering} time={time} className={className} />;
  return <DriverCard issue={issue} answering={answering} time={time} className={className} />;
}

// A loader's flag (spec 012): the count at the dock and the note, then "Go short" or "Load it all", and "Send to loader".
// A truck that cannot take it all (Q-20) counts what fits instead, and its answers say so.
function FlagCard({ issue, answering, time, className }: { issue: Issue; answering: Answering; time: boolean; className?: string }) {
  const [choice, setChoice] = useState<LoadingDecision>('go_short');
  const brand = brandOfShop(issue.stop.shopName);
  const room = issue.reason === 'wont_fit';
  const answers = room ? ROOM_ANSWER : ANSWER;
  return (
    <article aria-label={issueTitle(issue)} className={className}>
      <Heading title={issueTitle(issue)} issue={issue} time={time} />
      <p className="mt-2 text-[11px] leading-[15px] text-muted-foreground">{issuePlace(issue)}</p>

      <dl className="mt-[9px] space-y-1 text-[11px] leading-[14px]">
        <Row label="Loader" value={raisedLine(issue)} first />
        <Row label={room ? 'Fits' : 'At the dock'} value={issue.lines.map((line) => countedLine(line, brand)).join(', ')} />
        {issue.note && <Row label="Note" value={issue.note} />}
      </dl>

      <Answers issue={issue} question="What should the loader do?" options={LOADING_DECISIONS.map((decision) => ({ decision, ...answers[decision] }))} choice={choice} onChoose={(decision) => setChoice(decision as LoadingDecision)} busy={answering.sending !== null} />
      <Send issue={issue} answering={answering} choice={choice} label="Send to loader" />
    </article>
  );
}

// The photo of a driver's problem or a shop's report, opened in a tab of its own from bytes fetched the shared way, which
// names the depot the tab shows (D-95). A photo that could not be opened says why beside the link.
function PhotoLink({ issue }: { issue: Issue }) {
  const [problem, setProblem] = useState<string | null>(null);
  // A photo still on its way when the card goes (a sign-out, a depot switch) is dropped, so a late answer from the old
  // session cannot sign out whoever signs in next.
  const onItsWay = useRef<AbortController | null>(null);
  useEffect(() => () => onItsWay.current?.abort(), []);
  const open = () => {
    setProblem(null);
    onItsWay.current?.abort();
    const asked = new AbortController();
    onItsWay.current = asked;
    void openIssuePhoto(issue, asked.signal).then((line) => { if (!asked.signal.aborted) setProblem(line); });
  };
  return (
    <>
      <button type="button" onClick={open} className="font-semibold text-foreground underline underline-offset-2">Open</button>
      {problem && <span role="alert" className="ml-1.5 text-bad">{problem}</span>}
    </>
  );
}

// The first answer is chosen until the dispatcher picks another; one no longer offered falls back to it.
function useChoice(options: { decision: IssueDecision }[]) {
  const [picked, setPicked] = useState<IssueDecision | null>(null);
  return [options.find((option) => option.decision === picked)?.decision ?? options[0]!.decision, setPicked] as const;
}

// A driver's problem (spec 013): a shop that refused some, with what it took, the driver, the note, the photo, the
// dock and what is still on the truck; or a shop that was closed. "Bring them back", for a refusal "Send N
// replacements" as well while a day is open (spec 015, D-59), and for a closed shop "Try again on this trip" while the
// trip is out. The shop sees the answer too, so the button sends it to both.
function DriverCard({ issue, answering, time, className }: { issue: Issue; answering: Answering; time: boolean; className?: string }) {
  const { data: me } = useMe();
  const replaceOn = useReplaceOn();
  const options = [
    ...driverAnswers(issue, me?.depotId ?? 'the depot'),
    ...(issue.kind === 'refused' && replaceOn && issue.short > 0
      ? [{ decision: 'send_replacements' as const, title: sendReplacementsTitle(issue.short, replaceOn), line: refusalReplacementLine(issue.short) }]
      : []),
  ];
  const [choice, setPicked] = useChoice(options);
  const rows: { label: string; value: ReactNode }[] = [
    ...(issue.kind === 'refused' ? [{ label: 'Driver', value: driverRaised(issue) }] : []),
    ...(issue.note ? [{ label: 'Note', value: issue.note }] : []),
    ...(issue.hasPhoto ? [{ label: 'Photo', value: <PhotoLink issue={issue} /> }] : []),
    ...(issue.kind === 'refused' ? [{ label: 'At the dock', value: atTheDock(issue) }] : []),
    { label: stillOnLabel(issue), value: stillOnValue(issue) },
  ];
  return (
    <article aria-label={driverIssueTitle(issue)} className={className}>
      <Heading title={driverIssueTitle(issue)} issue={issue} time={time} />
      <p className="mt-2 text-[11px] leading-[15px] text-muted-foreground">{driverIssuePlace(issue)}</p>

      <dl className="mt-[9px] space-y-1 text-[11px] leading-[14px]">
        {rows.map((row, i) => <Row key={row.label} label={row.label} value={row.value} first={i === 0} />)}
      </dl>

      <Answers issue={issue} question={driverQuestion(issue)} options={options} choice={choice} onChoose={setPicked} busy={answering.sending !== null} />
      <Send issue={issue} answering={answering} choice={choice} label="Send to driver and shop" />
    </article>
  );
}

// A shop's report on its receipt (spec 015, rule 12, D-58): what is missing, damaged or not cold, the delivery it is
// on, who confirmed it and when, each counted line as received of handed over, the cold check, the photo, then "Send N
// replacements" for the day an order placed now is for, or "No replacement", and "Send to shop". A report of the cold
// alone counts nothing short, so it only takes "No replacement", as does any report while no day is open.
function ReportCard({ issue, answering, time, className }: { issue: Issue; answering: Answering; time: boolean; className?: string }) {
  const replaceOn = useReplaceOn();
  const options = [
    ...(replaceOn && issue.short > 0
      ? [{ decision: 'send_replacements' as const, title: sendReplacementsTitle(issue.short, replaceOn), line: reportReplacementLine(issue.short) }]
      : []),
    { decision: 'no_replacement' as const, ...NO_REPLACEMENT },
  ];
  const [choice, setPicked] = useChoice(options);
  const rows: { label: ReactNode; key: string; value: ReactNode }[] = [
    {
      key: 'shop',
      label: <span className="inline-flex items-center gap-1.5"><img src={storeManager} alt="" className="size-3.5 object-contain" />Shop</span>,
      value: raisedLine(issue),
    },
    { key: 'received', label: 'Received', value: receivedOf(issue) },
    ...(issue.cold !== null ? [{ key: 'cold', label: 'Cold on arrival', value: coldWords(issue.cold) }] : []),
    ...(issue.hasPhoto ? [{ key: 'photo', label: 'Photo', value: <PhotoLink issue={issue} /> }] : []),
  ];
  return (
    <article aria-label={reportTitle(issue)} className={className}>
      <Heading title={reportTitle(issue)} issue={issue} time={time} />
      <p className="mt-2 text-[11px] leading-[15px] text-muted-foreground">{reportPlace(issue)}</p>

      <dl className="mt-[9px] space-y-1 text-[11px] leading-[14px]">
        {rows.map((row, i) => <Row key={row.key} label={row.label} value={row.value} first={i === 0} />)}
      </dl>

      <Answers issue={issue} question={REPORT_QUESTION} options={options} choice={choice} onChoose={setPicked} busy={answering.sending !== null} />
      <Send issue={issue} answering={answering} choice={choice} label="Send to shop" />
    </article>
  );
}

function Heading({ title, issue, time }: { title: string; issue: Issue; time: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-[15px] leading-5 font-bold">{title}</h3>
      {time && <RaisedAt issue={issue} />}
    </div>
  );
}

// The question and the design's option cards, one of them chosen.
function Answers({ issue, question, options, choice, onChoose, busy }: {
  issue: Issue; question: string; options: { decision: IssueDecision; title: string; line: string }[]; choice: IssueDecision; onChoose: (decision: IssueDecision) => void; busy: boolean;
}) {
  return (
    <>
      <p id={`answer-${issue.id}`} className="mt-[13px] text-xs leading-4 font-semibold">{question}</p>
      <div role="radiogroup" aria-labelledby={`answer-${issue.id}`} className="mt-[9px] space-y-2.5">
        {options.map((option) => (
          <button
            key={option.decision}
            type="button"
            role="radio"
            aria-checked={choice === option.decision}
            disabled={busy}
            onClick={() => onChoose(option.decision)}
            className={cn(
              'flex w-full items-center gap-3 rounded-[10px] bg-card px-[11px] py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              choice === option.decision ? 'border-2 border-foreground' : 'm-px w-[calc(100%-2px)] border',
            )}
          >
            <span aria-hidden="true" className={cn('size-[14px] shrink-0 rounded-full', choice === option.decision ? 'bg-foreground' : 'border-[1.5px] border-muted-foreground/60')} />
            <span className="min-w-0">
              <span className="block text-xs leading-4 font-semibold">{option.title}</span>
              <span className="block text-[10px] leading-[14px] text-muted-foreground">{option.line}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function Send({ issue, answering, choice, label }: { issue: Issue; answering: Answering; choice: IssueDecision; label: string }) {
  const sending = answering.sending === issue.id;
  return (
    <>
      <Button className={orangeButton('mt-[13px] h-[34px] w-full text-xs')} disabled={answering.sending !== null} focusableWhenDisabled onClick={() => answering.decide(issue, choice)}>
        {sending ? 'Sending…' : label}
      </Button>
      {answering.failed === issue.id && <p role="alert" className="mt-2 text-xs leading-4 font-semibold text-bad">Could not send. Try again.</p>}
    </>
  );
}

// A row of the problem's facts: what on the left, the detail on the right, as the design's report rows.
function Row({ label, value, first = false }: { label: ReactNode; value: ReactNode; first?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn('shrink-0', first && 'font-semibold')}>{label}</dt>
      <dd className="min-w-0 text-right text-muted-foreground">{value}</dd>
    </div>
  );
}
