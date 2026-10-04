import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type Field =
  | { name: string; label: string; kind: 'text' | 'number' | 'time' | 'password' }
  | { name: string; label: string; kind: 'select'; options: readonly string[] }
  | { name: string; label: string; kind: 'check' };

export function Editor({
  title, fields, value, onChange, onSubmit, onCancel, pending, error,
}: {
  title: string;
  fields: Field[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <form
      className="space-y-3 rounded-xl border border-border p-4"
      onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
    >
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.name} className="space-y-1 text-sm">
            <span className="text-muted-foreground">{field.label}</span>
            {field.kind === 'select' ? (
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                value={value[field.name] ?? ''}
                onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
              >
                <option value="">Choose</option>
                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : field.kind === 'check' ? (
              <input
                type="checkbox"
                className="size-4"
                checked={value[field.name] === 'true'}
                onChange={(event) => onChange({ ...value, [field.name]: event.target.checked ? 'true' : 'false' })}
              />
            ) : (
              <Input
                type={field.kind}
                value={value[field.name] ?? ''}
                onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      {error ? <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  );
}
