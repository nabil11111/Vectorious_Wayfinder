import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import alertIcon from '@/assets/icons/icon-alert.png';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useMe } from '@/features/auth/api';
import { DepotTag } from '@/features/dispatcher/parts/DepotTag';
import { cn } from '@/lib/utils';
import { alertInBackground, alertsState, ALERT_WORDS, askForAlerts, type AlertsState } from './alerts';
import { useUpdates, type ShownUpdate } from './api';
import { keepShown, keptShown, freshOf, type Shown } from './fresh';
import { GlanceCard } from './GlanceCard';
import { iconOf } from './icons';
import { keptSeen, markAllRead, unreadOf } from './seen';

// The bell of every role and what it opens (spec 025, D-99): a red count of the person's unread updates, and a small
// pop-up under it with their updates for the day, newest first, a sheet from the bottom on a phone. It is built once and
// used by all four roles; the dispatcher's keeps "Open Live day" at its foot and the loader's "See what changed". A new
// update shows at once as a toast, or for a driver's answer as the glanceable card, and as a system alert when the tab is
// hidden and the person allowed it from the pop-up's own button. The design draws the bell and its count; no frame draws
// what it opens, so the pop-up follows the style guide's card and the design's 3D icons.

export interface BellFoot { to: string; label: string }

export function NotificationBell({ depots = null, foot = null }: { depots?: readonly string[] | null; foot?: BellFoot | null }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const updates = useUpdates(me?.id ?? null, depots);
  // What was seen and shown is kept per account and demo day, so a reset's earlier clock starts the bell afresh.
  const key = me && updates.demoDay !== null ? `${me.id}:${updates.demoDay}` : null;
  const [seen, setSeen] = useState<{ key: string | null; upTo: string | null }>({ key: null, upTo: null });
  const seenUpTo = seen.key === key ? seen.upTo : key ? keptSeen(key) : null;
  // Another tab of the same account marking all read is followed here.
  useEffect(() => {
    if (!key) return;
    const follow = () => setSeen({ key, upTo: keptSeen(key) });
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, [key]);
  const [alerts, setAlerts] = useState<AlertsState>(() => alertsState());
  const [openAs, setOpenAs] = useState<'sheet' | 'popover' | null>(null);
  const [glance, setGlance] = useState<ShownUpdate | null>(null);
  const closeGlance = useCallback(() => setGlance(null), []);

  // Each update newer than the newest this tab has seen, once (rule 3).
  const shown = useRef<{ key: string; shown: Shown | null } | null>(null);
  const role = me?.role;
  useEffect(() => {
    if (!key || !updates.ready) return;
    const before = shown.current?.key === key ? shown.current.shown : keptShown(key);
    const { fresh, next } = freshOf(updates.items, before);
    shown.current = { key, shown: next };
    keepShown(key, next);
    for (const item of fresh) {
      alertInBackground(item, (link) => { void navigate(link); });
      if (role === 'driver' && item.kind === 'problem_answered' && item.answer) setGlance(item);
      else toast(item.line, {
        id: item.id, duration: 8000, classNames: { title: 'text-pretty' },
        icon: <img src={iconOf(item)} alt="" className="size-6 object-contain" />,
        action: { label: 'Open', onClick: () => { void navigate(item.link); } },
      });
    }
  }, [key, updates.ready, updates.items, role, navigate]);

  if (!me) return null;
  const unread = unreadOf(updates.items, seenUpTo).length;
  const close = () => setOpenAs(null);
  const panel = (
    <UpdatesPanel
      items={updates.items} seenUpTo={seenUpTo} both={Boolean(depots && depots.length > 1)} foot={foot} alerts={alerts}
      onRead={() => { if (key) setSeen({ key, upTo: markAllRead(key, updates.items) }); }}
      onOpen={close}
      onAsk={() => { void askForAlerts().then(setAlerts); }}
    />
  );
  return (
    <>
      {/* A sheet from the bottom on a phone and a tablet, where the tabs sit at the foot, and a popover from 1024. */}
      <Sheet open={openAs === 'sheet'} onOpenChange={(open) => setOpenAs(open ? 'sheet' : null)}>
        <SheetTrigger render={<BellButton unread={unread} className="lg:hidden" />} />
        <SheetContent side="bottom" showCloseButton={false} className="max-h-[85dvh] gap-0 rounded-t-xl border-t-0 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {panel}
        </SheetContent>
      </Sheet>
      <Popover open={openAs === 'popover'} onOpenChange={(open) => setOpenAs(open ? 'popover' : null)}>
        <PopoverTrigger render={<BellButton unread={unread} className="hidden lg:inline-flex" />} />
        <PopoverContent align="end" sideOffset={8} className="w-[380px] gap-0 p-3">{panel}</PopoverContent>
      </Popover>
      {glance && <GlanceCard item={glance} onClose={closeGlance} />}
    </>
  );
}

// The design's bell with its red count over the corner, and no count when all is read. A trigger renders it, so it takes
// the trigger's own props.
export function BellButton({ unread, className, ...props }: { unread: number } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={unread > 0 ? `Updates: ${unread} unread` : 'Updates'}
      {...props}
      className={cn('relative shrink-0 rounded-full p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted max-lg:order-last', className)}
    >
      <img src={alertIcon} alt="" className="size-7" />
      {unread > 0 && (
        <span aria-hidden="true" className="absolute top-0 -right-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] leading-none font-bold text-card tabular-nums">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

// What the bell opens: the updates, each with its picture, line and time, unread ones marked, "Mark all read", the role's
// own link at the foot and the button for background alerts.
export function UpdatesPanel({ items, seenUpTo, both, foot, alerts, onRead, onOpen, onAsk }: {
  items: ShownUpdate[]; seenUpTo: string | null; both: boolean; foot: BellFoot | null; alerts: AlertsState;
  onRead: () => void; onOpen: () => void; onAsk: () => void;
}) {
  const unread = unreadOf(items, seenUpTo);
  const alertWords = ALERT_WORDS[alerts];
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <h2 className="font-heading text-base font-bold">Updates</h2>
        <button type="button" disabled={unread.length === 0} onClick={onRead}
          className="rounded-md px-1.5 py-1 text-xs font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:text-muted-foreground disabled:hover:bg-transparent">
          Mark all read
        </button>
      </div>
      {items.length === 0
        ? <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing yet for this day.</p>
        : (
          <ul className="-mx-1 min-h-0 overflow-y-auto overscroll-contain lg:max-h-[min(60vh,440px)]">
            {items.map((item) => {
              const isUnread = unread.includes(item);
              return (
                <li key={`${item.depot ?? ''}:${item.id}`}>
                  <Link to={item.link} onClick={onOpen} data-unread={isUnread}
                    className="flex items-start gap-3 rounded-lg px-2 py-2.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
                    <img src={iconOf(item)} alt="" className="size-8 shrink-0 object-contain" />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm leading-5 text-pretty', isUnread ? 'font-semibold' : 'text-foreground/85')}>{item.line}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs leading-4 text-muted-foreground tabular-nums">
                        {item.time}
                        {both && item.depot && <DepotTag depot={item.depot} />}
                      </span>
                    </span>
                    {isUnread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"><span className="sr-only">Unread</span></span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      {(foot || alertWords) && (
        <div className="mt-2 flex flex-col gap-2 border-t pt-3">
          {foot && (
            <Link to={foot.to} onClick={onOpen}
              className="flex h-10 items-center justify-center rounded-[10px] border bg-card text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
              {foot.label}
            </Link>
          )}
          {alertWords && (alerts === 'ask'
            ? <button type="button" onClick={onAsk} className="rounded-md px-1 py-1 text-left text-xs font-semibold text-foreground underline underline-offset-2 outline-none hover:text-foreground/80 focus-visible:ring-3 focus-visible:ring-ring/50">{alertWords}</button>
            : <p className="px-1 text-xs text-muted-foreground">{alertWords}</p>)}
        </div>
      )}
    </div>
  );
}
