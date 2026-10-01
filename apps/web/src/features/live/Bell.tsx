import { Link } from 'react-router';
import alertIcon from '@/assets/icons/icon-alert.png';
import { useScope } from '@/features/dispatcher/scope';
import { useIssueLists } from './issues';
import { openCount } from './sums';

// The design's bell for a dispatcher (spec 012), in the shell's bell slot: a red count of the open problems over its
// corner, and a tap opens Live day. On both depots together it counts both depots' problems (spec 021). No count when
// none is open, or when a list cannot be read, so it never counts one depot as both, and Live day then shows why.
export function Bell() {
  const { depots } = useScope();
  const count = openCount(useIssueLists(depots)) ?? 0;
  const label = count > 0 ? `Live day: ${count} ${count === 1 ? 'problem needs' : 'problems need'} you` : 'Live day';
  return (
    <Link
      to="/dispatcher/live"
      aria-label={label}
      className="relative shrink-0 rounded-full p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 max-lg:order-last"
    >
      <img src={alertIcon} alt="" className="size-7" />
      {count > 0 && (
        <span aria-hidden="true" className="absolute top-0 -right-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] leading-none font-bold text-card tabular-nums">
          {count}
        </span>
      )}
    </Link>
  );
}
