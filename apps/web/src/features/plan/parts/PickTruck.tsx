import type { BoardOrder, BoardVehicle, Brand, DraftPlan, PlanBoard } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { freeTripNo, tripOf, type TripKey } from '../draft';
import { countOf, cubic, hhmm, tonnes, vehicleKind } from '../words';
import { BRAND_ICON, ICON, vehicleIcon } from './icons';
import type { BoardIndex } from './lookup';
import { plainButton } from './look';

// What the truck is picked for: a new trip, from a group (its orders give the line and the order of the list,
// and the trip starts empty), from Find a slot (the trip starts with that order) or blank; or another vehicle
// for the open trip.
export type Pick =
  | { kind: 'start'; group: { brand: Brand; district: string } | null; orders: BoardOrder[]; startWith: BoardOrder[] }
  | { kind: 'swap'; key: TripKey };

// Pick a truck (Edit plan · blank trip): a row per vehicle that can take another trip, fridge vehicles first when
// the orders hold a chilled one and dry ones first otherwise, then by id. "Start a blank trip" and "Swap truck"
// open the same list.
export function PickTruck({ board, draft, index, pick, onChoose, onClose }: {
  board: PlanBoard;
  draft: DraftPlan;
  index: BoardIndex;
  pick: Pick;
  onChoose: (vehicleId: string) => void;
  onClose: () => void;
}) {
  const moving = pick.kind === 'swap' ? tripOf(draft, pick.key) : null;
  const orders = pick.kind === 'start' ? pick.orders : (moving?.stops.flatMap((stop) => stop.orderIds.flatMap((id) => index.order(id) ?? [])) ?? []);
  const chilled = orders.some((order) => order.temp === 'chilled');
  const shops = orders.flatMap((order) => index.shop(order.outletId) ?? []);
  const group = pick.kind === 'start' ? pick.group : shops[0] ? { brand: shops[0].brand, district: shops[0].district } : null;
  const title = pick.kind === 'swap' ? `Swap truck · ${moving ? `${moving.vehicleId} trip ${moving.tripNo}` : ''}` : group ? `New trip · ${group.brand} · ${group.district}` : 'New trip';
  const temps = [...new Set(orders.map((order) => order.temp))].sort().join(' and ');
  // The earliest window among the shops, picked from the list rather than worked out.
  const earliest = shops.map((shop) => shop.windowOpen).sort((a, b) => a - b)[0];
  const line = orders.length > 0
    ? [countOf(orders.length, 'order'), temps, earliest !== undefined && `${shops.length === 1 ? 'window' : 'windows'} from ${hhmm(earliest)}`].filter(Boolean).join(' · ')
    : 'Choose the vehicle for the trip, then add its stops.';

  const rank = (vehicle: BoardVehicle) => ((vehicle.temp === 'reefer') === chilled ? 0 : 1);
  const vehicles = board.vehicles
    .filter((vehicle) => vehicle.working && vehicle.id !== moving?.vehicleId && freeTripNo(draft, vehicle.id) !== null)
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

  return (
    <div className="flex flex-col px-3.5 pt-3.5 pb-3.5">
      <div className="flex items-start gap-2.5">
        <img src={group ? BRAND_ICON[group.brand] : ICON.route} alt="" className="size-8 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] leading-[22px] font-bold">{title}</h2>
          <p className="mt-1 text-xs leading-[15px] text-muted-foreground">{line}</p>
        </div>
        <Button variant="outline" className={plainButton('h-8 px-4 text-xs')} onClick={onClose}>Close</Button>
      </div>
      <h3 className="mt-4 text-sm leading-[18px] font-semibold">Pick a truck</h3>
      <ul aria-label="Trucks that can take the trip" className="mt-2.5 space-y-2.5">
        {vehicles.map((vehicle) => {
          const second = freeTripNo(draft, vehicle.id) === 2;
          const ready = second ? index.trip(vehicle.id, 1)?.times?.readyAgainAt : undefined;
          return (
            <li key={vehicle.id} className="flex items-center gap-3 rounded-[10px] bg-muted px-3.5 py-3">
              <img src={vehicleIcon(vehicle)} alt="" className="size-[30px] shrink-0 object-contain" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-4 font-semibold">{vehicle.id} · {vehicleKind(vehicle)} · {tonnes(vehicle.weightCapKg)} · {cubic(vehicle.volumeCapM3)}</p>
                <p className="mt-1 text-xs leading-[15px] text-muted-foreground">
                  {second ? `trip 2${ready !== undefined ? ` · ready ${hhmm(ready)}` : ''}` : `fuel ${vehicle.fuelLeftPct}% left`}
                </p>
              </div>
              <Button variant="outline" className={plainButton('h-8 w-[88px] text-[13px]')} onClick={() => onChoose(vehicle.id)}>Choose</Button>
            </li>
          );
        })}
      </ul>
      {vehicles.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Every working vehicle runs two trips already.</p>}
    </div>
  );
}
