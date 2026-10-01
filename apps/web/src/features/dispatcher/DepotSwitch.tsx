import type { CSSProperties } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DEPOTS, youPlan } from './depots';

// The depot switch in the top bar (the Dispatcher frames). A dispatcher plans their own depot only (D-32), so the
// switch shows it chosen and greys the others, which say why when pointed at or pressed. It shows from 1280 px,
// where the top bar has room for it beside the tabs; the shell names the depot under the dispatcher's name anyway.
export function DepotSwitch({ depot }: { depot: string }) {
  const others = [...DEPOTS.filter((name) => name !== depot), 'Both'];
  return (
    <div role="group" aria-label="Depot" className="hidden h-7 items-stretch overflow-hidden rounded-lg border bg-card text-xs leading-none font-semibold xl:flex">
      <span aria-current="true" className="flex items-center bg-secondary px-2.5 text-secondary-foreground">{depot}</span>
      {others.map((name) => (
        <OtherDepot key={name} name={name} depot={depot} className="flex items-center px-2.5 text-muted-foreground/65 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
      ))}
    </div>
  );
}

// A depot the dispatcher does not plan, greyed by its caller: pointing at it or pressing it says whose depot this is,
// and nothing else changes. The top bar's switch and the dashboard map's view switch (spec 019) both use it.
export function OtherDepot({ name, depot, className, style }: { name: string; depot: string; className?: string; style?: CSSProperties }) {
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={150} aria-disabled="true" className={className} style={style}>
        {name}
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={8} className="w-auto px-3 py-2 text-xs font-semibold">{youPlan(depot)}</PopoverContent>
    </Popover>
  );
}
