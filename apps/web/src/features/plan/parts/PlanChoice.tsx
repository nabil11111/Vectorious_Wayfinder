import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BoardOrder, PlanBoard, PlanRef } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { reasonOf } from '@/features/store/words';
import { applyArrangement, fetchArrangement, refOf, useCrews, type BoardScreen, type Undo } from '../board';
import { planOf, sameDraft, type CrewRef } from '../draft';
import { cubic, hhmm, litres, reasonWords, tonnes, whole } from '../words';
import { crewRows, crewSections, crewsFor, type Pick } from './crews';
import { demandLine } from './demand';
import type { BoardIndex } from './lookup';
import { inkButton, orangeButton, plainButton } from './look';

type Act = (run: (date: string, ref: PlanRef) => Promise<PlanBoard>, done?: (board: PlanBoard) => void, said?: Undo) => Promise<string | null>;

// Plan these orders: one checked arrangement, then the other crews that can take the whole load.
export function PlanChoice({ screen, index, orders, title, act, onCrew, onClose }: {
  screen: BoardScreen;
  index: BoardIndex;
  orders: BoardOrder[];
  title: string;
  act: Act;
  onCrew: (pick: Pick, crew: CrewRef) => void;
  onClose: () => void;
}) {
  const { board, draft } = screen;
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const saved = sameDraft(draft, planOf(board));
  const ids = orders.map((order) => order.id);
  const arrangement = useQuery({
    queryKey: ['plans', board.day!.date, 'arrange', ids.join(','), board.plan.revision],
    queryFn: () => fetchArrangement(board.day!.date, { ...refOf(board), orderIds: ids }),
    enabled: saved && board.plan.status === 'draft',
  });
  const crews = useCrews(board.day!.date, ids, board.plan.revision, saved);
  const read = crewsFor(crews.data, board, draft);
  const pick: Pick = { kind: 'start', group: null, orders, startWith: orders };
  const sections = read ? crewSections(crewRows(read, pick, draft, index)) : null;
  const [openConstraints, setOpenConstraints] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const useArrangement = async () => {
    const found = arrangement.data;
    if (!found) return;
    setApplying(true);
    const refused = await act(
      (date, ref) => applyArrangement(date, { ...ref, orderIds: ids, fingerprint: found.fingerprint }),
      undefined,
      { line: found.splits.length > 0 ? 'Used the arrangement. A split cannot be undone.' : 'Used the arrangement', tripKey: null },
    );
    setApplying(false);
    if (refused) setProblem(refused);
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-3 sm:items-center" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-[600px] overflow-y-auto rounded-xl bg-card p-4 shadow-lg outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base leading-5 font-bold">{title}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{demandLine(orders, (id) => index.shop(id))}</p>
          </div>
          <Button variant="outline" className={plainButton('h-11 px-4 text-sm')} onClick={onClose}>Cancel</Button>
        </div>
        {!saved && <p className="mt-3 text-sm text-muted-foreground">Save the draft before planning these orders. The check uses the saved plan.</p>}
        {arrangement.isError && (
          <div role="alert" className="mt-3 rounded-[10px] bg-bad-tint px-3 py-2 text-sm">
            <p className="font-semibold text-bad">Could not check an arrangement</p>
            <p className="mt-1 text-muted-foreground">{reasonOf(arrangement.error)}</p>
            <Button variant="outline" className={plainButton('mt-2 h-10 px-4')} onClick={() => { void arrangement.refetch(); }}>Try again</Button>
          </div>
        )}
        {saved && arrangement.isPending && <p role="status" className="mt-3 text-sm text-muted-foreground">Checking an arrangement…</p>}
        {arrangement.data && (
          <section className="mt-4" aria-label="Suggested arrangement">
            <h3 className="text-sm font-bold">Suggested arrangement</h3>
            <p className="mt-1 text-sm leading-5">{arrangement.data.summary}</p>
            <ul className="mt-2 space-y-2">
              {arrangement.data.crews.map((crew) => {
                const shown = crew.shops.slice(0, 3);
                const more = crew.shops.length - shown.length;
                return (
                  <li key={`${crew.vehicleId}-${crew.tripNo}`} className="rounded-[10px] border px-3 py-2.5">
                    <p className="text-sm font-semibold">{index.driver(crew.driverId)?.name ?? 'No driver'} · {crew.vehicleId} · {crew.refrigerated ? 'refrigerated' : 'ordinary'}</p>
                    {!crew.driverId && <p className="mt-1 text-sm font-semibold text-warn-ink">Needs a driver before this trip can go out.</p>}
                    <p className="mt-1 text-sm leading-5">{crew.why}</p>
                    <p className="mt-1 text-sm">{shown.join(', ')}{more > 0 ? ` and ${more} more` : ''}</p>
                    <p className="mt-1 text-sm">{tonnes(crew.kg)} of {tonnes(crew.weightCapKg)} · {cubic(crew.m3)} of {cubic(crew.volumeCapM3)}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-sm font-semibold">Times and fuel</summary>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {crew.leaveAt !== null && crew.backAt !== null ? `${hhmm(crew.leaveAt)} to ${hhmm(crew.backAt)}` : 'Times not estimated'}
                        {crew.fuelL !== null ? ` · ${litres(crew.fuelL)} estimated` : ''}
                        {crew.quotaLeftL !== null ? ` · ${litres(crew.quotaLeftL)} quota left` : ''}
                      </p>
                    </details>
                  </li>
                );
              })}
            </ul>
            {arrangement.data.waiting.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-bold">Still waiting</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {arrangement.data.waiting.map((item) => <li key={item.orderId}>{item.shop}: {reasonWords(item.reason)}</li>)}
                </ul>
              </div>
            )}
            {arrangement.data.splits.length > 0 && <p className="mt-2 text-sm text-muted-foreground">A split cannot be undone. The rest of the order goes back to unplanned.</p>}
            <Button className={orangeButton('mt-3 h-11 px-5 text-sm')} disabled={applying || arrangement.data.crews.length === 0} onClick={() => { void useArrangement(); }}>
              {applying ? 'Applying…' : 'Use this arrangement'}
            </Button>
            {problem && <p role="alert" className="mt-2 text-sm font-semibold text-bad">{problem}</p>}
          </section>
        )}
        {sections && ((sections.suggested.length > 0 && !arrangement.data?.singleVehicle) || sections.other.length > 0) && (
          <section className="mt-4">
            {!arrangement.data?.singleVehicle && <h3 className="text-sm font-bold">One vehicle for the whole load</h3>}
            {!arrangement.data?.singleVehicle && <ul className="mt-2 space-y-2">
              {sections.suggested.map((row) => (
                <li key={row.vehicleId} className="rounded-[10px] border px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{row.title}</p>
                      <p className="mt-0.5 text-xs font-semibold">{row.badge}</p>
                      <p className="mt-1 text-sm leading-5">{row.line}</p>
                      {row.history && <p className="mt-1 text-xs text-muted-foreground">{row.history}</p>}
                      {sections.suggested[0]?.vehicleId === row.vehicleId && !row.history && <p className="mt-1 text-xs text-muted-foreground">No prior assignment found</p>}
                      {row.warning && <p className="mt-1 text-xs font-semibold text-warn-ink">{row.warning}</p>}
                      {openConstraints === row.vehicleId && row.detail !== row.line && <p className="mt-1 text-sm leading-5">{row.detail}</p>}
                    </div>
                    <Button variant="outline" className={inkButton('h-11 px-3 text-sm')} onClick={() => onCrew({ ...pick, leaveAt: row.leaveAt }, { vehicleId: row.vehicleId, driverId: row.driverId })}>Use</Button>
                  </div>
                  {row.detail !== row.line && (
                    <button type="button" className="mt-1 text-sm font-semibold underline" onClick={() => setOpenConstraints(openConstraints === row.vehicleId ? null : row.vehicleId)}>
                      {openConstraints === row.vehicleId ? 'Hide constraints' : 'See constraints'}
                    </button>
                  )}
                </li>
              ))}
            </ul>}
            {sections.other.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold">Other vehicles · {whole(sections.other.length)}</summary>
                <ul className="mt-2 space-y-2">
                  {sections.other.map((row) => (
                    <li key={row.vehicleId} className="rounded-[10px] border px-3 py-2">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{row.title}</p>
                          <p className="mt-0.5 text-xs font-semibold">{row.badge}</p>
                          <p className="mt-1 text-sm leading-5">{row.line}</p>
                        </div>
                        <Button variant="outline" className={inkButton('h-11 px-3 text-sm')} onClick={() => onCrew({ ...pick, leaveAt: row.leaveAt }, { vehicleId: row.vehicleId, driverId: row.driverId })}>Use</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
        {sections && sections.unavailable.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Unavailable for these orders · {whole(sections.unavailable.length)}</summary>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {sections.unavailable.map((row) => <li key={row.vehicleId}>{row.title}. {row.line}</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
