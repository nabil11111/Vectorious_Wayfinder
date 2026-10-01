import type { ReactNode } from 'react';
import { NumberField } from '@base-ui/react/number-field';
import type { Brand, DeliveryFigures, ShortReason, StoreDeliveryLine } from '@wayfinder/contracts';
import damaged from '@/assets/icons/icon-damaged.png';
import shortfall from '@/assets/icons/icon-shortfall.png';
import { Chip } from '@/components/ui/chip';
import { countOf, expectedWords, lineGoods, receiptLineName, refusedAtDoorLine, SHORT_REASON_WORDS, shortChip, shortFromDepotLine } from '../words';
import { goodsIcon } from './icons';
import { Panel } from './Panel';

type LineFigures = DeliveryFigures['byLine'][number];

const STEP = 'flex size-11 shrink-0 items-center justify-center rounded-[10px] border bg-card text-lg leading-none font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:text-muted-foreground/45';

// − the count +, as Confirm delivery draws it. The count is the form's own and runs from 0 to what the driver handed
// over. It can be typed as well.
function ReceivedCounter({ name, value, max, disabled, onChange }: { name: string; value: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <NumberField.Root
      value={value}
      min={0}
      max={max}
      disabled={disabled}
      locale="en-GB"
      format={{ maximumFractionDigits: 0, useGrouping: false }}
      onValueChange={(next) => onChange(Math.min(max, Math.max(0, Math.round(next ?? 0))))}
    >
      <NumberField.Group className="flex items-center">
        <NumberField.Decrement aria-label={`One less: ${name}`} className={STEP}>−</NumberField.Decrement>
        <NumberField.Input
          aria-label={`${name} received`}
          maxLength={3}
          onClick={(event) => event.currentTarget.select()}
          className="w-16 min-w-0 bg-transparent p-0 text-center text-xl leading-6 font-semibold tabular-nums outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-foreground disabled:text-muted-foreground"
        />
        <NumberField.Increment aria-label={`One more: ${name}`} className={STEP}>+</NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
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
export function CountCard({ brand, line, figures, count, reason, disabled, onCount }: {
  brand: Brand; line: StoreDeliveryLine; figures: LineFigures; count: number; reason: ShortReason; disabled: boolean; onCount: (count: number) => void;
}) {
  const name = receiptLineName(brand, line);
  const short = figures.expected - count;
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
        <ReceivedCounter name={name} value={count} max={figures.expected} disabled={disabled} onChange={onCount} />
      </div>
      {short > 0 && <Chip tone="warn" size="sm" className="mt-[21px] px-[9px] py-1.5">{shortChip(short, line.unit, reason)}</Chip>}
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
