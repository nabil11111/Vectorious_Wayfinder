import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router';

// Every page of the loader's area opens at its top (Q-18). The window keeps its scroll from one page to the next, so a
// truck opened from lower in Today's trucks opened at its foot, with the card that names the truck out of view. A page
// drawn again, such as when the day is fetched again, keeps its place.
export function useOpensAtTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
}
