import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Brand, OrderLine, StoreNextOrder, StoreProduct } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDraftForm, type OpenOrder, type Saving } from './draft-form';
import { useNextOrder } from './next-order';
import { ORANGE } from './parts/actions';
import { BottomBar } from './parts/BottomBar';
import { DriverNote } from './parts/DriverNote';
import { goodsIcon } from './parts/icons';
import { LoadError, StaleNotice } from './parts/LoadError';
import { NoOpenDay } from './parts/NextOrderCard';
import { PageHeader } from './parts/PageHeader';
import { Panel } from './parts/Panel';
import { QuantityStepper, type QuantityBox } from './parts/QuantityStepper';
import {
  ENTRANCE, PLACED_ELSEWHERE, PLACED_ELSEWHERE_LOST, TEMP_NAME, brandList, brandUnits, clockTime, cubic, cutoffTime, inListOrder, itemFigures, kilos, lineWords, plural,
  shortDay, windowWords,
} from './words';

// New order (Shop · New orders, and its Style, Tech and desktop frames). The shop orders from its brand's
// fixed list, the form saves itself as a draft, and one tap places it.
export function NewOrderPage() {
  const next = useNextOrder();

  if (!next.data) {
    return (
      <Page>
        <PageHeader title="New order" small />
        {next.isError
          ? <LoadError what="the order form" error={next.error} busy={next.isFetching} onRetry={() => { void next.refetch(); }} />
          : <FormSkeleton />}
      </Page>
    );
  }
  // A later fetch that fails leaves the last answer on the screen, so the form says it may be out of date and
  // an old "draft saved" never passes for a fresh one.
  const stale = next.isError && <StaleNotice busy={next.isFetching} onRetry={() => { void next.refetch(); }} />;
  const { deliveryDate } = next.data;
  if (!deliveryDate) {
    return (
      <Page>
        {stale}
        <PageHeader title="New order" small />
        <NoOpenDay />
      </Page>
    );
  }
  return <OrderForm next={{ ...next.data, deliveryDate }} stale={stale} />;
}

const Page = ({ children }: { children: ReactNode }) => <div className="space-y-2.5 lg:space-y-[22px] lg:pt-2.5">{children}</div>;

// The yellow line of the style guide: something the manager should know before going on.
const Notice = ({ children }: { children: ReactNode }) => (
  <p role="status" className="rounded-[10px] bg-warn-tint px-3 pt-2.5 pb-2 text-xs leading-[15px] font-semibold text-warn-ink">{children}</p>
);

// The drafts on this form were placed from another screen (Q-07). The yellow line says so and opens the
// confirmation, so nobody types the same order in again.
export function PlacedElsewhere({ lost }: { lost: boolean }) {
  return (
    <p role="status" className="flex items-center justify-between gap-3 rounded-[10px] bg-warn-tint px-3 pt-2.5 pb-2 text-xs leading-[15px] font-semibold text-warn-ink">
      {lost ? PLACED_ELSEWHERE_LOST : PLACED_ELSEWHERE}
      <Link to="/store/orders/placed" className="-my-3.5 shrink-0 py-3.5 underline underline-offset-2">View confirmation</Link>
    </p>
  );
}

function OrderForm({ next, stale }: { next: OpenOrder; stale: ReactNode }) {
  const form = useDraftForm(next);
  const { outlet, products, draft, deliveryDate, cutoffAt } = next;
  const fresh = outlet.brand === 'Fresh';
  const closes = cutoffAt ? ` · closes ${cutoffTime(cutoffAt, next.cutoffIsToday)}` : '';
  // The day the form was showing, or the day the draft was first for, has closed (spec 009, rule 3).
  const closedDay = form.closedDay ?? next.movedFrom;

  const checkout = <Checkout next={next} saving={form.saving} placing={form.placing} refused={form.refused} onPlace={() => { void form.place(); }} />;
  const box = (productId: string): QuantityBox => ({
    value: form.values.quantities[productId] ?? 0,
    text: form.typed[productId],
    onStep: (quantity) => form.setQuantity(productId, quantity),
    onType: (text) => form.typeQuantity(productId, text),
    onLeave: () => form.leaveQuantity(productId),
  });

  return (
    <Page>
      {stale}
      <PageHeader title="New order" small>
        {fresh ? <p>For {shortDay(deliveryDate)}{closes}{next.cutoffIsToday && ' today'}</p> : <p>{outlet.name} · for {shortDay(deliveryDate)}{closes}</p>}
      </PageHeader>

      <div className="grid grid-cols-1 gap-y-2.5 lg:grid-cols-[minmax(0,728fr)_minmax(0,440fr)] lg:items-start lg:gap-x-8">
        <div className="space-y-2.5 lg:space-y-3.5">
          {closedDay && cutoffAt && (
            // Every day closes at the same hour (rule 2), so the open day's cut-off gives the hour this one shut.
            <Notice>Orders for {shortDay(closedDay)} closed at {clockTime(cutoffAt)}. This order is now for {shortDay(deliveryDate)}.</Notice>
          )}
          {form.changedElsewhere && <Notice>This order was changed somewhere else. These are the latest numbers.</Notice>}
          {form.placedElsewhere && <PlacedElsewhere lost={form.placedElsewhere.lost} />}

          {/* From the tap on Place until it settles, nothing on the form can change (see draft-form.ts). */}
          {fresh ? (
            <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-3.5">
              {products.map((product) => (
                <FreshItem key={product.id} product={product} box={box(product.id)} disabled={form.placing} />
              ))}
            </div>
          ) : (
            <Panel className="px-4 pt-3 pb-1">
              <div className="flex items-center gap-2.5 pb-1.5">
                <img src={goodsIcon(outlet.brand, 'dry')} alt="" className="size-7" />
                <h2 className="font-sans text-[13px] leading-4 font-semibold">{brandList(outlet.brand)}</h2>
                <p className="ml-auto text-[11px] leading-[14px] text-muted-foreground/65">{[...new Set(products.map((p) => p.temp))].join(' and ')} · per unit</p>
              </div>
              {products.map((product) => (
                <ListItem key={product.id} product={product} box={box(product.id)} disabled={form.placing} />
              ))}
            </Panel>
          )}

          {draft && draft.tailLiftItems.length > 0 && (
            <Notice>Needs a truck with a tail lift · {draft.tailLiftItems.map((name) => name.toLowerCase()).join(', ')}</Notice>
          )}

          <Panel className="space-y-2 text-[13px] leading-[18px]">
            <div className="flex justify-between gap-3">
              <span className="font-semibold">Delivery window</span>
              <span className="font-mono text-muted-foreground">{windowWords(outlet)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="font-semibold">Entrance</span>
              <span className="text-muted-foreground">{ENTRANCE[outlet.dockType]}</span>
            </div>
          </Panel>

          <Panel>
            <DriverNote note={form.values.note} disabled={form.placing} onChange={form.setNote} />
          </Panel>
        </div>

        <Panel className="hidden p-5 lg:block">
          <h2 className="text-lg leading-[25px] font-bold">Your order</h2>
          {draft && <OrderSummary brand={outlet.brand} products={products} lines={draft.lines} />}
          <div className="mt-3.5">{checkout}</div>
        </Panel>
      </div>

      <BottomBar className="bg-card px-4 pt-4 pb-3 shadow-[0_-2px_8px_color-mix(in_srgb,var(--foreground)_6%,transparent)] md:px-6">{checkout}</BottomBar>
    </Page>
  );
}

// Your order on a desktop: the order's lines in the list's order, then, out of sight, a row for each item not in it.
// Those rows hold the room a line takes once it is added, so Place order under the list never moves down while
// someone reaches for it (L-02).
export function OrderSummary({ brand, products, lines }: { brand: Brand; products: StoreProduct[]; lines: OrderLine[] }) {
  const held = products.filter((product) => !lines.some((line) => line.productId === product.id))
    .map((product): OrderLine => ({ productId: product.id, name: product.name, unit: product.unit, quantity: 0 }));
  const row = (line: OrderLine, hidden: boolean) => {
    const words = lineWords(brand, line, products);
    const temp = products.find((p) => p.id === line.productId)?.temp;
    return (
      <li key={line.productId} aria-hidden={hidden || undefined} className={cn('flex min-h-7 items-center gap-2.5 text-[15px] leading-[18px]', hidden && 'invisible')}>
        {brand === 'Fresh' && temp && <img src={goodsIcon(brand, temp)} alt="" className="size-7" />}
        <span className="font-semibold">{words.name}</span>
        <span className="ml-auto font-mono">{words.amount}</span>
      </li>
    );
  };
  return (
    <ul className="mt-3 space-y-3">
      {inListOrder(lines, products).map((line) => row(line, false))}
      {held.map((line) => row(line, true))}
    </ul>
  );
}

// The Fresh form: a card for each of its two items, named by temperature. The card wraps, so a box's line takes a
// row of its own under the stepper (Q-01).
function FreshItem({ product, box, disabled }: { product: StoreProduct; box: QuantityBox; disabled: boolean }) {
  const name = TEMP_NAME[product.temp];
  return (
    <Panel className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <img src={goodsIcon('Fresh', product.temp)} alt="" className="size-9" />
      <div className="min-w-0 flex-1">
        <h2 className={cn('text-lg leading-[25px] font-bold', box.value === 0 && 'text-muted-foreground')}>{name}</h2>
        <p className="text-xs leading-[15px] text-muted-foreground">{plural(product.unit)}</p>
      </div>
      <QuantityStepper size="lg" name={`${name} ${plural(product.unit)}`} box={box} disabled={disabled} />
    </Panel>
  );
}

// A row of the Style and Tech lists: the item, its unit with kilos and cubic metres, and the stepper. An item
// at 0 is greyed.
function ListItem({ product, box, disabled }: { product: StoreProduct; box: QuantityBox; disabled: boolean }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-1.5 gap-y-1 border-t py-2">
      {/* The longest line of the product list fits a 390 px phone to the pixel, so it may use 4 px of the gap. */}
      <div className="-mr-1 min-w-0 flex-1">
        <h3 className={cn('font-sans text-sm leading-[17px] font-semibold', box.value === 0 && 'text-muted-foreground')}>{product.name}</h3>
        <p className="mt-1 font-mono text-[11px] leading-[14px] text-muted-foreground/65">{itemFigures(product)}</p>
      </div>
      <QuantityStepper size="md" name={product.name} box={box} disabled={disabled} />
    </div>
  );
}

const SAVE_WORDS: Record<Exclude<Saving, 'saved'>, ReactNode> = {
  saving: 'saving…',
  retrying: <span className="text-warn-ink">not saved · trying again</span>,
  refused: <span className="text-warn-ink">not saved</span>,
  // A box holds something that is not a whole number from 0 to 999, and its line says so (Q-01).
  held: <span className="text-warn-ink">not saved · check the numbers</span>,
};

// The foot of the form: what the last save came to, whether it is saved, and the button that places it. The
// totals are the server's, from the last save (AC-37). A press while a change is still saving is taken: the place
// waits for that save and places what it saved (Q-08), so what is placed is always what was saved. The button is
// off only with nothing added, while a box holds something that is not a whole number, and while placing. It
// shows twice: in the bar on a phone, in "Your order" on a desktop.
export function Checkout({ next, saving, placing, refused, onPlace }: { next: StoreNextOrder; saving: Saving; placing: boolean; refused: string | null; onPlace: () => void }) {
  const { draft } = next;
  const { brand } = next.outlet;
  const totals = draft && [brandUnits(brand, draft.summary.units), ...(brand === 'Fresh' ? [] : [kilos(draft.summary.kg), cubic(draft.summary.m3)])];
  const saved = saving === 'saved' ? (draft ? `draft saved ${clockTime(draft.savedAt)}` : 'Nothing added yet') : SAVE_WORDS[saving];
  // One order per temperature (D-05), so a draft with both is two orders.
  const two = Boolean(draft?.refs.chilled && draft.refs.dry);
  const nothingAdded = !draft && saving === 'saved';
  return (
    <>
      <p className="text-xs leading-[15px] text-muted-foreground" aria-live="polite">{totals && `${totals.join(' · ')} · `}{saved}</p>
      {refused && <p role="alert" className="mt-2 text-xs leading-[15px] font-semibold text-bad">{refused}</p>}
      <Button
        className={cn(ORANGE, 'mt-2.5 h-14 w-full text-[17px] lg:mt-3', placing && 'disabled:bg-primary disabled:text-primary-foreground')}
        disabled={nothingAdded || saving === 'held' || placing}
        focusableWhenDisabled={placing}
        onClick={onPlace}
      >
        {placing ? 'Placing…' : two ? 'Place 2 orders' : 'Place order'}
      </Button>
    </>
  );
}

function FormSkeleton() {
  return (
    <div role="status" aria-label="Loading the order form" className="space-y-2.5 lg:max-w-[62%] lg:space-y-3.5">
      <Skeleton className="h-4 w-56" />
      {[0, 1].map((row) => (
        <Panel key={row} className="flex items-center gap-3">
          <Skeleton className="size-9" />
          <div className="space-y-2">
            <Skeleton className="h-[18px] w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton soft className="ml-auto h-[46px] w-[133px] rounded-[10px]" />
        </Panel>
      ))}
      <Panel className="space-y-3">
        <div className="flex justify-between"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3.5 w-28" /></div>
        <div className="flex justify-between"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-20" /></div>
      </Panel>
    </div>
  );
}
