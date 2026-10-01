import { Button } from '@/components/ui/button';
import { ICON } from '@/features/plan/parts/icons';
import { plainButton } from '@/features/plan/parts/look';
import { Column } from '@/features/plan/parts/ui';
import { useSwitchDepot } from '../depots';
import { DEPOTS, useScope } from '../scope';

// What the plan board and View plan say on both depots together (spec 021, D-96).
export const PICK_A_DEPOT = 'A plan belongs to one depot. Pick the depot to plan:';

// The plan board or View plan on both depots together: a plan, its send and its checks belong to one depot, so the
// page reads no board and asks which depot to plan. A press switches every page to that depot through the same switch
// as the top bar's, with its loading state and its failure line (spec 020), and the page then shows that depot's
// board. Drawn as the board's own messages are: its title, then the design's picture and the line in a card.
export function PickDepot({ title }: { title: string }) {
  const { scope } = useScope();
  const { chosen, switching, choose } = useSwitchDepot(scope ?? DEPOTS[0]);
  return (
    <div className="space-y-4 lg:pt-2.5">
      <h1 className="text-xl leading-6 font-bold">{title}</h1>
      <Column className="max-w-xl p-4">
        <div className="flex items-center gap-3">
          <img src={ICON.route} alt="" className="size-10 shrink-0 object-contain" />
          <p className="text-sm">{PICK_A_DEPOT}</p>
        </div>
        <div role="group" aria-label="Depot to plan" aria-busy={switching} className="mt-3.5 flex flex-wrap gap-2.5 pl-[52px]">
          {DEPOTS.map((depot) => (
            <Button key={depot} variant="outline" aria-pressed={depot === chosen} disabled={switching} className={plainButton('h-10 px-6 text-[13px]')} onClick={() => choose(depot)}>
              {depot}
            </Button>
          ))}
        </div>
      </Column>
    </div>
  );
}
