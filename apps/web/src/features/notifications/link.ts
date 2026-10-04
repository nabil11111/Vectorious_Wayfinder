import { DEPOTS } from '@/features/dispatcher/scope';

// Keep the issue/trip query when consuming the depot hint on a notification link.
export function depotTarget(link: string): { path: string; depot: string | null } {
  const queryAt = link.indexOf('?');
  if (queryAt < 0) return { path: link, depot: null };
  const params = new URLSearchParams(link.slice(queryAt + 1));
  const depot = params.get('depot');
  params.delete('depot');
  const rest = params.toString();
  return { path: link.slice(0, queryAt) + (rest ? `?${rest}` : ''), depot: depot || null };
}

// A service-worker click loads a URL directly, without the bell's click handler. Use the existing
// guarded depot switch and consume the hint once; its normal error UI handles a refused switch.
export function followDepotLink(link: string, current: string | null, switching: boolean, choose: (depot: string) => void, replace: (path: string) => void): boolean {
  const target = depotTarget(link);
  if (!current || switching || !target.depot || !DEPOTS.some((depot) => depot === target.depot)) return false;
  if (target.depot !== current) choose(target.depot);
  replace(target.path);
  return true;
}
