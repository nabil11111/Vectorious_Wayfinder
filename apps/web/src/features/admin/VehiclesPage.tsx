import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVehicle, AdminVehicleUpdate, AdminVehicleWrite } from '@wayfinder/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { Editor, type Field } from './Editor';

const vehiclesKey = ['admin', 'vehicles'] as const;

const VEHICLE_FIELDS: Field[] = [
  { name: 'id', label: 'ID', kind: 'text' },
  { name: 'type', label: 'Type', kind: 'select', options: ['truck', 'van'] },
  { name: 'temp', label: 'Fridge or dry', kind: 'select', options: ['reefer', 'ambient'] },
  { name: 'weightCapKg', label: 'Weight limit (kg)', kind: 'number' },
  { name: 'volumeCapM3', label: 'Volume limit (m³)', kind: 'number' },
  { name: 'fuelType', label: 'Fuel', kind: 'text' },
  { name: 'kmPerL', label: 'km per litre', kind: 'number' },
  { name: 'weeklyFuelQuotaL', label: 'Fuel a week (L)', kind: 'number' },
  { name: 'depotId', label: 'Depot', kind: 'select', options: ['Peliyagoda', 'Kandy'] },
];

const blankVehicle = (): Record<string, string> => ({
  id: '', type: '', temp: '', weightCapKg: '', volumeCapM3: '', fuelType: '', kmPerL: '', weeklyFuelQuotaL: '', depotId: '',
});

function vehicleBody(value: Record<string, string>): AdminVehicleWrite {
  return {
    id: value.id ?? '',
    type: value.type as AdminVehicleWrite['type'],
    temp: value.temp as AdminVehicleWrite['temp'],
    weightCapKg: Number(value.weightCapKg),
    volumeCapM3: Number(value.volumeCapM3),
    fuelType: value.fuelType ?? '',
    kmPerL: Number(value.kmPerL),
    weeklyFuelQuotaL: Number(value.weeklyFuelQuotaL),
    depotId: value.depotId ?? '',
  };
}

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

function vehicleUpdate(body: AdminVehicleWrite): AdminVehicleUpdate {
  const { id: _id, ...rest } = body;
  return rest;
}

export function VehiclesPage() {
  const qc = useQueryClient();
  const vehicles = useAdminVehicles();
  const archive = useArchiveVehicle();
  const save = useMutation({
    mutationFn: (input: { id: string | null; body: AdminVehicleWrite }) => input.id
      ? api<AdminVehicle>(`/admin/vehicles/${input.id}`, { method: 'PATCH', json: vehicleUpdate(input.body) })
      : api<AdminVehicle>('/admin/vehicles', { method: 'POST', json: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vehiclesKey }),
  });
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankVehicle);
  const [editing, setEditing] = useState<string | null>(null);

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
      <Editor
        title={editing ? `Edit ${editing}` : 'New vehicle'}
        fields={editing ? VEHICLE_FIELDS.filter((field) => field.name !== 'id') : VEHICLE_FIELDS}
        value={form}
        onChange={setForm}
        pending={save.isPending}
        error={save.isError ? save.error.message : null}
        onCancel={editing ? () => { setEditing(null); setForm(blankVehicle()); save.reset(); } : undefined}
        onSubmit={() => {
          save.mutate({ id: editing, body: vehicleBody(form) }, { onSuccess: () => { setEditing(null); setForm(blankVehicle()); } });
        }}
      />
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
              <TableHead>Fuel</TableHead>
              <TableHead>km per litre</TableHead>
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
                <TableCell>{v.fuelType}</TableCell>
                <TableCell>{v.kmPerL}</TableCell>
                <TableCell>{v.weeklyFuelQuotaL}</TableCell>
                <TableCell>{v.depotId}</TableCell>
                <TableCell className="space-x-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    save.reset();
                    setEditing(v.id);
                    setForm({
                      id: v.id, type: v.type, temp: v.temp, weightCapKg: String(v.weightCapKg),
                      volumeCapM3: String(v.volumeCapM3), fuelType: v.fuelType, kmPerL: String(v.kmPerL),
                      weeklyFuelQuotaL: String(v.weeklyFuelQuotaL), depotId: v.depotId,
                    });
                  }}>Edit</Button>
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
