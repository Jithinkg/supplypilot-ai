import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/app/auth';

export function LoginPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: () => api.login(email, password), onSuccess: (data) => { setPassword(''); queryClient.setQueryData(['session'], data); } });
  if (session.data) return <Navigate to="/" replace />;
  function submit(event: FormEvent) { event.preventDefault(); login.mutate(); }
  return <main className="flex min-h-screen items-center justify-center px-5 py-12">
    <section className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
      <Package2 aria-hidden className="mb-6 size-9 text-primary" />
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">SupplyPilot AI</p>
      <h1 className="mt-2 text-2xl font-semibold">Sign in to your workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground">Use your seeded staff or manager account.</p>
      <form onSubmit={submit} className="mt-7 space-y-5">
        <div><label htmlFor="email" className="mb-2 block text-sm font-medium">Email</label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="password" className="mb-2 block text-sm font-medium">Password</label><Input id="password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {login.error && <p role="alert" className="text-sm text-destructive">{login.error.message}</p>}
        <Button type="submit" className="w-full" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </section>
  </main>;
}
