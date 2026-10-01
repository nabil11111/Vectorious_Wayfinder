import { useId, useState } from 'react';
import { DEFERRAL_CODES, type BoardOrder, type DeferralCode, type DraftDeferral } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { countOf, DEFERRAL, REASON_MOST, reasonFits, reasonLine } from '../words';
import type { BoardIndex } from './lookup';
import { inkButton, plainButton } from './look';
import { Pills } from './ui';

// Deferring, in place (spec 010, "Deferring, splitting"): the six reasons as chips and the sentence the shop will
// read. It defers one order, a shop row's orders or a whole group, each order with its own deferral. A carried-over
// order starts with its last code and reason. Until the sentence is written over, each order gets its own
// shop's sentence, so a group's "window" reasons name each shop's closing time. The sentence takes 200 characters at
// most: the box takes any length, so the browser never cuts a paste, and a change that would make it longer is
// refused whole with a line in red. Near the end the line counts what is left, and at 200 it says it is full (Q-11).
export function DeferForm({ orders, index, code, reason, onDefer, onCancel }: {
  orders: BoardOrder[];
  index: BoardIndex;
  code?: DeferralCode;
  reason?: string;
  onDefer: (deferrals: DraftDeferral[]) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const first = index.shop(orders[0]!.outletId);
  const [chosen, setChosen] = useState<DeferralCode | null>(code ?? null);
  const [text, setText] = useState(reason ?? (code && first ? DEFERRAL[code].sentence(first) : ''));
  const [written, setWritten] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const line = reasonLine(text.length, refused);
  const lineId = useId();

  const choose = (next: DeferralCode) => {
    setChosen(next);
    setProblem(null);
    if (!written && first) setText(DEFERRAL[next].sentence(first));
  };

  const submit = () => {
    if (!chosen) return setProblem('Choose why the order waits.');
    const deferrals = orders.map((order) => {
      const shop = index.shop(order.outletId);
      const sentence = written || orders.length === 1 || !shop ? text : DEFERRAL[chosen].sentence(shop);
      return { orderId: order.id, code: chosen, reason: sentence.trim() };
    });
    if (deferrals.some((deferral) => deferral.reason === '')) return setProblem('Write the sentence the shop will read.');
    if (deferrals.some((deferral) => deferral.reason.length > REASON_MOST)) return setProblem(`Keep the sentence to ${REASON_MOST} characters.`);
    onDefer(deferrals);
  };

  return (
    <form
      className="mt-2 space-y-2.5 rounded-[10px] bg-muted p-3"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <p className="text-[11px] leading-[14px] font-semibold">{orders.length === 1 ? 'Defer this order' : `Defer ${countOf(orders.length, 'order')}`}</p>
      <Pills
        label="Why it waits"
        value={chosen ?? ('' as DeferralCode)}
        onChange={choose}
        options={DEFERRAL_CODES.map((value) => ({ value, label: DEFERRAL[value].label }))}
        className="flex-wrap"
      />
      <div className="space-y-1">
        <label htmlFor={id} className="text-[11px] leading-[14px] text-muted-foreground">The shop reads</label>
        <textarea
          id={id}
          rows={2}
          value={text}
          aria-describedby={line ? lineId : undefined}
          onChange={(event) => {
            const next = event.target.value;
            setRefused(!reasonFits(next));
            if (!reasonFits(next)) return;
            setText(next);
            setWritten(true);
            setProblem(null);
          }}
          className="block w-full resize-none rounded-lg border bg-card px-2.5 py-1.5 text-xs leading-[16px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {line && (
          <p id={lineId} role={line.refused ? 'alert' : undefined} className={cn('text-right text-[11px] leading-[14px]', line.refused ? 'font-semibold text-bad' : 'text-muted-foreground')}>
            {line.words}
          </p>
        )}
      </div>
      {problem && <p role="alert" className="text-[11px] leading-[14px] font-semibold text-bad">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className={inkButton('h-8 px-4 text-xs')}>Defer</Button>
        <Button type="button" variant="outline" className={plainButton('h-8 px-4 text-xs')} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
