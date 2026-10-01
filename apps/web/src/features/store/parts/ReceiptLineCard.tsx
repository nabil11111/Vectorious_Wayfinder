import { useId, type ReactNode } from 'react';
import { SHORT_REASONS, type Brand, type DeliveryFigures, type ShortReason, type StoreDeliveryLine } from '@wayfinder/contracts';
import damaged from '@/assets/icons/icon-damaged.png';
import shortfall from '@/assets/icons/icon-shortfall.png';
import { Chip } from '@/components/ui/chip';
import { countLine } from '@/features/loader/words';
import { cn } from '@/lib/utils';
import { receiptBox } from '../receipt-counts';
import { countOf, expectedWords, lineGoods, overLine, receiptLineName, refusedAtDoorLine, SHORT_REASON_WORDS, shortChip, shortFromDepotLine } from '../words';
import { Choice } from './Choice';
import { goodsIcon } from './icons';
import { Panel } from './Panel';

type LineFigures = DeliveryFigures['byLine'][number];

const STEP = 'flex size-11 shrink-0 items-center justify-center rounded-[10px] border bg-card text-lg leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:text-muted-foreground/45';

// − the count +, as Confirm delivery draws it. The count is the form's own and runs from 0 to what the driver handed
// over. It can be typed as well, and the box keeps what is typed as it is (Q-38), as the loader's flag box and the shop's
// quantity box do: a minus, a fraction or more than was handed over is never turned into another number. It is marked
// red with its line under the card's counter row, and − and + wait until it is a whole number from 0 to what was handed
// over. text is what the box holds while it is not the count.
function ReceivedCounter({ name, value, text, max, disabled, lineId, onStep, onType, onLeave }: {
  name: string; value: number; text: string | undefined; max: number; disabled: boolean; lineId: string;
  onStep: (value: number) => void; onType: (text: string) => void; onLeave: () => void;
}) {
  const wrong = text !== undefined && receiptBox(text, max).wrong !== null;
  const shown = text ?? String(value);
  const off = disabled || wrong;
  const step = (by: number) => onStep(Math.min(max, Math.max(0, value + by)));
  return (
    <div role="group" className="flex items-center">
      <button type="button" aria-label={`One less: ${name}`} disabled={off || value <= 0} className={STEP} onClick={() => step(-1)}>−</button>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${name} received`}
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? lineId : undefined}
        value={shown}
        disabled={disabled}
        onChange={(event) => onType(event.currentTarget.value)}
        onBlur={onLeave}
        // A tap selects the count, so typing replaces it.
        onClick={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          if (!wrong) step(event.key === 'ArrowUp' ? 1 : -1);
        }}
        // A longer text than four figures widens the box, so all of it shows.
        style={shown.length > 4 ? { width: `${shown.length + 1}ch` } : undefined}
        className={cn(
          'w-16 min-w-0 rounded-md bg-transparent p-0 text-center text-xl leading-6 font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:text-muted-foreground',
          wrong && 'text-bad ring-1 ring-bad focus-visible:ring-bad',
        )}
      />
      <button type="button" aria-label={`One more: ${name}`} disabled={off || value >= max} className={STEP} onClick={() => step(1)}>+</button>
    </div>
  );
}

// A note under a line, with its picture: what the depot sent short, or what the shop refused at the door.
function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="mt-2.5 flex items-center gap-2 text-xs leading-4 text-muted-foreground">
      <img src={icon} alt="" className="size-4 shrink-0 object-contain" />
      {children}
    </p>
  );
}

// Confirm delivery's card for one line (Shop · Confirm delivery): the goods' picture and name, what the driver handed
// over, the shop's own count, the units missing or damaged once the count is lower, and what the depot sent short or
// the shop refused at the door, reported where it was found (D-56).
export function CountCard({ brand, line, figures, count, text, reason, disabled, onStep, onType, onLeave, onReason }: {
  brand: Brand; line: StoreDeliveryLine; figures: LineFigures; count: number; text: string | undefined; reason: ShortReason; disabled: boolean;
  onStep: (count: number) => void; onType: (text: string) => void; onLeave: () => void; onReason: (reason: ShortReason) => void;
}) {
  const name = receiptLineName(brand, line);
  const short = figures.expected - count;
  const lineId = useId();
  const wrong = text === undefined ? null : receiptBox(text, figures.expected).wrong;
  return (
    <Panel line className="pt-[9px]">
      <div className="flex items-end">
        {/* The picture's own margin sits left of the card's padding, as the frame places it. */}
        <img src={goodsIcon(brand, line.temp)} alt="" className="-ml-[9px] size-9 shrink-0 object-contain" />
        <h2 className="min-w-0 flex-1 font-sans text-[15px] leading-[18px] font-semibold">{name}</h2>
        <p className="shrink-0 self-center pl-3 text-xs leading-[15px] text-muted-foreground">{expectedWords(figures.expected)}</p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-sm leading-[17px] font-semibold">Received</span>
        <ReceivedCounter name={name} value={count} text={text} max={figures.expected} disabled={disabled} lineId={lineId} onStep={onStep} onType={onType} onLeave={onLeave} />
      </div>
      {wrong && (
        <p id={lineId} role="alert" className="mt-1.5 text-right text-[11px] leading-[14px] font-semibold text-bad">
          {wrong === 'over' ? overLine(figures.expected) : countLine(figures.expected)}
        </p>
      )}
      {short > 0 && (
        // What is wrong with this line's short units, its own answer (Q-40): a crate can come damaged while a pallet
        // never came.
        <div className="mt-[21px] flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
          <Chip tone="warn" size="sm" className="px-[9px] py-1.5">{shortChip(short, line.unit, reason)}</Chip>
          <div className="flex items-center gap-2.5">
            <p id={`${lineId}-why`} className="text-xs leading-4 font-semibold">What’s wrong?</p>
            <div role="radiogroup" aria-labelledby={`${lineId}-why`} className="flex h-10 overflow-hidden rounded-[10px] border bg-card">
              {SHORT_REASONS.map((why) => (
                <Choice key={why} on={reason === why} disabled={disabled} joined onClick={() => onReason(why)}>{SHORT_REASON_WORDS[why]}</Choice>
              ))}
            </div>
          </div>
        </div>
      )}
      {figures.shortFromDepot > 0 && <Note icon={shortfall}>{shortFromDepotLine(figures.shortFromDepot)}</Note>}
      {figures.refused > 0 && <Note icon={damaged}>{refusedAtDoorLine(figures.refused)}</Note>}
    </Panel>
  );
}

// A line of a saved or sent receipt (Shop · Short delivery · receipt pending sync, Shop · Receipt sent): what was
// handed over, what the shop received, and what it said was missing or damaged.
export function ReceivedCard({ brand, line, figures, reason }: { brand: Brand; line: StoreDeliveryLine; figures: LineFigures; reason: ShortReason | null }) {
  return (
    <Panel line className="pt-4 pb-5">
      <h2 className="font-sans text-[15px] leading-[18px] font-semibold">{lineGoods(brand, line, figures.expected)} expected</h2>
      <dl className="mt-[15px] space-y-[21px] border-t pt-[17px] text-[13px] leading-4">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Received</dt>
          <dd className="font-semibold">{countOf(figures.received ?? 0, line.unit)}</dd>
        </div>
        {figures.short > 0 && reason && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{SHORT_REASON_WORDS[reason]}</dt>
            <dd className="font-semibold text-warn-ink">{countOf(figures.short, line.unit)}</dd>
          </div>
        )}
      </dl>
    </Panel>
  );
}
