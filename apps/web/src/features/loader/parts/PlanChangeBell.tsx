import { Link } from 'react-router';
import alertIcon from '@/assets/icons/icon-alert.png';
import { usePlanChanges } from '../changes';

// The loader's bell (Loader · Plan changed and Today's trucks · plan changed): it opens the comparison again, and its
// red count is the comparison's rows, a whole-trip move counted once. It is not an unread count: Got it leaves it, and
// the next publication or day replaces it (D-71).
export function PlanChangeBell() {
  const { kept } = usePlanChanges();
  const count = kept?.changes?.length ?? 0;
  const label = count > 0 ? `Plan changed: ${count} ${count === 1 ? 'trip' : 'trips'} changed` : 'Plan changes';
  return (
    <Link
      to="/loader/changes"
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
