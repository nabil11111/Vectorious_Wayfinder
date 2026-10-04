// A warning about the other depot links to its plan board and names the depot to switch to (spec 031).
// Every other update is an ordinary address.
export function depotTarget(link: string): { path: string; depot: string | null } {
  const queryAt = link.indexOf('?');
  if (queryAt < 0) return { path: link, depot: null };
  const depot = new URLSearchParams(link.slice(queryAt + 1)).get('depot');
  return { path: link.slice(0, queryAt), depot: depot || null };
}
