import { Navigate, useNavigate, useSearchParams } from 'react-router';
import type { Me } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { ICON } from './parts/icons';
import { TopArea } from './parts/TopArea';
import { ActionBar, BIG, PLAIN } from './parts/ui';
import { retrySync } from './sender';
import { useDriverView } from './view';
import { savedLine } from './words';

// Driver · delivery saved locally at /driver/saved?stop= (spec 013, rule 12): a delivery, a refusal or a closed shop
// saved while there is no signal. It waits on the phone and sends by itself when the signal is back.
export function SavedPage({ me }: { me: Me }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const view = useDriverView(me.id);
  if (!view.ready) return null;
  const stop = view.trip?.stops.find((s) => s.id === params.get('stop'));
  if (!stop || !view.figures) return <Navigate to="/driver" replace />;
  return (
    <div className="flex min-h-[calc(100dvh-93px)] flex-col">
      <TopArea waitingRecords={view.waitingRecords} />
      <div role="status" className="flex flex-1 flex-col items-center justify-center px-4 pb-10 text-center">
        {/* The picture has room around the tray, so it is drawn larger than the tray's 78 px. */}
        <img src={ICON.tray} alt="" className="-my-2.5 size-[92px] object-contain" />
        <h1 className="mt-[19px] text-[26px] leading-8 font-bold">Saved on this phone</h1>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">{savedLine(stop, view.figures)}</p>
        <p className="mt-2.5 text-sm leading-5">Sends by itself when the signal is back</p>
      </div>
      <ActionBar>
        <Button className={BIG('text-sm')} onClick={() => navigate('/driver', { replace: true })}>Continue route</Button>
        <Button variant="outline" className={PLAIN()} onClick={retrySync}>Retry sync</Button>
      </ActionBar>
    </div>
  );
}
