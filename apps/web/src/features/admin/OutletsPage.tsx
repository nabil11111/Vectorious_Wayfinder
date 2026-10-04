import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminOutlet } from '@wayfinder/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

const outletsKey = ['admin', 'outlets'] as const;

const DOCK: Record<AdminOutlet['dockType'], string> = {
  street: 'Street',
  rear_dock: 'Rear dock',
  mall_bay: 'Mall bay',
};

const PARKING: Record<AdminOutlet['parking'], string> = {
  normal: 'Normal',
  van_only: 'Van only',
  mall_dock: 'Mall dock',
};

export function useAdminOutlets() {
  return useQuery({
    queryKey: outletsKey,
    queryFn: () => api<AdminOutlet[]>('/admin/outlets'),
  });
}

export function useArchiveOutlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<AdminOutlet>(`/admin/outlets/${id}/archive`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: outletsKey }),
  });
}

export function OutletsPage() {
  const outlets = useAdminOutlets();
  const archive = useArchiveOutlet();
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (outlets.isPending) return <p className="text-muted-foreground">Loading outlets…</p>;

  if (outlets.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{outlets.error.message}</p>
        <Button type="button" variant="outline" onClick={() => outlets.refetch()}>Try again</Button>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const rows = outlets.data.filter((row) =>
    q === ''
    || row.id.toLowerCase().includes(q)
    || row.name.toLowerCase().includes(q)
    || row.district.toLowerCase().includes(q)
    || row.depotId.toLowerCase().includes(q));

  return (
    <section className="space-y-4 rounded-2xl bg-card p-6 shadow-sm">
      <h1 className="text-xl font-bold">Outlets</h1>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by ID, name, district or depot"
        aria-label="Search outlets"
        className="max-w-sm"
      />
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No outlet matches that search.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>District</TableHead>
              <TableHead>Depot</TableHead>
              <TableHead>Dock type</TableHead>
              <TableHead>Parking rule</TableHead>
              <TableHead>Delivery window</TableHead>
              <TableHead><span className="sr-only">Archive</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.id}
                  {row.archivedAt ? <span className="ml-2 text-muted-foreground">Archived</span> : null}
                </TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.brand}</TableCell>
                <TableCell>{row.district}</TableCell>
                <TableCell>{row.depotId}</TableCell>
                <TableCell>{DOCK[row.dockType]}</TableCell>
                <TableCell>{PARKING[row.parking]}</TableCell>
                <TableCell>{row.windowOpen}–{row.windowClose}</TableCell>
                <TableCell>
                  {row.archivedAt ? null : (
                    <Button type="button" variant="outline" size="sm" onClick={() => { archive.reset(); setPendingId(row.id); }}>
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
            <AlertDialogDescription>It stays on old orders and plans, but new ones can no longer use it.</AlertDialogDescription>
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
