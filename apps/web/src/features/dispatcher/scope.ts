import { BOTH_DEPOTS } from '@wayfinder/contracts';
import { useMe } from '@/features/auth/api';

// The booklet's two depots (outlets.csv, vehicles.csv), as the frames' switches list them.
export const DEPOTS = ['Peliyagoda', 'Kandy'] as const;
// The switch's choices, "Peliyagoda · Kandy · Both", as every Dispatcher frame's top bar and the map card draw them.
export const SWITCH_CHOICES = [...DEPOTS, BOTH_DEPOTS] as const;

// What a dispatcher's pages read (spec 021, D-96): the depot the session is on, or on both depots together each depot
// apart, Peliyagoda then Kandy. A read always names one depot; Both is never one.
export const depotsOf = (scope: string | null | undefined): string[] => (!scope ? [] : scope === BOTH_DEPOTS ? [...DEPOTS] : [scope]);

// The id of the heading that names one depot's part of a page on both depots together, which labels the part.
export const partId = (depot: string) => `part-${depot}`;

// What the line under the dispatcher's name says of the session's depot: the depot, or "Both depots".
export const scopeName = (scope: string) => (scope === BOTH_DEPOTS ? 'Both depots' : scope);

// The session's depot as the account on screen says it, the depots its pages read and whether that is both.
export function useScope() {
  const { data: me } = useMe();
  const scope = me?.depotId ?? null;
  return { scope, depots: depotsOf(scope), both: scope === BOTH_DEPOTS };
}
