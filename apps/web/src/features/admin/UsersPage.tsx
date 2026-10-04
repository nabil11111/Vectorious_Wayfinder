import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, AdminUserCreate, AdminUserUpdate } from '@wayfinder/contracts';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { Editor, type Field } from './Editor';

const usersKey = ['admin', 'users'] as const;

const FIELDS: Field[] = [
  { name: 'staffId', label: 'Staff ID', kind: 'text' },
  { name: 'displayName', label: 'Name', kind: 'text' },
  { name: 'role', label: 'Role', kind: 'select', options: ['store_manager', 'dispatcher', 'loader', 'driver', 'admin'] },
  { name: 'depotId', label: 'Depot', kind: 'select', options: ['Peliyagoda', 'Kandy'] },
  { name: 'outletId', label: 'Outlet', kind: 'text' },
  { name: 'pin', label: 'PIN', kind: 'password' },
  { name: 'active', label: 'Active', kind: 'check' },
];

const blank = (): Record<string, string> => ({
  staffId: '', displayName: '', role: '', depotId: '', outletId: '', pin: '', active: 'true',
});

function bodyOf(value: Record<string, string>, editing: boolean): AdminUserCreate | AdminUserUpdate {
  const common = {
    staffId: value.staffId ?? '',
    displayName: value.displayName ?? '',
    role: value.role as AdminUserCreate['role'],
    depotId: value.depotId ? value.depotId : null,
    outletId: value.outletId ? value.outletId : null,
  };
  if (!editing) return { ...common, pin: value.pin ?? '' };
  return { ...common, active: value.active === 'true', ...(value.pin ? { pin: value.pin } : {}) };
}

export function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: usersKey, queryFn: () => api<AdminUser[]>('/admin/users') });
  const save = useMutation({
    mutationFn: (input: { id: string | null; body: AdminUserCreate | AdminUserUpdate }) => input.id
      ? api<AdminUser>(`/admin/users/${input.id}`, { method: 'PATCH', json: input.body })
      : api<AdminUser>('/admin/users', { method: 'POST', json: input.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
  });
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);

  if (users.isPending) return <p className="text-muted-foreground">Loading users…</p>;
  if (users.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{users.error.message}</p>
        <Button type="button" variant="outline" onClick={() => users.refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl bg-card p-6 shadow-sm">
      <h1 className="text-xl font-bold">Users</h1>
      <Editor
        title={editing ? 'Edit account' : 'New account'}
        fields={editing ? FIELDS : FIELDS.filter((field) => field.name !== 'active')}
        value={form}
        onChange={setForm}
        pending={save.isPending}
        error={save.isError ? save.error.message : null}
        onCancel={editing ? () => { setEditing(null); setForm(blank()); save.reset(); } : undefined}
        onSubmit={() => {
          save.mutate({ id: editing, body: bodyOf(form, editing !== null) }, {
            onSuccess: () => { setEditing(null); setForm(blank()); },
          });
        }}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Staff ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Depot</TableHead>
            <TableHead>Outlet</TableHead>
            <TableHead><span className="sr-only">Edit</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.data.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                {row.staffId}
                {row.active ? null : <span className="ml-2 text-muted-foreground">Inactive</span>}
              </TableCell>
              <TableCell>{row.displayName}</TableCell>
              <TableCell>{row.role}</TableCell>
              <TableCell>{row.depotId}</TableCell>
              <TableCell>{row.outletId}</TableCell>
              <TableCell>
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  save.reset();
                  setEditing(row.id);
                  setForm({
                    staffId: row.staffId, displayName: row.displayName, role: row.role,
                    depotId: row.depotId ?? '', outletId: row.outletId ?? '', pin: '', active: row.active ? 'true' : 'false',
                  });
                }}>Edit</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
