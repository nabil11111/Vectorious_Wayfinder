import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminProduct, AdminProductUpdate, AdminProductWrite } from '@wayfinder/contracts';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { Editor, type Field } from './Editor';

const productsKey = ['admin', 'products'] as const;

const PRODUCT_FIELDS: Field[] = [
  { name: 'id', label: 'ID', kind: 'text' },
  { name: 'name', label: 'Name', kind: 'text' },
  { name: 'brand', label: 'Brand', kind: 'select', options: ['Fresh', 'Style', 'Tech'] },
  { name: 'unit', label: 'Unit', kind: 'text' },
  { name: 'kgPerUnit', label: 'kg per unit', kind: 'number' },
  { name: 'm3PerUnit', label: 'm³ per unit', kind: 'number' },
  { name: 'temp', label: 'Chilled or dry', kind: 'select', options: ['chilled', 'dry'] },
  { name: 'needsTailLift', label: 'Tail lift', kind: 'check' },
];

const blankProduct = (): Record<string, string> => ({
  id: '', name: '', brand: '', unit: '', kgPerUnit: '', m3PerUnit: '', temp: '', needsTailLift: 'false',
});

function productBody(value: Record<string, string>): AdminProductWrite {
  return {
    id: value.id ?? '', name: value.name ?? '', brand: value.brand as AdminProductWrite['brand'], unit: value.unit ?? '',
    kgPerUnit: Number(value.kgPerUnit), m3PerUnit: Number(value.m3PerUnit), temp: value.temp as AdminProductWrite['temp'],
    needsTailLift: value.needsTailLift === 'true',
  };
}

function productUpdate(body: AdminProductWrite): AdminProductUpdate {
  const { id: _id, ...rest } = body;
  return rest;
}

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
  const qc = useQueryClient();
  const products = useAdminProducts();
  const archive = useArchiveProduct();
  const save = useMutation({
    mutationFn: (input: { id: string | null; body: AdminProductWrite }) => input.id
      ? api<AdminProduct>(`/admin/products/${encodeURIComponent(input.id)}`, { method: 'PATCH', json: productUpdate(input.body) })
      : api<AdminProduct>('/admin/products', { method: 'POST', json: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: productsKey }),
  });
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankProduct);
  const [editing, setEditing] = useState<string | null>(null);
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
      <Editor
        title={editing ? `Edit ${editing}` : 'New product'}
        fields={editing ? PRODUCT_FIELDS.filter((field) => field.name !== 'id') : PRODUCT_FIELDS}
        value={form}
        onChange={setForm}
        pending={save.isPending}
        error={save.isError ? save.error.message : null}
        onCancel={editing ? () => { setEditing(null); setForm(blankProduct()); save.reset(); } : undefined}
        onSubmit={() => {
          save.mutate({ id: editing, body: productBody(form) }, { onSuccess: () => { setEditing(null); setForm(blankProduct()); } });
        }}
      />
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
                <TableCell className="space-x-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    save.reset();
                    setEditing(row.id);
                    setForm({
                      id: row.id, name: row.name, brand: row.brand, unit: row.unit, kgPerUnit: String(row.kgPerUnit),
                      m3PerUnit: String(row.m3PerUnit), temp: row.temp, needsTailLift: row.needsTailLift ? 'true' : 'false',
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
