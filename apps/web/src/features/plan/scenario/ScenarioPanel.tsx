import { useEffect, useRef, useState } from 'react';
import { PlanScenario, type ScenarioSummary } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { useScope } from '@/features/dispatcher/scope';
import { reasonOf } from '@/features/store/words';
import { api } from '@/lib/api';
import { useAppClock } from '@/lib/clock';
import { refOf, type BoardScreen } from '../board';
import { scenarioIdentity } from './identity';
import { ScenarioReader } from './reader';
import { impactHeadline, scenarioImpact } from './impact';

const figures: [keyof ScenarioSummary, string][] = [
  ['fullyPlanned', 'Orders fully covered'], ['partiallyPlanned', 'Orders partly covered'], ['deferred', 'Orders waiting'],
  ['shopsFullyPlanned', 'Shops fully covered'], ['shopsWithWaiting', 'Shops with waiting goods'], ['vehicles', 'Trucks used'], ['trips', 'Trips'],
  ['fuelLitres', 'Trip fuel (L)'], ['repeatedDeferrals', 'Orders from earlier days still waiting'],
];

export function ScenarioPanel({ screen, stale, refreshing }: { screen: BoardScreen; stale: boolean; refreshing: boolean }) {
  const { board } = screen;
  const { data: me } = useMe();
  const { scope } = useScope();
  const clock = useAppClock();
  const [vehicle, setVehicle] = useState('');
  const [held, setHeld] = useState<{ identity: string; value?: PlanScenario; error?: string; busy?: boolean } | null>(null);
  const reader = useRef(new ScenarioReader<PlanScenario>()).current;
  const identity = scenarioIdentity(screen, me, scope, clock.state?.day, vehicle, stale || refreshing);
  const eligible = identity !== null;
  useEffect(() => { reader.invalidate(identity); setHeld(null); return () => reader.invalidate(null); }, [reader, identity]);
  const current = held?.identity === identity ? held : null;
  const compare = async () => {
    if (!identity || !board.day) return;
    reader.invalidate(identity);
    setHeld({ identity, busy: true });
    try {
      const value = await reader.run(identity, async (signal) => PlanScenario.parse(await api(`/plans/${board.day!.date}/scenario`, {
        method: 'POST', depot: board.depot, signal, json: { ref: refOf(board), excludedVehicleId: vehicle },
      })));
      if (value) setHeld({ identity, value });
    } catch (error) { setHeld({ identity, error: reasonOf(error) }); }
  };
  const result = current?.value;
  const impact = result ? scenarioImpact(result) : null;
  return <details className="mt-2 shrink-0 rounded-[12px] border bg-card px-4 py-3">
    <summary className="cursor-pointer text-sm font-semibold">Check affected deliveries</summary>
    <div className="mt-3 max-h-[55dvh] space-y-3 overflow-y-auto break-words">
      <p className="text-xs text-muted-foreground">See which deliveries are affected if a truck cannot run.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold">Vehicle that cannot run
          <select aria-label="Vehicle that cannot run" className="h-11 rounded-[10px] border bg-background px-3 text-sm" value={vehicle} onChange={(event) => setVehicle(event.target.value)}>
            <option value="">Choose a vehicle</option>
            {board.vehicles.filter((v) => v.working).map((v) => <option key={v.id} value={v.id}>{v.id} · {v.temp === 'reefer' ? 'fridge' : 'dry'} {v.type}</option>)}
          </select>
        </label>
        <Button variant="outline" className="h-11" disabled={!eligible || current?.busy} onClick={() => { void compare(); }}>{current?.busy ? 'Checking deliveries…' : 'Show delivery impact'}</Button>
      </div>
      {screen.saving !== 'saved' || screen.acting || refreshing || stale ? <p role="status" className="text-xs text-muted-foreground">Wait for the board to finish saving and refreshing before comparing.</p> : null}
      {current?.error ? <p role="alert" className="text-sm text-destructive">{current.error} Refresh the board before trying again.</p> : null}
      <p className="text-xs text-muted-foreground">Both suggestions use today's orders; your manual changes are not included. Your saved plan stays unchanged.</p>
      {result && impact ? <>
        <section aria-label="Delivery impact" className="space-y-2">
          <p className="text-sm font-semibold">{impactHeadline(impact, result.excludedVehicleId)}</p>
          <p className="text-xs text-muted-foreground">
            Newly waiting: {impact.newWaiting} · Already waiting in both suggestions: {impact.alreadyWaiting}
            {impact.moreWaiting ? ` · More waiting on partly covered orders: ${impact.moreWaiting}` : ''}
            {impact.improved ? ` · Better covered: ${impact.improved}` : ''}
            {impact.reassigned ? ` · Different trucks only: ${impact.reassigned}` : ''}
          </p>
          {impact.affected.length ? <div role="region" aria-label="Affected deliveries" tabIndex={0} className="max-h-[min(320px,45dvh)] overflow-y-auto rounded-[10px] border focus-visible:outline-2 focus-visible:outline-ring">
            <ul className="divide-y">{impact.affected.map(row => <li key={row.after.orderId} className="px-3 py-2 text-xs">
              <p className="font-semibold">{row.after.shopName}</p>
              <p className="mt-1 text-muted-foreground">{row.explanation}</p>
              {row.after.waitedBefore ? <p className="mt-1 text-muted-foreground">Includes goods waiting from an earlier day.</p> : null}
            </li>)}</ul>
          </div> : null}
          {impact.alreadyWaiting ? <p className="text-xs text-muted-foreground">Some goods were already waiting with this truck available; they are not all new delays.</p> : null}
        </section>
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold">Delivery details and reasons</summary>
          <div role="region" aria-label="Delivery details and reasons" tabIndex={0} className="mt-2 max-h-[min(320px,45dvh)] overflow-y-auto rounded-[10px] border focus-visible:outline-2 focus-visible:outline-ring">
            <p className="px-3 py-2 text-muted-foreground">For partly covered orders, this view does not compare how much could be delivered.</p>
            <ul className="divide-y">{impact.rows.map(row => <li key={row.after.orderId} className="space-y-1 px-3 py-2">
              <p className="font-semibold">{row.after.shopName}</p>
              <p className="text-muted-foreground">{row.explanation}</p>
              {row.after.waitedBefore ? <p className="text-muted-foreground">Includes goods waiting from an earlier day.</p> : null}
              {([[`With ${result.excludedVehicleId} available`, row.before], [`Without ${result.excludedVehicleId}`, row.after]] as const).map(([label, order]) => <div key={label} className="pt-1">
                <p className="font-semibold">{label}: {order.status === 'planned' ? 'Fully covered' : order.status === 'partial' ? 'Partly covered' : 'Waiting'}</p>
                <p className="text-muted-foreground">Trucks: {order.vehicleIds.join(', ') || 'none suggested'}</p>
                {order.reasons.map((reason, index) => <p key={index} className="text-muted-foreground">{reason}</p>)}
              </div>)}
            </li>)}</ul>
          </div>
        </details>
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold">Counts and fuel</summary>
          <div role="region" aria-label="Counts and fuel" tabIndex={0} className="mt-2 max-h-[min(320px,45dvh)] overflow-y-auto focus-visible:outline-2 focus-visible:outline-ring">
            <p className="mb-2 text-muted-foreground">{result.baseline.summary.totalOrders} orders compared. Parts of an order count together. Each row shows with {result.excludedVehicleId} available, then without it.</p>
            <dl className="divide-y">{figures.map(([key, label]) => <div key={key} className="flex items-start justify-between gap-3 py-2">
              <dt>{label}</dt><dd className="shrink-0 tabular-nums">{result.baseline.summary[key]} / {result.scenario.summary[key]}</dd>
            </div>)}</dl>
          </div>
        </details>
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold">Things to review</summary>
          <div role="region" aria-label="Things to review" tabIndex={0} className="mt-2 max-h-[min(320px,45dvh)] space-y-2 overflow-y-auto focus-visible:outline-2 focus-visible:outline-ring">
            <p className="text-muted-foreground">These suggestions still need your review before sending a plan.</p>
            {([[`With ${result.excludedVehicleId} available`, result.baseline], [`Without ${result.excludedVehicleId}`, result.scenario]] as const).map(([label, outcome]) => <div key={label}>
              <p className="font-semibold">{label}</p>
              {outcome.check.problems.length ? <ul className="mt-1 space-y-1 text-muted-foreground">{outcome.check.problems.map((problem, index) => <li key={index}>{problem.message}</li>)}</ul>
                : <p className="text-muted-foreground">No issues reported by the plan checks.</p>}
            </div>)}
          </div>
        </details>
      </> : null}
    </div>
  </details>;
}
