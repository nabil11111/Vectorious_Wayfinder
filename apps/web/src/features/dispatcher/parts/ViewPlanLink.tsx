import { Link, useNavigate } from 'react-router';
import { useSwitchDepot } from '../depots';
import { useScope } from '../scope';

// View plan for a depot's day. On one depot it opens View plan. On both depots together a plan belongs to one depot
// (D-96), so it switches to the depot of the line it is on and opens View plan, which then shows that depot's plan; the
// switch shows its loading state meanwhile, and one that fails leaves View plan asking which depot to plan, with spec
// 020's line.
export function ViewPlanLink({ date, depot, className }: { date: string; depot: string; className?: string }) {
  const { scope, both } = useScope();
  const navigate = useNavigate();
  const { choose } = useSwitchDepot(scope ?? depot);
  const to = `/dispatcher/plan/${date}`;
  if (!both) return <Link to={to} className={className}>View plan</Link>;
  return <button type="button" className={className} onClick={() => { navigate(to); choose(depot); }}>View plan</button>;
}
