import type { BoardDriver, DraftPlan } from '@wayfinder/contracts';
import { cn } from '@/lib/utils';
import { driverRows } from './drivers';
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from './ui';

// The driver's name in a trip's title is a menu (rule 6), reading "no driver" in the warning colour when the vehicle
// has none (spec 022): the depot's drivers, and "No driver". A driver is chosen for the vehicle, on both its trips. One
// already on another vehicle says "drives VEH002 now; it will have no driver", and choosing them moves them here, leaving
// that vehicle with none (spec 026, rule 2). A change of truck goes through the crew picker.
export function DriverMenu({ draft, vehicleId, drivers, driverId, onChoose }: {
  draft: DraftPlan;
  vehicleId: string;
  drivers: BoardDriver[];
  driverId: string | null;
  onChoose: (driver: BoardDriver | null) => void;
}) {
  const chosen = drivers.find((driver) => driver.id === driverId) ?? null;
  return (
    <MenuRoot>
      <MenuTrigger className={cn('rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50', !chosen && 'text-warn-ink')}>
        {chosen?.name ?? 'no driver'}
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80 w-72">
        <MenuItem onClick={() => onChoose(null)}>No driver{driverId === null && <span aria-label="chosen">✓</span>}</MenuItem>
        <MenuSeparator />
        {driverRows(draft, vehicleId, drivers, driverId).map((row) => (
          <MenuItem key={row.id} onClick={() => onChoose(drivers.find((driver) => driver.id === row.id) ?? null)}>
            {row.name}
            {row.note ? <span className="text-right text-[11px] leading-[14px] text-warn-ink">{row.note}</span> : row.chosen && <span aria-label="chosen">✓</span>}
          </MenuItem>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}
