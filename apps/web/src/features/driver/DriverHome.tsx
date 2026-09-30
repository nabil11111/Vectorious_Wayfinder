import { AppShell, ComingNext } from '@/components/layout/AppShell';
import { useMe } from '@/features/auth/api';

export function DriverHome() {
  const { data: me } = useMe();
  return (
    <AppShell place={me?.depotId ? `${me.depotId} depot` : undefined}>
      <ComingNext title="Next stop" what="The shop, its window, what to unload and one big I've arrived. Works with no signal." />
    </AppShell>
  );
}
