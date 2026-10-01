import { useState, type ComponentType, type ReactNode } from 'react';
import { DEMO_DAY, type SampleOrdersPreview, type SampleOrdersResult } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { canOrderLine, dayWords, SAMPLE_CHOICES, sampleAnswer, useAddSampleOrders, useSampleOrdersPreview, type Choice } from './sample-orders';

// The demo control's "Add sample shop orders" (spec 028, D-103): while orders are open, the dispatcher has 10, 25 or
// every shop of the depot on show that has not ordered place its own order. Like the reset, it opens in place of the
// control, never in a browser box.

const TITLE = 'font-heading text-lg font-bold text-foreground';
const BUTTON = 'h-12 w-full rounded-[10px] text-base font-semibold';
const PLAIN = 'bg-card dark:border-border dark:bg-card dark:hover:bg-muted';

export interface SampleOrdersViewProps {
  Title: ComponentType<{ className?: string; children?: ReactNode }>;
  // The depot the dispatcher's session is on: one depot or Both.
  depot: string;
  deliveryDate: string;
  preview: SampleOrdersPreview | undefined;
  choice: Choice;
  onChoose: (choice: Choice) => void;
  placing: boolean;
  result: SampleOrdersResult | undefined;
  problem: string | null;
  onPlace: () => void;
  onBack: () => void;
}

// The panel as drawn, from what the hooks hold, so each of its states can be drawn on its own.
export function SampleOrdersView({ Title, depot, deliveryDate, preview, choice, onChoose, placing, result, problem, onPlace, onBack }: SampleOrdersViewProps) {
  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5 pr-8">
          <Title className={TITLE}>Sample shop orders</Title>
          {result.depots.map((done) => (
            <p key={done.depotId} role="status" className="text-sm text-foreground">{sampleAnswer(done, result.deliveryDate)}</p>
          ))}
        </div>
        <Button variant="outline" className={cn(BUTTON, PLAIN)} onClick={onBack}>Done</Button>
      </div>
    );
  }
  const names = preview?.depots.map((counted) => counted.depotId) ?? (depot === 'Both' ? ['Peliyagoda', 'Kandy'] : [depot]);
  const where = names.length > 1 ? `At ${names.join(' and ')}, that many at each.` : `At ${names[0]}.`;
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5 pr-8">
        <Title className={TITLE}>Add sample shop orders</Title>
        <p className="text-sm text-muted-foreground">
          Each shop places its own order for {dayWords(deliveryDate)}, as if its manager pressed Place. {where}
        </p>
        {preview?.depots.map((counted) => <p key={counted.depotId} className="text-sm text-muted-foreground">{canOrderLine(counted)}</p>)}
      </div>
      <div role="radiogroup" aria-label="How many shops" className="grid gap-2">
        {SAMPLE_CHOICES.map(({ value, label }) => (
          <button key={label} type="button" role="radio" aria-checked={value === choice} disabled={placing} onClick={() => onChoose(value)}
            className={cn('h-11 rounded-[10px] border px-3 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              value === choice ? 'border-secondary bg-secondary text-secondary-foreground' : 'bg-card text-foreground hover:bg-muted')}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">When the shops that have not ordered run out, 10 and 25 shops go on with small top-ups from shops that already ordered.</p>
      {problem && <p role="alert" className="text-sm font-semibold text-bad">{problem}</p>}
      <div className="grid gap-2">
        <Button className={BUTTON} disabled={placing} focusableWhenDisabled onClick={onPlace}>{placing ? 'Placing…' : 'Place the orders'}</Button>
        <Button variant="outline" className={cn(BUTTON, PLAIN)} disabled={placing} onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}

// What a failed press says. One that never reached the server, or met a proxy instead, asks to try again.
function failure(error: Error | null) {
  if (!error) return null;
  return error instanceof ApiRequestError && error.code !== 'network' ? error.message : 'Could not reach Wayfinder. Try again.';
}

// The panel with its hooks: the shops counted, the choice, the press and its answer.
export function SampleOrders({ Title, depot, onBack }: { Title: SampleOrdersViewProps['Title']; depot: string; onBack: () => void }) {
  const preview = useSampleOrdersPreview();
  const add = useAddSampleOrders();
  const [choice, setChoice] = useState<Choice>(10);
  return (
    <SampleOrdersView Title={Title} depot={depot} deliveryDate={preview.data?.deliveryDate ?? DEMO_DAY.deliveryDay} preview={preview.data} choice={choice} onChoose={setChoice}
      placing={add.isPending} result={add.data} problem={failure(add.error)} onPlace={() => add.mutate(choice)}
      onBack={() => { add.reset(); onBack(); }} />
  );
}
