import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVehicle } from '@wayfinder/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

const vehiclesKey = ['admin', 'vehicles'] as const;

const TEMP_LABEL: Record<AdminVehicle['temp'], string> = {
  reefer: 'Fridge',
  ambient: 'Dry',
};

export function useAdminVehicles() {
  return useQuery({
    queryKey: vehiclesKey,
    queryFn: () => api<AdminVehicle[]>('/admin/vehicles'),
  });
}

export function useArchiveVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<AdminVehicle>(`/admin/vehicles/${id}/archive`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
  });
}

export function VehiclesPage() {
  const vehicles = useAdminVehicles();
  const archive = useArchiveVehicle();
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (vehicles.isPending) return <p className="text-muted-foreground">Loading vehicles…</p>;

  if (vehicles.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{vehicles.error.message}</p>
        <Button type="button" variant="outline" onClick={() => vehicles.refetch()}>Try again</Button>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const rows = vehicles.data.filter((v) =>
    q === '' || v.id.toLowerCase().includes(q) || v.type.toLowerCase().includes(q) || v.depotId.toLowerCase().includes(q));

  return (
    <section className="space-y-4 rounded-2xl bg-card p-6 shadow-sm">
      <h1 className="text-xl font-bold">Vehicles</h1>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by ID, type or depot"
        aria-label="Search vehicles"
        className="max-w-sm"
      />
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No vehicle matches that search.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Fridge or dry</TableHead>
              <TableHead>Weight limit (kg)</TableHead>
              <TableHead>Volume limit (m³)</TableHead>
              <TableHead>Fuel a week (L)</TableHead>
              <TableHead>Depot</TableHead>
              <TableHead><span className="sr-only">Archive</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  {v.id}
                  {v.archivedAt ? <span className="ml-2 text-muted-foreground">Archived</span> : null}
                </TableCell>
                <TableCell className="capitalize">{v.type}</TableCell>
                <TableCell>{TEMP_LABEL[v.temp]}</TableCell>
                <TableCell>{v.weightCapKg}</TableCell>
                <TableCell>{v.volumeCapM3}</TableCell>
                <TableCell>{v.weeklyFuelQuotaL}</TableCell>
                <TableCell>{v.depotId}</TableCell>
                <TableCell>
                  {v.archivedAt ? null : (
                    <Button type="button" variant="outline" size="sm" onClick={() => { archive.reset(); setPendingId(v.id); }}>
                      Archive
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <AlertDialog open={pendingId !== null} onOpenChange={(open) => { if (!open && !archive.isPending) { setPendingId(null); archive.reset(); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {pendingId}?</AlertDialogTitle>
            <AlertDialogDescription>It stays on old plans, but new plans can no longer use it.</AlertDialogDescription>
          </AlertDialogHeader>
          {archive.isError ? <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{archive.error.message}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={archive.isPending}
              onClick={() => {
                if (!pendingId || archive.isPending) return;
                archive.mutate(pendingId, { onSuccess: () => setPendingId(null) });
              }}
            >
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
