import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminVehicle } from '@wayfinder/contracts';
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

export function VehiclesPage() {
  const vehicles = useAdminVehicles();
  const [search, setSearch] = useState('');

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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
