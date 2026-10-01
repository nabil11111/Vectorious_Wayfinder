import { Link } from 'react-router';
import type { LookupFuel, LookupTripRef, LookupVehicle } from '@wayfinder/contracts';
import { CARD, Chip } from '@/features/live/parts/ui';
import { cn } from '@/lib/utils';
import { vehiclePicture } from './parts/icons';
import { CloseButton, DetailHeading, Facts } from './parts/ui';
import {
  ARCHIVED, DAY_NAMES, NO_QUOTA, NO_SENT_TRIPS, NO_TRIP_TODAY, WEEK_UNAVAILABLE, cubic, dayOfMonth, economyWords, fuelLeftWords, fuelTone, historyHref,
  historyLink, kilos, kindWords, kmWords, litres, tripState, weekWords, whole,
} from './words';

// The selected vehicle (Dispatcher · Fleet's rail): its limits and today's recorded trips, this week's fuel ledger by
// day, and its latest five sent trips, each opening its date in History. Fuel is litres recorded and committed, never
// fuel measured or kilometres inferred; an archived vehicle keeps its own records here.
export function VehicleDetail({ vehicle, today, depot, onClose }: { vehicle: LookupVehicle; today: string; depot: string; onClose: () => void }) {
  const trip = vehicle.selectedTrip;
  const driverToday = trip?.driver && trip.date === today ? `${trip.driver.name} today` : trip?.driver ? `${trip.driver.name} since ${dayOfMonth(trip.date)}` : null;
  // Every trip that bears on today, so a second trip loading never hides behind a first one out.
  const trips = [...new Map([...vehicle.outTrips, ...vehicle.todayTrips].map((each) => [each.tripId, each])).values()];
  return (
    <div className="space-y-4">
      <section id="vehicle-detail" aria-labelledby="vehicle-detail-title" className={cn(CARD, 'scroll-mt-24 px-5 pt-[18px] pb-5')}>
        <div className="flex items-start gap-2.5">
          <img src={vehiclePicture(vehicle)} alt="" className="mt-[-3px] size-[26px] shrink-0 object-contain" />
          <h2 id="vehicle-detail-title" className="min-w-0 flex-1 text-[15px] leading-5 font-bold">{vehicle.id} · {kindWords(vehicle)}</h2>
          <CloseButton label={`Close ${vehicle.id}`} onClick={onClose} />
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{[depot, vehicle.fuelType, driverToday].filter(Boolean).join(' · ')}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip tone="plain">{trip ? tripState(trip, today) : NO_TRIP_TODAY}</Chip>
          {vehicle.offReason !== null && <Chip tone="warn">Workshop today · {vehicle.offReason}</Chip>}
          {vehicle.archivedAt !== null && <Chip tone="plain">{ARCHIVED}</Chip>}
        </div>
        <Facts mono className="mt-3.5" rows={[
          ['Weight limit', kilos(vehicle.weightCapKg)],
          ['Volume limit', cubic(vehicle.volumeCapM3)],
          ['Fuel economy', economyWords(vehicle.kmPerL)],
          ['Weekly fuel quota', litres(vehicle.weeklyFuelQuotaL)],
        ]} />
        {trips.length > 0 && (
          <>
            <DetailHeading>Recorded trips today</DetailHeading>
            <TripList trips={trips} today={today} />
          </>
        )}
      </section>

      <FuelWeek fuel={vehicle.fuel} today={today} />

      <section aria-labelledby="recent-trips-title" className={cn(CARD, 'px-5 pt-[18px] pb-5')}>
        <h2 id="recent-trips-title" className="text-[15px] leading-5 font-bold">Recent trips</h2>
        {vehicle.recentTrips.length === 0
          ? <p className="mt-2 text-xs leading-4 text-muted-foreground">{NO_SENT_TRIPS}</p>
          : <TripList trips={vehicle.recentTrips} today={today} dated />}
      </section>
    </div>
  );
}

// Sent trips as the rail lists them: the plan's date, the trip, its driver and planned distance, its recorded state,
// and a link that names the date it opens in History.
function TripList({ trips, today, dated = false }: { trips: LookupTripRef[]; today: string; dated?: boolean }) {
  return (
    <ol className="mt-2 space-y-2.5">
      {trips.map((each) => (
        <li key={each.tripId} className={cn('text-[11px] leading-[15px]', dated && 'grid grid-cols-[44px_minmax(0,1fr)] gap-x-2.5')}>
          {dated && <span className="font-mono text-muted-foreground">{dayOfMonth(each.date)}</span>}
          <span className="min-w-0">
            <span className="block">{[`trip ${each.tripNo}`, each.driver?.name, `${kmWords(each.km)} planned`].filter(Boolean).join(' · ')}</span>
            <span className="block text-muted-foreground">{tripState(each, today)}</span>
            <Link to={historyHref(each.date, each.tripId)} className="mt-0.5 inline-block font-semibold underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {historyLink(each.date)}
            </Link>
          </span>
        </li>
      ))}
    </ol>
  );
}

// Fuel this week: what is left of the quota, the litres recorded and committed, and each day Monday to Saturday from
// its ledger rows. A day with no row is zero recorded, not a day without trips.
function FuelWeek({ fuel, today }: { fuel: LookupFuel | null; today: string }) {
  if (!fuel) {
    return (
      <section aria-labelledby="fuel-week-title" className={cn(CARD, 'px-5 pt-[18px] pb-5')}>
        <h2 id="fuel-week-title" className="text-[15px] leading-5 font-bold">Fuel this week</h2>
        <p className="mt-2 text-xs leading-4 text-muted-foreground">{WEEK_UNAVAILABLE}</p>
      </section>
    );
  }
  const tone = fuelTone(fuel);
  const used = fuel.recordedCommittedPct === null ? 0 : Math.min(100, Math.max(0, fuel.recordedCommittedPct));
  const highest = Math.max(0, ...fuel.days.map((day) => day.litres));
  const byDow = DAY_NAMES.map((name, dow) => ({ name, day: fuel.days.find((day) => day.dow === dow) }));
  return (
    <section aria-labelledby="fuel-week-title" className={cn(CARD, 'px-5 pt-[18px] pb-5')}>
      <h2 id="fuel-week-title" className="text-[15px] leading-5 font-bold">Fuel this week</h2>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className={cn('font-heading text-[26px] leading-8 font-bold', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn-ink' : 'text-foreground')}>{fuelLeftWords(fuel)}</span>
        <span className="text-[11px] leading-4 text-muted-foreground">{fuel.remaining < 0 ? `quota ${litres(fuel.quota)}` : `left of ${litres(fuel.quota)}`}</span>
      </p>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
        {litres(fuel.recordedCommitted)} recorded and committed{fuel.recordedCommittedPct === null ? ` · ${NO_QUOTA}` : ` · ${whole(fuel.recordedCommittedPct)}%`}
      </p>
      {fuel.recordedCommittedPct !== null && (
        <div role="meter" aria-label="Fuel recorded and committed this week" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} className="mt-3 h-2 overflow-hidden rounded-full bg-border">
          {used > 0 && <div className="h-full rounded-full bg-foreground" style={{ width: `${used}%` }} />}
        </div>
      )}
      <ol aria-label="Litres recorded and committed by day" className="mt-4 grid grid-cols-6 items-end gap-2">
        {byDow.map(({ name, day }) => {
          const litresOn = day?.litres ?? 0;
          const height = highest > 0 ? Math.max(4, Math.round((litresOn / highest) * 56)) : 4;
          return (
            <li key={name} className="flex flex-col items-center gap-1">
              <span aria-hidden="true" className="font-mono text-[9px] leading-3 text-muted-foreground">{litres(litresOn).replace(' L', '')}</span>
              <span aria-hidden="true" className={cn('w-full max-w-[30px] rounded-[5px]', day?.date === today ? 'bg-foreground' : 'bg-border')} style={{ height }} />
              <span className={cn('text-[10px] leading-3', day?.date === today ? 'font-semibold' : 'text-muted-foreground')}>{name}</span>
              <span className="sr-only">{litres(litresOn)}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] leading-4 text-muted-foreground">Week {fuel.isoWeek} · Monday to Saturday · {weekWords(fuel)}</p>
    </section>
  );
}
