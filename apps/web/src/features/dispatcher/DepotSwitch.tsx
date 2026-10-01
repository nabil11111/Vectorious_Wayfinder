import { cn } from '@/lib/utils';
import { useSwitchDepot } from './depots';
import { SWITCH_CHOICES } from './scope';

// The depot switch in the top bar, "Peliyagoda · Kandy · Both" as the Dispatcher frames draw it. A dispatcher works on
// one depot (D-93) or on both together (D-96, spec 021): the chosen one is filled, and pressing another switches every
// page to it. It shows from 1280 px, where the top bar has room for it beside the tabs. Below that, the dashboard's map
// card has the same switch, and the shell names the depot, or both, under the dispatcher's name.
export function DepotSwitch({ depot }: { depot: string }) {
  const { chosen, switching, choose } = useSwitchDepot(depot);
  return (
    <div role="group" aria-label="Depot" aria-busy={switching} className="hidden h-7 items-stretch overflow-hidden rounded-lg border bg-card text-xs leading-none font-semibold xl:flex">
      {SWITCH_CHOICES.map((name) => (
        <button key={name} type="button" aria-pressed={name === chosen} onClick={() => choose(name)}
          className={cn('flex items-center px-2.5 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50',
            name === chosen ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
          {name}
        </button>
      ))}
    </div>
  );
}
