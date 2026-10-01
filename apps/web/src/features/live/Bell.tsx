import { useScope } from '@/features/dispatcher/scope';
import { NotificationBell } from '@/features/notifications/Bell';

// The dispatcher's bell (spec 025): the shared bell with the updates of the depot on show, or of both depots under Both
// (spec 021), and "Open Live day" kept at its foot, where the bell used to go straight (spec 012).
export function Bell() {
  const { depots } = useScope();
  return <NotificationBell depots={depots} foot={{ to: '/dispatcher/live', label: 'Open Live day' }} />;
}
