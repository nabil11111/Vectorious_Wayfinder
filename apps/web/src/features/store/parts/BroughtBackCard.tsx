import type { StoreOrderList } from '@wayfinder/contracts';
import { ICON } from './icons';
import { Panel } from './Panel';

// The orders a driver brought back today from the shop when it was closed (L-14): they left "Coming today", so Today
// says what happened to each and when it comes, as the server words it. No frame draws it.
export function BroughtBackCard({ broughtBack }: { broughtBack: StoreOrderList['broughtBack'] }) {
  if (!broughtBack) return null;
  return (
    <Panel className="pb-3">
      <div className="flex items-center gap-2.5">
        <img src={ICON.waiting} alt="" className="size-8" />
        <h2 className="font-sans text-[17px] leading-[23px] font-bold">{broughtBack.title}</h2>
      </div>
      <ul className="mt-2.5 divide-y">
        {broughtBack.orders.map((order) => (
          <li key={order.orderId} className="py-2.5 text-xs leading-[15px] text-muted-foreground">{order.line}</li>
        ))}
      </ul>
    </Panel>
  );
}
