import { shortDay, whole } from '@/features/loader/words';
import { NeedsYou } from './NeedsYou';
import { useAnswer, useIssues } from './issues';

// Live day at /dispatcher/live (spec 012, Dispatcher · Live day · issue open and · issue open · decision sent). Loading
// builds only its "Needs you" column and the title (D-39); the trucks on their timelines, the counts and the drops
// and events are A7's, and hold their place on the left. Below 1024 px the column comes first.
export function LiveDayPage() {
  const query = useIssues();
  const answering = useAnswer();
  const day = query.data?.day ?? null;
  // The one count here is of the problems the column lists.
  const open = query.data?.issues.length ?? 0;

  return (
    <div className="lg:-mt-[7px]">
      <header>
        <h1 className="text-xl leading-7 font-bold">
          Live day{day && ` · ${shortDay(day)}`}
          {/* The day waits for the first load, as a grey block in the style guide's loading look. */}
          {!day && query.isPending && <span aria-hidden="true" className="ml-2 inline-block h-5 w-28 rounded-full bg-border align-middle" />}
        </h1>
        {open > 0 && (
          <p className="mt-[9px] text-bad">
            <span className="font-mono text-sm leading-[18px] font-bold">{whole(open)}</span>{' '}
            <span className="ml-0.5 text-[11px] leading-[14px]">{open === 1 ? 'needs' : 'need'} you</span>
          </p>
        )}
      </header>
      <div className="mt-4 grid grid-cols-1 gap-5 lg:mt-3.5 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
        <section aria-label="Trucks" className="order-2 rounded-[14px] bg-card p-5 shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_8%,transparent)] lg:order-1">
          <p className="text-[13px] leading-[18px] text-muted-foreground">
            Trucks: each truck’s stops on a timeline, and the day’s drops and events. Figma: Dispatcher · Live day.
          </p>
        </section>
        <NeedsYou query={query} answering={answering} className="order-1 lg:order-2" />
      </div>
    </div>
  );
}
