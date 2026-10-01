import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { orangeButton, plainButton } from '@/features/plan/parts/look';
import { reasonOf } from '@/features/store/words';
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
  const navigate = useNavigate();
  return (
    <div>
      <BackLink to="/loader">Trucks</BackLink>
      <Card className="mt-4 px-5 py-5 lg:max-w-[680px] lg:px-6 lg:py-6">
        <p className="text-[15px] leading-5 font-semibold">This truck is not on the list any more. The plan may have changed.</p>
        <Button className={orangeButton('mt-5 h-[52px] w-full rounded-[12px] text-[15px]')} onClick={() => navigate('/loader')}>Back to trucks</Button>
      </Card>
    </div>
  );
}
