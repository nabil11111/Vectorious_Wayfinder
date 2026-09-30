import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { useNextOrder } from './next-order';
import { orangeLink } from './parts/actions';
import { Panel } from './parts/Panel';

// Help (Shop · Help): who to contact, and where a missing or damaged delivery is reported. The words are the
// frame's. Only the shop's name comes from the API, and the help stays readable when that cannot load.
export function HelpPage() {
  const next = useNextOrder();

  return (
    <div className="max-w-xl lg:pt-2.5">
      <h1 className="font-sans text-[22px] leading-[27px] font-bold">Help</h1>
      <div className="mt-[7px] text-[13px] leading-4 text-muted-foreground">
        {next.data ? <p>{next.data.outlet.name}</p>
          : next.isError ? <p role="alert">Could not load your shop’s name.</p>
          : <Skeleton className="h-4 w-28" />}
      </div>

      <Panel line className="mt-[26px] pb-[22px]">
        <h2 className="font-sans text-[17px] leading-6 font-semibold">Contact your depot</h2>
        <p className="mt-3 text-[13px] leading-[19.5px] text-muted-foreground">
          For a late delivery, a changed date or an order after the cutoff, contact your depot using your store’s usual contact number.
        </p>
        <p className="mt-2.5 text-xs leading-[15px] text-muted-foreground">Keep the order or vehicle details ready.</p>
      </Panel>

      <Panel line className="mt-4">
        <h2 className="font-sans text-base leading-[19px] font-semibold">Something missing or damaged?</h2>
        <p className="mt-[15px] text-[13px] leading-[19.5px] text-muted-foreground">
          Record the actual quantities when you confirm the delivery. Keep any photo with the report.
        </p>
        <Link to="/store/deliveries" className={orangeLink('mt-1.5 h-[46px] w-full text-sm')}>
          Open delivery confirmation
        </Link>
      </Panel>
    </div>
  );
}
