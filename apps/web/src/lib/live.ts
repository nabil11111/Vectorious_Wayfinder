import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { LiveEvent } from '@wayfinder/contracts';
import { toast } from 'sonner';
import { useMe } from '@/features/auth/api';
import { clockKey, demoKey, partAt, shownAt, type HeldClock } from './clock';

// Live updates on screen (spec 008, D-21). One stream per signed-in screen says what changed, never the data:
// a topic and sometimes an id. The screen then fetches through the normal API, so it only ever shows what the
// person's role may read. Every query key starts with its topic, so a message refetches everything under it.

// How long to wait before opening a stream again after the browser gave up on it, the pace the browser keeps
// itself after a dropped connection. A refused try costs the server one quick answer.
const REOPEN_AFTER_MS = 3000;

// The clock was moved or the day reset. "Today" changed for every screen, so everything is fetched again, and
// one line on top says what happened. A change made on this screen reaches its stream too, but its control
// already shows it, so that one gets no line.
async function followClock(qc: QueryClient, topic: 'clock' | 'demo') {
  const madeHere = qc.isMutating({ mutationKey: demoKey }) > 0;
  const before = qc.getQueryData<HeldClock>(clockKey);
  void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== clockKey[0] });
  await qc.invalidateQueries({ queryKey: clockKey });
  const after = qc.getQueryData<HeldClock>(clockKey);
  // The same revision means nothing new arrived: this screen had it already, or the clock could not be read.
  if (madeHere || !before || !after?.part || after.revision === before.revision) return;
  const line = topic === 'demo'
    ? 'The demo day was reset. It is Wednesday 15:00 again.'
    : `The clock moved to ${partAt(after.part, shownAt(before, performance.now()))}.`;
  toast(line, { id: 'demo-clock', duration: 6000, classNames: { title: 'text-pretty' } });
}

// The live stream, mounted once in the shell. It opens when someone signs in and closes when they sign out. A stream
// carries the depot it opened with, so it opens again when a dispatcher switches depots (spec 020).
export function useLive() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const userId = me?.id;
  const depotId = me?.depotId;

  useEffect(() => {
    if (!userId) return;
    let stream: EventSource;
    let reopen = 0;
    // What was said while the stream was broken is lost, so the first open after a break fetches everything.
    let broken = false;

    const open = () => {
      stream = new EventSource('/api/v1/events');
      stream.addEventListener('change', (message) => {
        const change = LiveEvent.safeParse(JSON.parse(message.data));
        if (!change.success) return;
        const { topic } = change.data;
        if (topic === 'clock' || topic === 'demo') void followClock(qc, topic);
        else {
          void qc.invalidateQueries({ queryKey: [topic] });
          if (['plans', 'loading', 'driver', 'orders', 'issues', 'admin'].includes(topic)) {
            void qc.invalidateQueries({ queryKey: ['lookup'] });
          }
          if (['plans', 'loading', 'driver', 'orders', 'issues'].includes(topic)) {
            void qc.invalidateQueries({ queryKey: ['operations'] });
            // The bell's updates are read from the same records (spec 025), so its read is fetched again too.
            void qc.invalidateQueries({ queryKey: ['notifications'] });
          }
          // A driver's record moves a problem's card too: "Still on VEH057 · 39 cartons · 1 stop left" follows the
          // trip on Live day and the Dashboard, to "no stops left" once the last stop is done (Q-28).
          if (topic === 'receiving') {
            void qc.invalidateQueries({ queryKey: ['driver'] });
            void qc.invalidateQueries({ queryKey: ['notifications'] });
            void qc.invalidateQueries({ queryKey: ['operations'] });
          }
          if (topic === 'driver') void qc.invalidateQueries({ queryKey: ['issues'] });
        }
      });
      stream.onopen = () => {
        if (broken) void qc.invalidateQueries();
        broken = false;
      };
      stream.onerror = () => {
        broken = true;
        // The browser opens a dropped stream again by itself, but gives up on an answer that is not a stream,
        // such as a proxy's 502 while the server restarts or 503 when too many are open, and on a stream the
        // browser itself blocks. The one-minute refetch keeps the screen current until this one opens.
        if (stream.readyState === EventSource.CLOSED) reopen = window.setTimeout(open, REOPEN_AFTER_MS);
      };
    };

    // Back online, the stream is tried at once rather than when the browser's own retry comes round, so an answer
    // waiting for this screen arrives with the signal.
    const onOnline = () => {
      if (stream.readyState === EventSource.OPEN) return;
      window.clearTimeout(reopen);
      stream.close();
      broken = true;
      open();
    };

    open();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearTimeout(reopen);
      stream.close();
    };
  }, [qc, userId, depotId]);
}
