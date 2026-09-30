import { Link } from 'react-router';
import type { LoadingTruck } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { clockTime, leaves, truckName, tripPlace, unitsWords, whole } from '../words';
import { truckIcon } from './icons';
import { Tag } from './ui';

// How a truck stands, in its row's second line: "leaves 04:36 · 118 cartons", "leaves 04:36 · 94 of 118 on" while it
// loads, and "ready 02:36 · 117 of 118 on" once it is ready.
function standing(truck: LoadingTruck) {
  if (truck.status === 'ready') return `${truck.readyAt ? `ready ${clockTime(truck.readyAt)}` : 'ready'} · ${whole(truck.on.units)} of ${whole(truck.units)} on`;
  if (truck.status === 'loading') return `${leaves(truck)} · ${whole(truck.on.units)} of ${whole(truck.units)} on`;
  return `${leaves(truck)} · ${unitsWords(truck.brand, truck.units)}`;
}

// A truck in the Next list: its place in the day, its picture, "VEH035 · Fresh · Colombo", how it stands and a chip
// once it is loading or ready. The row opens its truck.
export function TruckRow({ truck, place }: { truck: LoadingTruck; place: number }) {
  return (
    <li>
      <Link
        to={`/loader/trucks/${truck.tripId}`}
        className={cn(
          'flex items-center gap-[9px] rounded-[14px] bg-card py-3 pr-3.5 pl-3.5 outline-none lg:py-[15px] lg:pr-4',
          'shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)] hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
      >
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-muted text-[13px] leading-none font-bold">{place}</span>
        <img src={truckIcon(truck)} alt="" className="size-9 shrink-0 object-contain" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-[18px] font-semibold">{truckName(truck)} · {tripPlace(truck)}</span>
          <span className="mt-[5px] block text-[13px] leading-4 text-muted-foreground">{standing(truck)}</span>
        </span>
        {truck.status !== 'planned' && <Tag tone={truck.status === 'ready' ? 'good' : 'warn'} className="-ml-1 px-2 lg:ml-0 lg:px-2.5">{truck.status}</Tag>}
      </Link>
    </li>
  );
}

// The rest of the day's trucks in leaving order, numbered on from the one above them.
export function NextList({ trucks, from, className }: { trucks: LoadingTruck[]; from: number; className?: string }) {
  if (trucks.length === 0) return null;
  return (
    <section aria-labelledby="next-trucks" className={className}>
      <h2 id="next-trucks" className="text-lg leading-6 font-bold">Next</h2>
      <ol className="mt-[17px] space-y-[18px] lg:mt-3.5 lg:space-y-3">
        {trucks.map((truck, i) => <TruckRow key={truck.tripId} truck={truck} place={from + i} />)}
      </ol>
    </section>
  );
}
