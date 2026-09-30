import type { BoardDriver, DraftPlan } from '@wayfinder/contracts';
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from './ui';

// The driver's name in a trip's title is a menu (rule 6): the depot's drivers, one already on another vehicle
// marked "on VEH002" and not choosable, and "No driver". A driver is chosen for the vehicle, on both its trips.
export function DriverMenu({ draft, vehicleId, drivers, driverId, onChoose }: {
  draft: DraftPlan;
  vehicleId: string;
  drivers: BoardDriver[];
  driverId: string | null;
  onChoose: (driverId: string | null) => void;
}) {
  const chosen = drivers.find((driver) => driver.id === driverId) ?? null;
  // The vehicle each driver is on in this draft.
  const onVehicle = new Map(draft.trips.filter((trip) => trip.driverId !== null && trip.vehicleId !== vehicleId).map((trip) => [trip.driverId!, trip.vehicleId]));
  const sorted = [...drivers].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <MenuRoot>
      <MenuTrigger className="rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {chosen?.name ?? 'No driver'}
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80 w-56">
        <MenuItem onClick={() => onChoose(null)}>No driver{driverId === null && <span aria-label="chosen">✓</span>}</MenuItem>
        <MenuSeparator />
        {sorted.map((driver) => {
          const busy = onVehicle.get(driver.id);
          return (
            <MenuItem key={driver.id} disabled={busy !== undefined} onClick={() => onChoose(driver.id)}>
              {driver.name}
              {busy ? <span className="text-[11px]">on {busy}</span> : driver.id === driverId && <span aria-label="chosen">✓</span>}
            </MenuItem>
          );
        })}
      </MenuPopup>
    </MenuRoot>
  );
}
