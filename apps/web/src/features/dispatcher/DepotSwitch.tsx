import type { CSSProperties } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { BOTH_LATER, DEPOTS, useSwitchDepot } from './depots';

// The depot switch in the top bar, "Peliyagoda · Kandy · Both" as the Dispatcher frames draw it. A dispatcher works on
// one depot at a time and switches between the two (D-93): the chosen one is filled, and pressing the other switches
// every page to it. Both stays greyed and says why when pointed at or pressed. It shows from 1280 px, where the top bar
// has room for it beside the tabs. Below that, the dashboard's map card has the same switch, and the shell names the
// depot under the dispatcher's name.
export function DepotSwitch({ depot }: { depot: string }) {
  const { chosen, switching, choose } = useSwitchDepot(depot);
  return (
    <div role="group" aria-label="Depot" aria-busy={switching} className="hidden h-7 items-stretch overflow-hidden rounded-lg border bg-card text-xs leading-none font-semibold xl:flex">
      {DEPOTS.map((name) => (
        <button key={name} type="button" aria-pressed={name === chosen} onClick={() => choose(name)}
          className={cn('flex items-center px-2.5 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50',
            name === chosen ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
          {name}
        </button>
      ))}
      <BothLater className="flex items-center px-2.5 text-muted-foreground/65 outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50" />
    </div>
  );
}

// Both, greyed by its caller: pointing at it or pressing it says both depots together come later, and nothing else
// changes. The top bar's switch and the dashboard map's view switch both use it.
export function BothLater({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={150} aria-disabled="true" className={className} style={style}>
        Both
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={8} className="w-auto px-3 py-2 text-xs font-semibold">{BOTH_LATER}</PopoverContent>
    </Popover>
  );
}
