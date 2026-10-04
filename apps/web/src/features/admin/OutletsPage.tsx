import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminOutlet, AdminOutletUpdate, AdminOutletWrite } from '@wayfinder/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { Editor, type Field } from './Editor';

const outletsKey = ['admin', 'outlets'] as const;

const OUTLET_FIELDS: Field[] = [
  { name: 'id', label: 'ID', kind: 'text' },
  { name: 'name', label: 'Name', kind: 'text' },
  { name: 'brand', label: 'Brand', kind: 'select', options: ['Fresh', 'Style', 'Tech'] },
  { name: 'district', label: 'District', kind: 'text' },
  { name: 'depotId', label: 'Depot', kind: 'select', options: ['Peliyagoda', 'Kandy'] },
  { name: 'dockType', label: 'Dock type', kind: 'select', options: ['street', 'rear_dock', 'mall_bay'] },
  { name: 'parking', label: 'Parking rule', kind: 'select', options: ['normal', 'van_only', 'mall_dock'] },
  { name: 'windowOpen', label: 'Window opens', kind: 'time' },
  { name: 'windowClose', label: 'Window closes', kind: 'time' },
];

const blankOutlet = (): Record<string, string> => ({
  id: '', name: '', brand: '', district: '', depotId: '', dockType: '', parking: '', windowOpen: '', windowClose: '',
});

function outletBody(value: Record<string, string>): AdminOutletWrite {
  return {
    id: value.id ?? '', name: value.name ?? '', brand: value.brand as AdminOutletWrite['brand'], district: value.district ?? '',
    depotId: value.depotId ?? '', dockType: value.dockType as AdminOutletWrite['dockType'], parking: value.parking as AdminOutletWrite['parking'],
    windowOpen: value.windowOpen ?? '', windowClose: value.windowClose ?? '',
  };
}

function outletUpdate(body: AdminOutletWrite): AdminOutletUpdate {
  const { id: _id, ...rest } = body;
  return rest;
}

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
  const qc = useQueryClient();
  const outlets = useAdminOutlets();
  const archive = useArchiveOutlet();
  const save = useMutation({
    mutationFn: (input: { id: string | null; body: AdminOutletWrite }) => input.id
      ? api<AdminOutlet>(`/admin/outlets/${input.id}`, { method: 'PATCH', json: outletUpdate(input.body) })
      : api<AdminOutlet>('/admin/outlets', { method: 'POST', json: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: outletsKey }),
  });
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankOutlet);
  const [editing, setEditing] = useState<string | null>(null);

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
      <Editor
        title={editing ? `Edit ${editing}` : 'New outlet'}
        fields={editing ? OUTLET_FIELDS.filter((field) => field.name !== 'id') : OUTLET_FIELDS}
        value={form}
        onChange={setForm}
        pending={save.isPending}
        error={save.isError ? save.error.message : null}
        onCancel={editing ? () => { setEditing(null); setForm(blankOutlet()); save.reset(); } : undefined}
        onSubmit={() => {
          save.mutate({ id: editing, body: outletBody(form) }, { onSuccess: () => { setEditing(null); setForm(blankOutlet()); } });
        }}
      />
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
                <TableCell className="space-x-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    save.reset();
                    setEditing(row.id);
                    setForm({
                      id: row.id, name: row.name, brand: row.brand, district: row.district, depotId: row.depotId,
                      dockType: row.dockType, parking: row.parking, windowOpen: row.windowOpen, windowClose: row.windowClose,
                    });
                  }}>Edit</Button>
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
