import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminProduct } from '@wayfinder/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';

const productsKey = ['admin', 'products'] as const;

const TEMP: Record<AdminProduct['temp'], string> = {
  chilled: 'Chilled',
  dry: 'Dry',
};

export function useAdminProducts() {
  return useQuery({
    queryKey: productsKey,
    queryFn: () => api<AdminProduct[]>('/admin/products'),
  });
}

export function useArchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<AdminProduct>(`/admin/products/${encodeURIComponent(id)}/archive`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: productsKey }),
  });
}

export function ProductsPage() {
  const products = useAdminProducts();
  const archive = useArchiveProduct();
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = products.data?.find((row) => row.id === pendingId);

  if (products.isPending) return <p className="text-muted-foreground">Loading products…</p>;

  if (products.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{products.error.message}</p>
        <Button type="button" variant="outline" onClick={() => products.refetch()}>Try again</Button>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const rows = products.data.filter((row) =>
    q === ''
    || row.name.toLowerCase().includes(q)
    || row.brand.toLowerCase().includes(q)
    || row.unit.toLowerCase().includes(q));

  return (
    <section className="space-y-4 rounded-2xl bg-card p-6 shadow-sm">
      <h1 className="text-xl font-bold">Products</h1>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, brand or unit"
        aria-label="Search products"
        className="max-w-sm"
      />
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No product matches that search.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>kg per unit</TableHead>
              <TableHead>m³ per unit</TableHead>
              <TableHead>Chilled or dry</TableHead>
              <TableHead>Tail lift</TableHead>
              <TableHead><span className="sr-only">Archive</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.name}
                  {row.archivedAt ? <span className="ml-2 text-muted-foreground">Archived</span> : null}
                </TableCell>
                <TableCell>{row.brand}</TableCell>
                <TableCell>{row.unit}</TableCell>
                <TableCell>{row.kgPerUnit}</TableCell>
                <TableCell>{row.m3PerUnit}</TableCell>
                <TableCell>{TEMP[row.temp]}</TableCell>
                <TableCell>{row.needsTailLift ? 'Yes' : 'No'}</TableCell>
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
            <AlertDialogTitle>Archive {pending?.name ?? 'this product'}?</AlertDialogTitle>
            <AlertDialogDescription>It stays on old orders, but new ones can no longer use it.</AlertDialogDescription>
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
