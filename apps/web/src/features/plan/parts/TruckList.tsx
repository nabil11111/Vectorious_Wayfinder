import { useState } from 'react';
import type { BoardVehicle, DraftPlan, PlanBoard } from '@wayfinder/contracts';
import { countOf, vehicleSize, whole } from '../words';
import { ICON } from './icons';
import { Column, ColumnHead } from './ui';

// The rows shown before "show".
const FIRST_ROWS = 4;

const fridgeFirst = (a: BoardVehicle, b: BoardVehicle) => (a.temp === b.temp ? 0 : a.temp === 'reefer' ? -1 : 1) || a.id.localeCompare(b.id);

// The left column's lower card (Edit plan, "Unassigned trucks"): the working vehicles with no trip in the draft,
// fridge vehicles first, then those in the workshop last with their reasons. Four rows, and the rest on "show".
export function TruckList({ board, draft }: { board: PlanBoard; draft: DraftPlan }) {
  const [all, setAll] = useState(false);
  const used = new Set(draft.trips.map((trip) => trip.vehicleId));
  const free = board.vehicles.filter((vehicle) => vehicle.working && !used.has(vehicle.id)).sort(fridgeFirst);
  const off = board.vehicles.filter((vehicle) => !vehicle.working).sort(fridgeFirst);
  const rows = [...free, ...off];
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  const kinds = [
    countOf(free.filter((v) => v.type === 'truck' && v.temp === 'reefer').length, 'reefer truck'),
    `${whole(free.filter((v) => v.type === 'truck' && v.temp === 'ambient').length)} dry`,
    countOf(free.filter((v) => v.type === 'van').length, 'van'),
    ...(off.length > 0 ? [`${whole(off.length)} in the workshop`] : []),
  ];

  return (
    <Column aria-label="Unassigned trucks" className="max-h-[50%] shrink-0">
      <div className="px-3.5 pt-3.5">
        <ColumnHead icon={ICON.trucks} title={`Unassigned trucks · ${whole(free.length)}`} />
        <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">{kinds.join(' · ')}</p>
      </div>
      <ul className="mt-1.5 min-h-0 overflow-y-auto px-3.5">
        {shown.map((vehicle) => (
          <li key={vehicle.id} className="border-t py-2">
            <p className="text-xs leading-[15px] font-semibold">{vehicle.id} · {vehicleSize(vehicle)}</p>
            <p className="mt-1 text-[11px] leading-[14px] text-muted-foreground">
              {vehicle.working ? `at depot · fuel ${vehicle.fuelLeftPct}% left` : `in the workshop · ${vehicle.offReason ?? 'not working'}`}
            </p>
          </li>
        ))}
      </ul>
      {rows.length > FIRST_ROWS && (
        <p className="px-3.5 pt-1.5 pb-3.5 text-[11px] leading-[14px]">
          <span className="text-muted-foreground">{all ? countOf(rows.length, 'truck') : `${whole(rows.length - FIRST_ROWS)} more`}</span>
          <button type="button" className="ml-1.5 font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => setAll(!all)}>{all ? 'hide' : 'show'}</button>
        </p>
      )}
    </Column>
  );
}
