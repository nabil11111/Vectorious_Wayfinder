import type { ReactNode } from 'react';
import { partId } from '../scope';

// The heading of one depot's part of a page on both depots together (spec 021): the depot's name, and beside it how
// current that depot's read is. The part's section is labelled by it.
export function DepotHeading({ depot, children }: { depot: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h2 id={partId(depot)} className="text-base leading-6 font-bold">{depot}</h2>
      {children}
    </div>
  );
}
