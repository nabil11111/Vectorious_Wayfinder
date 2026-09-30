import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// The booklet's two depots (outlets.csv, vehicles.csv), as the frames' switch lists them.
const DEPOTS = ['Peliyagoda', 'Kandy'];

// The depot switch in the top bar (the Dispatcher frames). A dispatcher plans their own depot only (D-32), so the
// switch shows it chosen and greys the others, which say why when pointed at or pressed.
export function DepotSwitch({ depot }: { depot: string }) {
  const others = [...DEPOTS.filter((name) => name !== depot), 'Both'];
  return (
    <div role="group" aria-label="Depot" className="flex h-7 items-stretch overflow-hidden rounded-lg border bg-card text-xs leading-none font-semibold">
      <span aria-current="true" className="flex items-center bg-secondary px-2.5 text-secondary-foreground">{depot}</span>
      {others.map((name) => (
        <Popover key={name}>
          <PopoverTrigger openOnHover delay={150} aria-disabled="true" className="flex items-center px-2.5 text-muted-foreground/65 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {name}
          </PopoverTrigger>
          <PopoverContent align="center" sideOffset={8} className="w-auto px-3 py-2 text-xs font-semibold">You plan {depot}</PopoverContent>
        </Popover>
      ))}
    </div>
  );
}
