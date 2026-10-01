import { useNavigate } from 'react-router';
import type { LoadingDay } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { orangeButton, plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
import { leftLine } from '../words';
import { BackLink } from './LoadCard';
import { Card } from './ui';

// "Could not load the trucks." with why, and Try again, in the card's place.
export function LoadFailed({ what, error, busy, onRetry }: { what: string; error: unknown; busy: boolean; onRetry: () => void }) {
  return (
    <Card role="alert" className="px-5 py-5 lg:max-w-[680px] lg:px-6 lg:py-6">
      <h1 className="font-sans text-[15px] leading-5 font-semibold">Could not load {what}.</h1>
      <p className="mt-1.5 text-[13px] leading-4 text-muted-foreground">{reasonOf(error)}</p>
      <Button variant="outline" className={plainButton('mt-4 h-[52px] w-full rounded-[12px] text-[15px]')} disabled={busy} onClick={onRetry}>
        {busy ? 'Trying…' : 'Try again'}
      </Button>
    </Card>
  );
}

// A truck the loading day no longer holds: the plan went back to edit, or was made again, or the day moved on.
export function NotOnList() {
  return <Gone sentence="This truck is not on the list any more. The plan may have changed." />;
}

// A truck that is off the list of trucks to load: one its driver drove away says who and when (Q-34), and any other
// left the plan.
export function TruckGone({ day, tripId }: { day: LoadingDay; tripId: string }) {
  const left = day.left.find((truck) => truck.tripId === tripId);
  return left ? <Gone sentence={leftLine(left)} /> : <NotOnList />;
}

function Gone({ sentence }: { sentence: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <BackLink to="/loader">Trucks</BackLink>
      <Card className="mt-4 px-5 py-5 lg:max-w-[680px] lg:px-6 lg:py-6">
        <p className="text-[15px] leading-5 font-semibold">{sentence}</p>
        <Button className={orangeButton('mt-5 h-[52px] w-full rounded-[12px] text-[15px]')} onClick={() => navigate('/loader')}>Back to trucks</Button>
      </Card>
    </div>
  );
}
