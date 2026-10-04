import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { reasonOf } from '@/features/store/words';
import type { PlanBoard, PlanRef } from '@wayfinder/contracts';
import { applyComparison, fetchComparison } from '../board';
import { whole } from '../words';
import { orangeButton, plainButton } from './look';

type Act = (run: (date: string, ref: PlanRef) => Promise<PlanBoard>) => Promise<string | null>;

// Your saved draft beside a suggestion for the same demand. Looking does not change the draft.
export function ComparePanel({ board, act }: { board: PlanBoard; act: Act }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const date = board.day?.date;
  const compare = useQuery({
    queryKey: ['plans', date, 'compare', board.plan.revision],
    queryFn: () => fetchComparison(date!),
    enabled: open && date !== undefined && board.plan.status === 'draft',
  });
  if (board.plan.status !== 'draft' || !date) return null;
  const stale = compare.data !== undefined && compare.data.revision !== board.plan.revision;
  const useSuggested = async () => {
    const found = compare.data;
    if (!found || stale || !found.canApply) return;
    setApplying(true);
    const refused = await act((day, ref) => applyComparison(day, { ...ref, demandKey: found.demandKey, fingerprint: found.fingerprint }));
    setApplying(false);
    if (refused) setProblem(refused);
    else setOpen(false);
  };
  return (
    <section className="mt-3" aria-label="Compare plans">
      {!open && <Button variant="outline" className={plainButton('h-9 px-4 text-sm')} onClick={() => setOpen(true)}>Compare with suggested plan</Button>}
      {open && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">Your plan and a suggestion</h2>
            <Button variant="outline" className={plainButton('ml-auto h-9 px-3 text-sm')} onClick={() => setOpen(false)}>Keep my plan</Button>
          </div>
          {compare.isPending && <p role="status" className="mt-3 text-sm text-muted-foreground">Checking a suggestion for the same orders…</p>}
          {compare.isError && (
            <div role="alert" className="mt-3 text-sm">
              <p className="font-semibold text-bad">Could not compare</p>
              <p className="mt-1 text-muted-foreground">{reasonOf(compare.error)}</p>
              <Button variant="outline" className={plainButton('mt-2 h-9 px-3')} onClick={() => { void compare.refetch(); }}>Compare again</Button>
            </div>
          )}
          {compare.data && (
            <>
              <p className="mt-2 text-sm font-semibold">{stale ? 'This comparison is out of date.' : compare.data.summary}</p>
              {compare.data.suggested && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th className="py-1 pr-3 font-semibold"> </th>
                        <th className="py-1 pr-3 font-semibold">Your current plan</th>
                        <th className="py-1 pr-3 font-semibold">Suggested plan</th>
                        <th className="py-1 font-semibold">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Row label="Original orders fully covered" current={compare.data.current.originalFull} suggested={compare.data.suggested.originalFull} of={compare.data.current.originalDue} />
                      <Row label="Partly covered" current={compare.data.current.originalPart} suggested={compare.data.suggested.originalPart} />
                      <Row label="Deferred" current={compare.data.current.originalDeferred} suggested={compare.data.suggested.originalDeferred} />
                      <Row label="Still waiting" current={compare.data.current.originalWaiting} suggested={compare.data.suggested.originalWaiting} />
                      <Row label="Estimated fuel, L" current={compare.data.current.fuelL} suggested={compare.data.suggested.fuelL} decimal />
                      <Row label="Vehicles" current={compare.data.current.vehicles} suggested={compare.data.suggested.vehicles} />
                      <Row label="Trips" current={compare.data.current.trips} suggested={compare.data.suggested.trips} />
                      <Row label="Blockers" current={compare.data.current.blockers} suggested={compare.data.suggested.blockers} />
                    </tbody>
                  </table>
                </div>
              )}
              {compare.data.unavailable && <p className="mt-2 text-sm">{compare.data.unavailable}</p>}
              {compare.data.changes.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {compare.data.changes.slice(0, 8).map((change) => <li key={change.shop}><span className="font-semibold">{change.shop}.</span> {change.detail}</li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {stale
                  ? <Button variant="outline" className={plainButton('h-11 px-4 text-sm')} onClick={() => { void compare.refetch(); }}>Compare again</Button>
                  : <Button className={orangeButton('h-11 px-4 text-sm')} disabled={!compare.data.canApply || applying} onClick={() => { void useSuggested(); }}>{applying ? 'Applying…' : 'Use suggested plan'}</Button>}
              </div>
              {compare.data.suggested && !compare.data.canApply && !stale && <p className="mt-2 text-sm text-muted-foreground">This suggestion is not ready to apply. It may be missing a driver or still blocked.</p>}
              {problem && <p role="alert" className="mt-2 text-sm font-semibold text-bad">{problem}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const tenth = (n: number) => Math.round(n * 10) / 10;

function Row({ label, current, suggested, of, decimal = false }: { label: string; current: number | null; suggested: number | null; of?: number; decimal?: boolean }) {
  const show = (value: number | null) => {
    if (value === null) return 'Unknown';
    if (of !== undefined) return `${whole(value)} of ${whole(of)}`;
    return decimal ? tenth(value).toFixed(1) : whole(value);
  };
  const delta = current === null || suggested === null ? 'Unknown'
    : decimal ? tenth(tenth(suggested) - tenth(current)).toFixed(1) : whole(suggested - current);
  return (
    <tr className="border-t">
      <th className="py-1.5 pr-3 font-semibold">{label}</th>
      <td className="py-1.5 pr-3">{show(current)}</td>
      <td className="py-1.5 pr-3">{show(suggested)}</td>
      <td className="py-1.5">{delta}</td>
    </tr>
  );
}
