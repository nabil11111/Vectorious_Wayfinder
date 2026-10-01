import type { Location } from 'react-router';

// Leaving the flag form while its flag is on its way or not sent asks first (Q-22). The loader works online and has no
// outbox to keep a flag in until the signal comes back (D-38), so a flag that is not sent would otherwise be lost with
// the form, and the stop loaded as if nothing were wrong. Any other address leaves the form, another stop's form too.
type Place = Pick<Location, 'pathname' | 'search'>;
export const asksBeforeLeaving = (holding: boolean, from: Place, to: Place) => holding && (from.pathname !== to.pathname || from.search !== to.search);
