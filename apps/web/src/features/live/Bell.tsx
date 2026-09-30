import { Link } from 'react-router';
import alertIcon from '@/assets/icons/icon-alert.png';
import { useIssues } from './issues';

// The design's bell for a dispatcher (spec 012), in the shell's bell slot: a red count of the depot's open problems
// over its corner, and a tap opens Live day. No count when none is open, or when the count cannot be read, and Live
// day then shows why.
export function Bell() {
  const { data, isError } = useIssues();
  const count = data && !isError ? data.issues.length : 0;
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
