import { useState } from 'react';
import type { BoardOrder, Brand } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { cubic, tonnes, whole } from '../words';
import { inkButton, plainButton } from './look';

// Splitting, in place (spec 010, rule 8): a number per line of what stays on this stop. The first part takes those
// numbers and keeps the order's place on its stop, and the second takes the rest and starts unplanned. The
// server checks the split and writes both parts; the form only asks for something in each part.
export function SplitForm({ order, brand, busy, tripKg, tripM3, capKg, capM3, onSplit, onCancel }: {
  order: BoardOrder;
  brand: Brand;
  busy: boolean;
  tripKg: number | null;
  tripM3: number | null;
  capKg: number | null;
  capM3: number | null;
  onSplit: (keep: { productId: string; quantity: number }[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [keep, setKeep] = useState<Record<string, number>>(() => Object.fromEntries(order.lines.map((line) => [line.productId, 0])));
  const [problem, setProblem] = useState<string | null>(null);
  const kept = (productId: string) => keep[productId] ?? 0;
  const inFirst = order.lines.some((line) => kept(line.productId) > 0);
  const inSecond = order.lines.some((line) => kept(line.productId) < line.quantity);
  const units = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const keptUnits = order.lines.reduce((sum, line) => sum + kept(line.productId), 0);
  const share = units === 0 ? 0 : keptUnits / units;

  const submit = async () => {
    if (!inFirst || !inSecond) return setProblem('Leave something in each part.');
    setProblem(await onSplit(order.lines.map((line) => ({ productId: line.productId, quantity: kept(line.productId) }))));
  };

  return (
    <form className="mt-2 space-y-2.5 rounded-[10px] bg-muted p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="text-sm font-semibold">Keep on this trip · {brand}. The rest goes back to unplanned.</p>
      <p className="text-xs leading-4 text-muted-foreground">A split cannot be undone. The two parts replace this order.</p>
      <p className="text-sm">This order is {tonnes(order.load.kg)} · {cubic(order.load.m3)}. By the units kept, about {tonnes(order.load.kg * share)} stays and {tonnes(order.load.kg * (1 - share))} goes back{tripKg !== null && capKg !== null ? `. This trip is ${tonnes(tripKg)} of ${tonnes(capKg)}${tripM3 !== null && capM3 !== null ? ` and ${cubic(tripM3)} of ${cubic(capM3)}` : ''} before the split` : ''}.</p>
      <ul className="space-y-1.5">
        {order.lines.map((line) => (
          <li key={line.productId}>
            <label className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{line.name} · {line.quantity - kept(line.productId)} left unplanned</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${line.name} that stay`}
                value={String(kept(line.productId))}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const typed = Number(event.target.value.replace(/\D/g, '') || '0');
                  setKeep({ ...keep, [line.productId]: Math.min(line.quantity, typed) });
                  setProblem(null);
                }}
                className="h-8 w-14 rounded-lg border bg-card px-2 text-right font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span className="w-14 text-muted-foreground">of {whole(line.quantity)}</span>
            </label>
          </li>
        ))}
      </ul>
      {problem && <p role="alert" className="text-[11px] leading-[14px] font-semibold text-bad">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className={inkButton('h-8 px-4 text-xs')} disabled={busy} focusableWhenDisabled>{busy ? 'Splitting…' : 'Split'}</Button>
        <Button type="button" variant="outline" className={plainButton('h-8 px-4 text-xs')} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
