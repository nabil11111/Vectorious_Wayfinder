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

const figures: [keyof ScenarioSummary, string][] = [
  ['fullyPlanned', 'Orders fully planned'], ['partiallyPlanned', 'Orders partly planned'], ['deferred', 'Orders entirely deferred'],
  ['shopsFullyPlanned', 'Shops fully planned'], ['shopsWithWaiting', 'Shops with waiting goods'], ['vehicles', 'Vehicles used'], ['trips', 'Trips'],
  ['fuelLitres', 'Trip fuel (L)'], ['repeatedDeferrals', 'Previously waiting orders still waiting'],
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
  const baseline = new Map(result?.baseline.orders.map((o) => [o.orderId, o]));
  const changed = result?.scenario.orders.filter((o) => {
    const before = baseline.get(o.orderId);
    return o.status !== 'planned' || o.status !== before?.status || o.vehicleIds.join(',') !== before.vehicleIds.join(',');
  });
  return <details className="mt-2 shrink-0 rounded-[12px] border bg-card px-4 py-3">
    <summary className="cursor-pointer text-sm font-semibold">Compare without a vehicle</summary>
    <div className="mt-3 max-h-[55dvh] space-y-3 overflow-y-auto">
      <p className="text-xs text-muted-foreground">See which deliveries would change if a vehicle cannot run. Compare two generated plans for the same current orders. The generated baseline may differ from your saved draft. This preview does not change the saved plan.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold">Vehicle to leave out
          <select aria-label="Vehicle to leave out" className="h-11 rounded-[10px] border bg-background px-3 text-sm" value={vehicle} onChange={(event) => setVehicle(event.target.value)}>
            <option value="">Choose a vehicle</option>
            {board.vehicles.filter((v) => v.working).map((v) => <option key={v.id} value={v.id}>{v.id} · {v.temp === 'reefer' ? 'fridge' : 'dry'} {v.type}</option>)}
          </select>
        </label>
        <Button variant="outline" className="h-11" disabled={!eligible || current?.busy} onClick={() => { void compare(); }}>{current?.busy ? 'Comparing…' : 'Show what changes'}</Button>
      </div>
      {screen.saving !== 'saved' || screen.acting || refreshing || stale ? <p role="status" className="text-xs text-muted-foreground">Wait for the board to finish saving and refreshing before comparing.</p> : null}
      {current?.error ? <p role="alert" className="text-sm text-destructive">{current.error} Refresh the board before trying again.</p> : null}
      {result ? <>
        <p className="text-xs text-muted-foreground">Both generated plans pass the same checks. Checker warnings are shown below. Generated plans may need dispatcher decisions before Send.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Generated plan comparison</caption>
          <thead><tr><th className="py-2">Measure</th><th>Generated baseline</th><th>Without {result.excludedVehicleId}</th><th>Change</th></tr></thead>
          <tbody>{figures.map(([key, label]) => { const before = result.baseline.summary[key]; const after = result.scenario.summary[key]; const delta = Math.round((after - before) * 10) / 10;
            return <tr key={key} className="border-t"><th className="py-2 font-medium">{label}</th><td>{before}</td><td>{after}</td><td>{delta > 0 ? '+' : ''}{delta}</td></tr>; })}</tbody>
        </table></div>
        <p className="text-xs">{result.baseline.summary.totalOrders} original orders with outstanding demand. Split parts count together.</p>
        {([['Generated baseline', result.baseline], [`Without ${result.excludedVehicleId}`, result.scenario]] as const).map(([label, outcome]) => <div key={label}>
          {outcome.check.problems.length ? <details><summary className="cursor-pointer text-xs font-semibold">{label}: {outcome.check.problems.length} checker warnings</summary><ul className="mt-1 space-y-1 text-xs text-muted-foreground">{outcome.check.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></details> : null}
        </div>)}
        <ul aria-label="Changed or waiting original orders" className="space-y-3">{changed?.map((o) => {
          const before = baseline.get(o.orderId)!;
          return <li key={o.orderId} className="rounded-[10px] border p-3 text-xs">
            <p className="font-semibold">{o.shopName} · {before.status} → {o.status}</p>
            <p className="mt-1 text-muted-foreground">Vehicles: {before.vehicleIds.join(', ') || 'none'} → {o.vehicleIds.join(', ') || 'none'}{o.waitedBefore ? ' · already waited before' : ''}</p>
            <details className="mt-2"><summary className="cursor-pointer font-semibold">Planner reasons</summary>
              <p className="mt-1 font-semibold">Generated baseline</p>{before.reasons.map((r) => <p key={r} className="mt-1 text-muted-foreground">{r}</p>)}
              <p className="mt-2 font-semibold">Without {result.excludedVehicleId}</p>{o.reasons.map((r) => <p key={r} className="mt-1 text-muted-foreground">{r}</p>)}
            </details>
          </li>;
        })}</ul>
      </> : null}
    </div>
  </details>;
}
