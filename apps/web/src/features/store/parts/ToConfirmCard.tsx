import { Link } from 'react-router';
import type { StoreOrderList } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { orangeLink, plainLink } from './actions';
import { ICON } from './icons';
import { Panel } from './Panel';

// Today's deliveries still to confirm (Q-35), for a shop that had more than one this morning: how many, and each as the
// server words it, opening its delivery. The first one's Confirm is orange, as the screen's one main action.
export function ToConfirmCard({ toConfirm }: { toConfirm: StoreOrderList['toConfirm'] }) {
  if (!toConfirm) return null;
  return (
    <Panel className="pb-3">
      <div className="flex items-center gap-2.5">
        <img src={ICON.deliveries} alt="" className="size-8" />
        <h2 className="font-sans text-[17px] leading-[23px] font-bold">{toConfirm.title}</h2>
      </div>
      <ul className="mt-2.5 divide-y">
        {toConfirm.deliveries.map((delivery, i) => (
          <li key={delivery.stopId}>
            <Link to={`/store/deliveries/${delivery.stopId}`} className="group flex items-center justify-between gap-3 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <span className="min-w-0 text-xs leading-[15px] text-muted-foreground">{delivery.line}</span>
              <span className={cn(i === 0 ? orangeLink('h-9 shrink-0 px-4 text-xs') : plainLink('h-9 shrink-0 px-4 text-xs'))}>Confirm</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
