import { AppShell, ComingNext } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';

export function LoaderHome() {
  const { data: me } = useMe();
  return (
    <AppShell place={me?.depotId ? `${me.depotId} dock` : undefined}>
      <ComingNext title="Today's trucks" what="The next truck out, what goes in first, then the rest of the day's trucks." />
    </AppShell>
  );
}
