import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wordmark } from '@/components/layout/Wordmark';
import { HOME, useLogin, useMe } from './api';

export function LoginPage() {
  const { data: me } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (me) return <Navigate to={HOME[me.role]} replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ username, password }, { onSuccess: (u) => navigate(HOME[u.role], { replace: true }) });
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6 rounded-2xl bg-card p-6 shadow-sm sm:p-8">
        <Wordmark className="h-7" />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Use the account your depot gave you.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} className="h-12 text-base" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" required />
        </div>
        {login.error && <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">{login.error.message}</p>}
        <Button type="submit" size="xl" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
